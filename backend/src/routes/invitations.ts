import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, saveDb, queryAll, queryOne } from '../db.js';
import { authRequired, requirePermission, AuthRequest, hashPassword, roleHas } from '../auth.js';

const router = Router();

// ===== Anti-Batman Phase 1: الموظفون بالبريد + الدعوات + التفعيل =====
// المصادقة: إنشاء الدعوات فقط لإداري/مدير (صلاحية employees.write من ROLE_PERMISSIONS).
// التفعيل (إنشاء الحساب) عام حتى يعمل قبل الدخول، لكنه لا يتضمن كلمة مرور في الرابط إطلاقاً،
// والدور يُحدَّد بالنظام (داخل الدعوة) لا باختيار الموظف، والبريد فريد ومثبّت للدعوة.
// لا نكشف الرمز/التوثيق عبر CRUD عام — مسارات مخصّصة حصراً.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام

function cryptoRandom() {
  return crypto.randomBytes(32).toString('hex');
}

function lastId(): number {
  const r = queryOne('SELECT last_insert_rowid() AS id');
  return r ? Number(r.id || 0) : 0;
}

// توليد اسم مستخدم فريد من بريد الموظف (لا يحتاج الموظف لمعرفته — الدخول بالبريد).
function makeUniqueUsername(email: string): string {
  const base = (email.split('@')[0] || 'user')
    .toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24) || 'user';
  let candidate = base;
  let n = 1;
  while (queryOne('SELECT id FROM users WHERE username = ?', [candidate])) {
    candidate = `${base}${n++}`;
  }
  return candidate;
}

function audit(action: string, objectType: string, objectId: string | number | null, userId: number | null, userName: string, newValue?: unknown) {
  try {
    getDb().run(
      `INSERT INTO audit_logs (action, objectType, objectId, oldValue, newValue, userName, createdAt) VALUES (?, ?, ?, '', ?, ?, datetime('now'))`,
      [action, objectType, String(objectId ?? ''), JSON.stringify(newValue ?? {}), userName || 'system']
    );
  } catch { /* best-effort */ }
}

// إنشاء موظف + حساب مستخدم (غير مفعّل) + دعوة رابط.
router.post('/employees/invite', authRequired, requirePermission('employees.write'), (req: AuthRequest, res: Response) => {
  const { name, email, role, employeeId } = req.body || {};
  if (!name || !email || !EMAIL_RE.test(String(email))) {
    res.status(400).json({ error: 'name and a valid email are required' }); return;
  }
  const r = String(role || 'cashier');
  if (!roleHas(r, 'sync')) { res.status(400).json({ error: 'unsupported role' }); return; }

  try {
    const db = getDb();
    const normalized = String(email).trim().toLowerCase();
    // بريد فريد: لا يمكن أن يتطابق مع حساب موجود.
    const existingUser = queryOne('SELECT id FROM users WHERE email = ? OR username = ?', [normalized, normalized]);
    if (existingUser) { res.status(409).json({ error: 'email already registered' }); return; }

    // ربط الموظف (استخدم موظفاً قائماً إن وُجد، وإلا أنشئ واحداً).
    let empId: number;
    if (employeeId != null) {
      const emp = queryOne('SELECT id FROM employees WHERE id = ?', [Number(employeeId)]);
      if (!emp) { res.status(404).json({ error: 'employee not found' }); return; }
      empId = Number(employeeId);
      try {
        db.run('UPDATE employees SET email = ? WHERE id = ?', [normalized, empId]);
      } catch { /* تجاهل */ }
    } else {
      db.run('INSERT INTO employees (name, email, role, active, createdAt) VALUES (?, ?, ?, 1, ?)', [name, normalized, r, new Date().toISOString()]);
      empId = lastId();
    }

    // حساب مستخدم غير مفعّل: بريد + دور (النظام يحدد الدور)، لا كلمة مرور بعد.
    const username = makeUniqueUsername(normalized);
    db.run('INSERT INTO users (username, email, password, name, role, active, employeeId, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [username, normalized, '', name, r, empId, new Date().toISOString()]);
    const userId = lastId();
    try { db.run('UPDATE employees SET userId = ? WHERE id = ?', [userId, empId]); } catch { /* تجاهل */ }

    // سجل دعوة: رمز واحد، مثبّت للبريد، منتهي الصلاحية.
    const token = cryptoRandom();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    db.run('INSERT INTO invitations (token, email, employeeId, role, name, status, expiresAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [token, normalized, empId, r, name, 'pending', expiresAt, req.identity!.userId ?? null, new Date().toISOString()]);
    const inviteId = lastId();
    saveDb();

    audit('employee.invite', 'employees', empId, req.identity!.userId ?? null, req.identity!.username || '', {
      name, email: normalized, role: r, employeeId: empId, inviteId, expiresAt,
    });
    res.json({ success: true, inviteId, inviteToken: token, expiresAt, employeeId: empId, email: normalized, role: r, name });
  } catch (e: unknown) {
    saveDb();
    res.status(500).json({ error: (e as Error).message });
  }
});

// التحقق من الدعوة (قبل إنشاء الحساب). لا يعيد أي سر/كلمة مرور.
router.get('/invitations/:token/check', (req: Request, res: Response) => {
  try {
    const inv = queryOne('SELECT * FROM invitations WHERE token = ?', [String(req.params.token)]);
    if (!inv) { res.json({ valid: false, reason: 'not_found' }); return; }
    const expired = new Date(String(inv.expiresAt)).getTime() < Date.now();
    const used = String(inv.status) === 'used';
    const revoked = String(inv.status) === 'revoked';
    if (expired) { res.json({ valid: false, reason: 'expired' }); return; }
    if (used) { res.json({ valid: false, reason: 'used' }); return; }
    if (revoked) { res.json({ valid: false, reason: 'revoked' }); return; }
    res.json({ valid: true, email: inv.email, name: inv.name, role: inv.role, expiresAt: inv.expiresAt });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// إنشاء الحساب: يختار الموظف بريده (يجب أن يطابق الدعوة) وكلمته. لا كلمة مرور داخل الرابط.
router.post('/invitations/:token/activate', (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }
  if (String(password).length < 6) { res.status(400).json({ error: 'password must be at least 6 characters' }); return; }

  try {
    const db = getDb();
    const inv = queryOne('SELECT * FROM invitations WHERE token = ?', [String(req.params.token)]);
    if (!inv) { res.status(404).json({ error: 'invitation not found' }); return; }
    if (String(inv.status) !== 'pending') { res.status(400).json({ error: 'invitation already used/revoked' }); return; }
    if (new Date(String(inv.expiresAt)).getTime() < Date.now()) { res.status(400).json({ error: 'invitation expired' }); return; }
    if (String(inv.email).toLowerCase() !== String(email).trim().toLowerCase()) {
      res.status(400).json({ error: 'email does not match invitation' }); return;
    }

    const user = queryOne('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }

    const hashed = hashPassword(String(password));
    db.run('UPDATE users SET password = ?, active = 1, mustChangePassword = 0 WHERE id = ?', [hashed, user.id]);
    db.run("UPDATE invitations SET status = 'used', updatedAt = (datetime('now')) WHERE id = ?", [inv.id]);
    saveDb();

    audit('employee.activate', 'users', Number(user.id), null, String(inv.name || ''), {
      email: user.email, employeeId: user.employeeId, role: user.role, inviteId: inv.id,
    });
    res.json({ success: true, userId: user.id, email: user.email, role: user.role });
  } catch (e: unknown) {
    saveDb();
    res.status(500).json({ error: (e as Error).message });
  }
});

// تعطيل/إعادة تفعيل الموظف (وكل حساب مستخدم مرتبط به): لا دخول عند التعطيل، ويُحتفظ بالتاريخ.
// هذا أأمن وأوضح من الدفع عبر sync (الذي يخضع لنافذة تعارض الوقت).
router.post('/employees/:id/status', authRequired, requirePermission('employees.write'), (req: AuthRequest, res: Response) => {
  const { active } = req.body || {};
  try {
    const db = getDb();
    const empId = Number(req.params.id);
    const emp = queryOne('SELECT * FROM employees WHERE id = ?', [empId]);
    if (!emp) { res.status(404).json({ error: 'employee not found' }); return; }

    const act = active ? 1 : 0;
    db.run('UPDATE employees SET active = ? WHERE id = ?', [act, empId]);
    let userId = emp.userId != null ? Number(emp.userId) : null;
    if (userId == null) {
      const u = queryOne('SELECT id FROM users WHERE employeeId = ?', [empId]);
      if (u) userId = Number(u.id);
    }
    if (userId != null) {
      db.run('UPDATE users SET active = ? WHERE id = ?', [act, userId]);
    }
    saveDb();
    audit(act ? 'employee.enable' : 'employee.disable', 'employees', empId, req.identity!.userId ?? null, req.identity!.username || '', {
      employeeId: empId, userId, active: act,
    });
    res.json({ success: true, employeeId: empId, userId, active: act });
  } catch (e: unknown) {
    saveDb();
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
