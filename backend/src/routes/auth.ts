import { Router, Request, Response } from 'express';
import { getDb, saveDb, queryOne } from '../db.js';
import {
  verifyPassword, hashPassword, migrateLegacyPassword, createSession, destroySession,
  getSessionUser, authRequired, getCurrentUser, AuthRequest, SESSION_COOKIE, ROLE_PERMISSIONS,
} from '../auth.js';

const router = Router();
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const accountStore = new Map<string, { count: number; resetAt: number }>();
const WINDOW = 60 * 1000;
const MAX = 10;
const ACCOUNT_WINDOW = 10 * 60 * 1000; // نافذة قفل الحساب: 10 دقائق
const ACCOUNT_MAX = 8;                  // محاولات فاشلة لكل اسم مستخدم قبل القفل المؤقت

function tooMany(ip: string): boolean {
  const now = Date.now();
  const e = rateLimitStore.get(ip);
  if (!e || now > e.resetAt) { rateLimitStore.set(ip, { count: 1, resetAt: now + WINDOW }); return false; }
  e.count++; return e.count > MAX;
}

// D-07: قفل مؤقت لكل حساب (لا لكل IP فقط) — يصدّ تخمين كلمة المرور الموزّع ببطء من عنوان واحد مشترك.
function accountLocked(username: string): boolean {
  const e = accountStore.get(username);
  return !!e && e.count >= ACCOUNT_MAX && Date.now() <= e.resetAt;
}
function accountFail(username: string): void {
  const now = Date.now();
  const e = accountStore.get(username);
  if (!e || now > e.resetAt) { accountStore.set(username, { count: 1, resetAt: now + ACCOUNT_WINDOW }); return; }
  e.count++;
}
function accountReset(username: string): void { accountStore.delete(username); }

// D-07: تدقيق موحّد لمسارات المصادقة (نجاح/فشل) مع userId وIP — بلا أي أسرار.
function auditAuth(action: string, userName: string, userId: number | null, ip: string, detail?: unknown) {
  try {
    getDb().run(
      "INSERT INTO audit_logs (action, objectType, objectId, newValue, userName, userId, ipAddress, createdAt) VALUES (?, 'auth', ?, ?, ?, ?, ?, datetime('now'))",
      [action, userId != null ? String(userId) : null,
       typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
       userName || 'unknown', userId ?? null, ip || null]
    );
  } catch { /* best-effort */ }
}

// POST /api/auth/login — المصادقة على الخادم، هجرة كلمة النصية القديمة على النجاح
router.post('/login', (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (tooMany(ip)) { res.status(429).json({ error: 'Too many attempts. Try later.' }); return; }
  const { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
  const uname = String(username).trim();
  if (accountLocked(uname.toLowerCase())) {
    auditAuth('login.locked', uname, null, ip, { reason: 'account temporarily locked' });
    res.status(429).json({ error: 'تم قفل الحساب مؤقتاً بعد محاولات فاشلة متكررة — حاول لاحقاً' }); return;
  }
  try {
    const user = queryOne('SELECT * FROM users WHERE username = ? OR email = ?', [String(username), uname.toLowerCase()]);
    if (!user) { accountFail(uname.toLowerCase()); auditAuth('login.failed', uname, null, ip, { reason: 'unknown user' }); res.status(401).json({ error: 'بيانات الدخول غير صحيحة' }); return; }
    if (Number(user.active) === 0) { auditAuth('login.failed', uname, Number(user.id), ip, { reason: 'inactive' }); res.status(403).json({ error: 'الحساب مُعطَّل' }); return; }

    const stored = user.password as string | undefined;
    if (!verifyPassword(String(password), stored)) {
      accountFail(uname.toLowerCase());
      auditAuth('login.failed', uname, Number(user.id), ip, { reason: 'bad password' });
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' }); return;
    }

    // هجرة كلمة النصية القديمة → مجزّأة (فور النجاح، بلا تغيير وصول)
    migrateLegacyPassword(Number(user.id), String(password), stored);
    saveDb();
    accountReset(uname.toLowerCase());
    auditAuth('login.success', String(user.username), Number(user.id), ip, { role: user.role || 'cashier' });

    const token = createSession({
      id: Number(user.id), username: String(user.username), role: String(user.role || 'cashier'),
    });

    const mustChange = Number(user.mustChangePassword) === 1;
    const safe = {
      id: user.id, username: user.username, email: user.email || null, employeeId: user.employeeId ?? null,
      name: user.name || '', role: user.role || 'cashier', active: Number(user.active), mustChangePassword: mustChange,
    };
    res.json({ success: true, token, mustChangePassword: mustChange, user: safe });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/auth/logout — إبطال الجلسة
router.post('/logout', authRequired, (req: AuthRequest, res: Response) => {
  const id = req.identity!;
  const ip = ((req.headers['x-forwarded-for'] as string) || req.ip || '').toString().split(',')[0].trim();
  if (id.token) destroySession(id.token);
  if (id.kind === 'user') auditAuth('logout', id.username || 'unknown', id.userId ?? null, ip, {});
  res.json({ success: true });
});

// GET /api/auth/me — من أنا (جلسة)
router.get('/me', authRequired, (req: AuthRequest, res: Response) => {
  const me = getCurrentUser(req);
  if (!me) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.json({ user: me });
});

// PUT /api/auth/password — تغيير كلمة المرور (تتطلب مصادقة، ومعرف هوية المستخدم نفسه)
router.put('/password', authRequired, (req: AuthRequest, res: Response) => {
  const id = req.identity!;
  if (id.kind !== 'user' || id.userId == null) { res.status(403).json({ error: 'Only user sessions can change password' }); return; }
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) { res.status(400).json({ error: 'currentPassword and newPassword required' }); return; }
  if (String(newPassword).length < 6) { res.status(400).json({ error: 'new password must be at least 6 characters' }); return; }

  try {
    const user = queryOne('SELECT password, mustChangePassword FROM users WHERE id = ?', [id.userId]);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (!verifyPassword(String(currentPassword), user.password as string | undefined)) {
      res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' }); return;
    }
    const hashed = hashPassword(String(newPassword));
    getDb().run('UPDATE users SET password = ?, mustChangePassword = 0 WHERE id = ?', [hashed, id.userId]);
    saveDb();
    const pip = ((req.headers['x-forwarded-for'] as string) || req.ip || '').toString().split(',')[0].trim();
    auditAuth('password.changed', id.username || 'unknown', id.userId ?? null, pip, {});
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/auth/verify — فحص صلاحية الجلسة (يُستخدم في الاختبارات/الدخول الآمن)
router.get('/verify', authRequired, (req: AuthRequest, res: Response) => {
  const id = req.identity!;
  res.json({ authenticated: true, role: id.role, kind: id.kind, username: id.username || null });
});

// GET /api/auth/permissions — صلاحيات الدور الحالي (سيرفر-فرست، لتوزيع تبويبات الإدارة)
router.get('/permissions', authRequired, (req: AuthRequest, res: Response) => {
  const id = req.identity!;
  const perms = ROLE_PERMISSIONS[id.role] || new Set();
  const wildcard = perms.has('*');
  res.json({
    role: id.role,
    kind: id.kind,
    username: id.username || null,
    wildcard,
    permissions: wildcard ? [] : Array.from(perms).sort(),
  });
});

export default router;
