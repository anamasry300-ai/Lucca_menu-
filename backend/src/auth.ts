import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { queryOne, getDb } from './db.js';

// ===== إعدادات الأمان =====
// توقيع الجلسات: سرّ مأخوذ من البيئة أو قيمة افتراضية (يُفضَّل ضبطه في .env في الإنتاج)
const SESSION_SECRET = process.env.SESSION_SECRET || 'lucca-session-secret-change-me';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || String(12 * 60 * 60 * 1000)); // 12 ساعة
export const SESSION_COOKIE = 'lucca_session';

// ===== تخزين الجلسات في الذاكرة (قصير الأجل) =====
interface Session {
  token: string;
  userId: number;
  username: string;
  role: string;
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, Session>();

function now(): number { return Date.now(); }

// تنظيف الجلسات المنتهية (يُستدعى عند كل تحقق)
function sweepSessions() {
  const t = now();
  for (const [token, s] of sessions) { if (s.expiresAt <= t) sessions.delete(token); }
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

// ===== إنشاء/تحقق/إبطال الجلسة =====
export function createSession(user: { id: number; username: string; role: string }): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    token, userId: user.id, username: user.username, role: user.role,
    createdAt: now(), expiresAt: now() + SESSION_TTL_MS,
  });
  return token;
}

export function getSessionUser(token: string | undefined): Session | null {
  if (!token) return null;
  sweepSessions();
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt <= now()) { sessions.delete(token); return null; }
  return s;
}

export function destroySession(token: string | undefined) {
  if (token) sessions.delete(token);
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
  const legacy = process.env.API_KEY || 'lucca-secret-key';
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

// Middleware: يتطلب صلاحية معيّنة (403 إن لم تكن لدى الهوية)
export function requirePermission(perm: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const identity = req.identity;
    if (!identity) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!roleHas(identity.role, perm)) { res.status(403).json({ error: 'Forbidden: missing permission ' + perm }); return; }
    // H2: فرض تغيير كلمة مرور المدير ذات الكلمة الافتراضية قبل أي عملية مُميَّزة
    if (identity.kind === 'user' && identity.userId != null && perm !== 'password.change') {
      try {
        const u = queryOne('SELECT mustChangePassword FROM users WHERE id = ?', [identity.userId]);
        if (u && Number(u.mustChangePassword) === 1) {
          res.status(403).json({ error: 'Password change required (mustChangePassword)' }); return;
        }
      } catch { /* تجاهل */ }
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
