import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { queryOne, getDb } from './db.js';

// ===== إعدادات الأمان =====
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || String(12 * 60 * 60 * 1000)); // 12 ساعة
export const SESSION_COOKIE = 'lucca_session';

// ===== تخزين الجلسات في SQLite (P1: خارج الذاكرة — تعيش مع السيرفر وتصمد أمام إعادة التشغيل) =====
// الجلسات في جدول sessions (يُنشأ في db.ts migrate بجوار بقية الجداول) — READING/الإلغاء مباشرة من DB.
export interface Session {
  token: string;
  userId: number;
  username: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}

function now(): number { return Date.now(); }

// تنظيف الجلسات المنتهية (يُستدعى عند كل تحقق) — سطر واحد في DB بدل اجتياح الذاكرة
function sweepSessions(): void {
  try {
    getDb().run('DELETE FROM sessions WHERE expiresAt <= ?', [now()]);
  } catch { /* الجدول قد لا يكون مُنشأ بعد في أول لحظة */ }
}

// ===== كلمات المرور: PBKDF2-SHA512 (نفس مخطط العميل الحالي) =====
const ITERATIONS = 100000;
const KEYLEN = 64; // 512 bits

export function hashPassword(password: string, salt?: string): string {
  const s: string = (salt && /^[0-9a-fA-F-]{8,64}$/.test(salt))
    ? salt
    : crypto.randomUUID();
  const derived = crypto.pbkdf2Sync(password, s, ITERATIONS, KEYLEN, 'sha512');
  return `pbkdf2:${s}:${derived.toString('hex')}`;
}

// التحقق: يدعم النص الصريح القديم (legacy) و pbkdf2:
export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1] || '';
    const hashHex = parts[2] || '';
    if (!salt || !/^[0-9a-fA-F-]{8,64}$/.test(salt) || !/^[0-9a-fA-F]{128}$/.test(hashHex)) return false;
    try {
      const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, 'sha512');
      const a = Buffer.from(hashHex, 'hex');
      const b = derived;
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  }
  // نص صريح قديم (مقارنة مباشرة) — يُهاجَر لاحقاً عند نجاح الدخول
  const a = Buffer.from(String(stored));
  const b = Buffer.from(String(password));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// عند نجاح الدخول بكلمة نصية قديمة: يُعاد تخزينها مجزّأة فوراً (بلا تغيير وصول)
export function migrateLegacyPassword(userId: number, password: string, currentStored: string | undefined | null) {
  if (currentStored && currentStored.startsWith('pbkdf2:')) return;
  try {
    const hashed = hashPassword(password);
    getDb().run('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
  } catch { /* فشل الهجرة لا يمنع الدخول */ }
}

// ===== إنشاء/تحقق/إبطال الجلسة (SQLite — ليست في الذاكرة) =====
export function createSession(user: { id: number; username: string; role: string }): string {
  const token = crypto.randomBytes(32).toString('hex');
  const nowMs = now();
  const expiresAt = nowMs + SESSION_TTL_MS;
  try {
    getDb().run(
      'INSERT OR REPLACE INTO sessions (token, userId, username, role, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      [token, user.id, user.username, user.role, nowMs, expiresAt]
    );
  } catch { /* جدول الجلسات غير جاهز — لن نكسر الدخول */ }
  return token;
}

const lastSweepRef: { current: number } = { current: 0 };

export function getSessionUser(token: string | undefined): Session | null {
  if (!token) return null;
  if (now() - lastSweepRef.current > 60_000) { sweepSessions(); lastSweepRef.current = now(); }
  let row: Record<string, unknown> | null | undefined;
  try { row = queryOne('SELECT token, userId, username, role, createdAt, expiresAt FROM sessions WHERE token = ?', [token]); }
  catch { row = null; }
  if (!row || row.token == null) return null;
  const expiresAt = Number(row.expiresAt) || 0;
  if (expiresAt <= now()) {
    try { getDb().run('DELETE FROM sessions WHERE token = ?', [token]); } catch { /* تجاهل */ }
    return null;
  }
  return {
    token: String(row.token),
    userId: Number(row.userId),
    username: String(row.username || ''),
    role: String(row.role || ''),
    createdAt: Number(row.createdAt) || 0,
    expiresAt,
  };
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  try {
    getDb().run('DELETE FROM sessions WHERE token = ?', [token]);
  } catch { /* لا يوجد جدول بعد */ }
}

// ===== الأدوار والصلاحيات =====
// الصلاحيات (scopes). كل دور يمتلك مجموعة صلاحيات.
export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set(['*']),
  manager: new Set([
    'orders.read', 'orders.write', 'checkout', 'payments.write', 'refunds.write', 'refunds.void',
    'customers.read', 'customers.write',
    'categories.read', 'categories.write', 'products.read', 'products.write',
    'inventory.read', 'inventory.write', 'purchases.write',
    'expenses.read', 'expenses.write', 'employees.read', 'employees.write',
    'attendance.read', 'attendance.write', 'shifts.read', 'shifts.write',
    'reports.read', 'settings.read', 'daily-shifts.read', 'daily-shifts.write',
    'cash-registers.read', 'cash-registers.write',
    'audit.read', 'sync', 'users.read',
  ]),
  cashier: new Set([
    'orders.read', 'orders.write', 'checkout', 'payments.write',
    'customers.read', 'customers.write',
    'categories.read', 'products.read', 'inventory.read',
    'cash-registers.read', 'cash-registers.write',
    'sync',
  ]),
  kitchen: new Set([
    'orders.read', 'orders.write', 'products.read', 'categories.read', 'sync',
  ]),
  // device = مفتاح API المشترك (جهاز/نقل بيانات). نطاق محدود: عمليات نقطة البيع التشغيلية
  // والمزامنة والقراءة فقط. وليس عمليات إدارية (مستخدمين/إعدادات/تقارير/مراجعات/مخزون كتابة).
  device: new Set([
    'sync', 'checkout', 'orders.read', 'orders.write', 'order_items.read',
    'customers.read', 'customers.write', 'tables.read', 'tables.write',
    'categories.read', 'products.read', 'inventory.read', 'payments.read', 'payments.write',
    'settings.read', 'daily-shifts.read',
  ]),
};

// جداول حساسة أن كتابتها تتطلب صلاحيات إدارية (وليس device/cashier)
export const ADMIN_ONLY_STORES = new Set([
  'users', 'settings', 'audit_logs', 'daily_shifts', 'shifts', 'invitations',
  // C3-P0: مخازن مالية/مخزون لا تُزامَن إلا بهوية إدارية — الدفعات والاستردادات والمخزون
  // تُكتب على السيرفر حصرياً عبر checkout/void/إدارة المخزون، وليس عبر مزامنة جهاز عادي.
  'payments', 'refunds', 'inventory', 'stock_movements', 'cash_registers',
]);

export function roleHas(role: string, perm: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms.has('*')) return true;
  return perms.has(perm);
}

// ===== تحديد هوية الطلب =====
// يملأ req.identity: { kind: 'user'|'device', role, userId?, username? }
export interface Identity {
  kind: 'user' | 'device';
  role: string;
  userId?: number;
  username?: string;
  token?: string;
}

type AuthRequest = Request & { identity?: Identity };

// H1: ورقة اعتماد الجهاز = مفتاح مخصّص من البيئة (device-scoped)، وليس master key حرفياً في الواجهة.
// يُقبل DEVICE_API_KEY (المخصّص) و legacy API_KEY (نافذة هجرة) — كلاهما بنطاق device فقط.
export function getDeviceKeys(): string[] {
  const keys: string[] = [];
  const dk = process.env.DEVICE_API_KEY;
  if (dk) keys.push(dk);
  const legacy = process.env.API_KEY || '';
  if (legacy) keys.push(legacy);
  return keys;
}

export function resolveIdentity(req: AuthRequest): Identity | null {
  // 1) جلسة مستخدم (أولوية أعلى)
  const bearer = (req.headers['authorization'] as string) || '';
  const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim()
    : (req.headers['x-session-token'] as string) || undefined;
  const s = getSessionUser(sessionToken);
  if (s) {
    return { kind: 'user', role: s.role, userId: s.userId, username: s.username, token: s.token };
  }
  // 2) مفتاح جهاز (device-scoped) — DEVICE_API_KEY أو legacy API_KEY
  const key = (req.headers['x-api-key'] as string) || '';
  const deviceKeys = getDeviceKeys();
  if ((key && deviceKeys.includes(key)) || (bearer && deviceKeys.includes(bearer))) {
    return { kind: 'device', role: 'device' };
  }
  return null;
}

// Middleware: أي /api حساس يتطلب مصادقة (401 إن لم تُعرَف الهوية)
export function authRequired(req: AuthRequest, res: Response, next: NextFunction) {
  const identity = resolveIdentity(req);
  if (!identity) { res.status(401).json({ error: 'Unauthorized' }); return; }
  req.identity = identity;
  next();
}

// Middleware: يتطلب دوراً معيّناً (403 إن لم يكن لدى الهوية الدور)
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const identity = req.identity;
    if (!identity) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!roles.includes(identity.role)) { res.status(403).json({ error: 'Forbidden: insufficient role' }); return; }
    next();
  };
}

// هل المستخدم الحالي مطلوب منه تغيير كلمة المرور أولاً؟ (لا هوية بشرية → لا فحص)
function userMustChangePassword(identity: Identity | null): boolean {
  if (!identity || identity.kind !== 'user' || identity.userId == null) return false;
  try {
    const u = queryOne('SELECT mustChangePassword FROM users WHERE id = ?', [identity.userId]);
    return !!(u && Number(u.mustChangePassword) === 1);
  } catch { /* تجاهل */ return false; }
}

// Middleware: يمنع أي عملية (قراءة/كتابة) لمستخدم بعلامة mustChangePassword —
// يُستخدم للرواتر التي تكتفي بـ authRequired دون requirePermission (crud/special/batman/...).
export function requirePasswordChanged(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.identity) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (userMustChangePassword(req.identity)) {
    res.status(403).json({ error: 'Password change required (mustChangePassword)' }); return;
  }
  next();
}

// Middleware: يتطلب صلاحية معيّنة (403 إن لم تكن لدى الهوية)
export function requirePermission(perm: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const identity = req.identity;
    if (!identity) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!roleHas(identity.role, perm)) { res.status(403).json({ error: 'Forbidden: missing permission ' + perm }); return; }
    // H2: فرض تغيير كلمة مرور المدير ذات الكلمة الافتراضية قبل أي عملية مُميَّزة
    if (perm !== 'password.change' && userMustChangePassword(identity)) {
      res.status(403).json({ error: 'Password change required (mustChangePassword)' }); return;
    }
    next();
  };
}

export function getCurrentUser(req: AuthRequest): Record<string, unknown> | null {
  const id = req.identity;
  if (!id || id.kind !== 'user' || id.userId == null) return null;
  try {
    const u = queryOne('SELECT id, username, name, role, active, mustChangePassword FROM users WHERE id = ?', [id.userId]);
    return u || null;
  } catch { return null; }
}

export type { AuthRequest };
