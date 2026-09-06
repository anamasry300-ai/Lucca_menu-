import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { initDb, getDb, saveDb, closeDb, queryAll, queryOne, beginTransaction, commitTransaction, rollbackTransaction } from './db.js';
import crudRoutes from './routes/crud.js';
import specialRoutes from './routes/special.js';
import analyticsRoutes from './routes/analytics.js';
import authRoutes from './routes/auth.js';
import invitationRoutes from './routes/invitations.js';
import { authRequired, requirePermission, resolveIdentity, requireRole, AuthRequest, SESSION_COOKIE, ADMIN_ONLY_STORES, roleHas, getDeviceKeys } from './auth.js';

const PORT = parseInt(process.env.PORT || '3000');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

// مولّد هوية مزامنة مستقرة (يستخدمه السيرفر للصفوف التي ينشئها بنفسه مثل دفعات checkout)
function newSyncId(): string {
  return crypto.randomUUID();
}

// تتبّع رقم التسلسل اليومي الحر لأرقام الطلبات (ORD-YYYYMMDD-NNN)
function nextFreeOrderSeq(dateCompact: string): number {
  const rows = queryAll('SELECT orderNumber FROM orders WHERE orderNumber LIKE ?', [`ORD-${dateCompact}-%`]);
  let max = 0;
  for (const r of rows) {
    const m = /-(\d{1,6})$/.exec(String((r as any).orderNumber || ''));
    if (m) { const n = Number(m[1]); if (n > max) max = n; }
  }
  return max + 1;
}

// السيرفر هو مصدر الحقيقة لأرقام الطلبات: يزيل التكرارات (الناتجة عن العدّادات المحلية أوفلاين)
// ويكمل الأرقام الفارغة للطلبات المدفوعة بأحدث تسلسل حر — آمن التكرار (idempotent).
function normalizeOrderNumbers(): void {
  const db = getDb();
  const dateCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateCompact}-`;
  const used = new Set<string>();
  const rows = queryAll('SELECT id, orderNumber FROM orders WHERE orderNumber LIKE ? ORDER BY id', [`${prefix}%`]);
  for (const r of rows) {
    const num = String(r.orderNumber || '');
    if (!used.has(num)) { used.add(num); continue; }
    const cand = `${prefix}${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
    try { db.run('UPDATE orders SET orderNumber = ? WHERE id = ?', [cand, r.id]); used.add(cand); } catch (e) { /* ignore */ }
  }
  const empties = queryAll("SELECT id FROM orders WHERE (orderNumber IS NULL OR orderNumber = '') AND paymentStatus = 'paid'");
  for (const e of empties) {
    if (used.has('')) continue;
    const cand = `${prefix}${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
    try { db.run('UPDATE orders SET orderNumber = ? WHERE id = ?', [cand, e.id]); used.add(cand); } catch (e) { /* ignore */ }
  }
}

// === Rate Limiter (in-memory) ===
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 120; // requests per window
const RATE_LIMIT_AUTH_MAX = 10; // auth attempts per window

function rateLimit(windowMs = RATE_LIMIT_WINDOW, max = RATE_LIMIT_MAX) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
}

// === Security Headers ===
function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// === Input Sanitization (strip null bytes, limit string lengths) ===
function sanitizeInput(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\0/g, '').slice(0, 5000);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('__')) continue; // block prototype pollution
      sanitized[k] = sanitizeInput(v);
    }
    return sanitized;
  }
  return obj;
}

const app = express();

// Security headers first
app.use(securityHeaders);

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization', 'x-session-token'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// Input sanitization
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeInput(req.body);
  }
  next();
});

// Rate limiting on all API routes
app.use('/api', rateLimit());

// Stricter rate limit on auth-sensitive endpoints
app.use('/api/orders/:id/checkout', rateLimit(RATE_LIMIT_WINDOW, RATE_LIMIT_AUTH_MAX));

// التحميل العام غير المصادق: /api/auth/* (المصادقة عبر authRequired داخل المسارات)، و /health
// H1: /api/public-key = public configuration فقط، لا يُعيد أي secret إطلاقاً.
app.get('/api/public-key', (_req, res) => {
  // نُعيد بيانات عامة فعلية فقط — لا مفتاح/سر.
  res.json({ configured: true, secure: true, name: 'lucca', auth: 'session' });
});

app.get('/api/auth', (_req, res) => res.json({ status: 'auth-ok' }));
app.use('/api/auth', authRoutes);

// H1: تزويد كشك POS بمفتاح جهاز device-scoped — يتطلب جلسة admin (لا مفتاح/secret في السورس).
// يُزوَّد الكشك مرة عبر هذه الاستدعاء (مصادقة admin)، لا يُخزّن حرفياً في الواجهة، ويمكن تدويره دون إعادة نشر.
app.post('/api/auth/provision-device', authRequired, requireRole('admin'), (_req, res) => {
  const keys = getDeviceKeys();
  if (keys.length) res.json({ deviceKey: keys[0] });
  else res.status(500).json({ error: 'No device key configured (set DEVICE_API_KEY)' });
});

// H1: استعلام عن حالة الجهاز (admin) — لا يُعاد أي secret.
app.get('/api/auth/device-status', authRequired, requireRole('admin'), (_req, res) => {
  res.json({ configured: getDeviceKeys().length > 0 });
});

function apiKeyCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const p = (req.originalUrl || req.path || '').split('?')[0];
  // مسارات المصادقة تُدار بمعزل (تتطلب جلسة/مفتاح ضمن وسيطات authRequired)
  if (p.endsWith('/api/auth') || /\/api\/auth\//.test(p)) { next(); return; }
  // التحقق من الدعوة وإنشاء الحساب: عامة قبل الدخول (لا تعيد أي سر/كلمة مرور، البريد مثبّت للدعوة).
  if (/\/api\/invitations\/[^/]+\/(check|activate)$/.test(p)) { next(); return; }
  if (p.endsWith('/api/public-key')) { next(); return; }
  const identity = resolveIdentity(req as AuthRequest);
  if (identity) { next(); return; }
  res.status(401).json({ error: 'Unauthorized' });
}

app.use('/api', apiKeyCheck);

// تُركَّب دعوات الموظفين قبل special/analytics لأن مسارات check/activate عامة قبل الدخول،
// وهذه الرواتر (special/analytics) تفرض authRequired على مستوى الراوتر لكل /api/* —
// لو تُركِّبت بعدها لما وصلت check/activate إليها إطلاقاً (401). بقية مسارات الدعوة
// (الإنشاء) محمية داخلياً بـ requirePermission('employees.write').
app.use('/api', invitationRoutes);
app.use('/api', specialRoutes);
app.use('/api', analyticsRoutes);

// Sync: POST /api/sync
// Checkout endpoint: atomically close order and free table
app.post('/api/orders/:id/checkout', authRequired, requirePermission('checkout'), (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { paymentMethod } = req.body;

    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status === 'closed') { res.status(409).json({ error: 'Order is already closed' }); return; }

    beginTransaction();
    try {
      const total = (order.total as number) || 0;
      const method = paymentMethod || 'cash';
      const createdBy = (order.createdBy as string) || 'unknown';
      const today = new Date().toISOString().slice(0, 10);

      // 1. Generate order_number if missing (ORD-YYYYMMDD-NNN)
      let orderNumber = order.orderNumber as string;
      if (!orderNumber) {
        const dateCompact = today.replace(/-/g, '');
        orderNumber = `ORD-${dateCompact}-${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
      } else {
        // السيرفر هو مصدر الحقيقة: رقم مكرر اليوم (عميل أوفلاين) يُعاد توليده بتسلسل حر فريد
        const clash = queryOne('SELECT id FROM orders WHERE orderNumber = ? AND id != ?', [orderNumber, orderId]);
        if (clash) {
          const dateCompact = today.replace(/-/g, '');
          orderNumber = `ORD-${dateCompact}-${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
        }
      }

      // 2. Close the order with payment info
      db.run(
        'UPDATE orders SET status = ?, paymentMethod = ?, paymentStatus = ?, totalPaid = ?, changeAmount = ?, orderNumber = ? WHERE id = ?',
        ['closed', method, 'paid', total, 0, orderNumber, orderId]
      );

      // 3. Free the table if this is a dine-in order
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

// 4. Insert payment record (مع syncId/orderSyncId حتى يعكسه pull على جهاز آخر حال أُدرج الـ order عبر مزامنة)
      db.run(
        'INSERT INTO payments (orderId, amount, method, status, createdBy, syncId, orderSyncId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, total, method, 'completed', createdBy, newSyncId(), (order.syncId as string) || null]
      );

      // 5. Insert order items into order_items table
      const items = JSON.parse((order.items as string) || '[]');
      for (const item of items) {
        const itemTotal = item.total || (item.quantity || 1) * (item.unitPrice || item.price || 0);
        db.run(
          'INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orderId, item.productId || null, item.name || '', item.quantity || 1, item.unitPrice || item.price || 0, itemTotal, item.notes || '']
        );
      }

      // 6. Insert status history record
      db.run(
        "INSERT INTO order_status_history (orderId, status, changedBy, createdAt) VALUES (?, ?, ?, datetime('now'))",
        [orderId, 'closed', createdBy]
      );

      // 7. Update daily shift sales data
      const existingShift = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [today]);
      if (existingShift) {
        const cashSales = method === 'cash' ? (existingShift.cashSales as number || 0) + total : (existingShift.cashSales as number || 0);
        const cardSales = method !== 'cash' ? (existingShift.cardSales as number || 0) + total : (existingShift.cardSales as number || 0);
        const totalSales = (existingShift.totalSales as number || 0) + total;
        const orderCount = (existingShift.orderCount as number || 0) + 1;
        db.run(
          'UPDATE daily_shifts SET cashSales = ?, cardSales = ?, totalSales = ?, orderCount = ? WHERE date = ?',
          [cashSales, cardSales, totalSales, orderCount, today]
        );
      }

      commitTransaction();
      const closedOrder = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
      res.json({ success: true, order: closedOrder ? { ...closedOrder, items: JSON.parse((closedOrder.items as string) || '[]') } : null });
    } catch (e) {
      rollbackTransaction();
      throw e;
    }
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Void/Refund endpoint: إلغاء/استرداد طلب بصلاحية منفصلة (refunds.void — مدير/أدمن فقط)
// + سبب إلزامي + سجل تدقيق يحفظ الموظف الأصلي ومَن ألغى.
app.post('/api/orders/:id/void', authRequired, requirePermission('refunds.void'), (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { reason, note, refundMethod } = req.body || {};
    if (!reason || !String(reason).trim()) { res.status(400).json({ error: 'السبب إلزامي لا يمكن تركه فارغاً' }); return; }

    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status === 'cancelled') { res.status(409).json({ error: 'Order already voided' }); return; }

    const identity = (req as AuthRequest).identity;
    const cancellerUsername = (identity && identity.username) || 'unknown';
    let cancellerName = cancellerUsername;
    let cancellerRole = (identity && identity.role) || '';
    if (identity && identity.kind === 'user' && identity.userId != null) {
      try {
        const u = queryOne('SELECT name, role FROM users WHERE id = ?', [identity.userId]);
        if (u) {
          cancellerName = ((u.name as string) || cancellerUsername);
          cancellerRole = (u.role as string) || cancellerRole;
        }
      } catch { /* best-effort */ }
    }
    const originalBy = (order.createdBy as string) || 'unknown';
    const originalUserId = (order as any).userId ?? null;
    const total = (order.total as number) || 0;

    beginTransaction();
    try {
      // 1. Insert refund (مكتمل بياناته: الموظف الأصلي + مَن ألغى + السبب)
      db.run(
        'INSERT INTO refunds (orderId, amount, reason, note, refundMethod, createdBy, voidedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
        [orderId, total, String(reason).trim(), (note || '').trim(), refundMethod || order.paymentMethod || 'cash', originalBy, cancellerName]
      );

      // 2. Cancel the order with void metadata
      db.run(
        `UPDATE orders SET status = 'cancelled', voidReason = ?, voidNote = ?, voidedAt = datetime('now'),
           voidedBy = ?, paymentStatus = 'refunded', refundAmount = ? WHERE id = ?`,
        [String(reason).trim(), (note || '').trim(), cancellerName, total, orderId]
      );

      // 3. Free the table
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

      // 4. Status history
      db.run(
        "INSERT INTO order_status_history (orderId, status, changedBy, notes, createdAt) VALUES (?, ?, ?, ?, datetime('now'))",
        [orderId, 'cancelled', cancellerName, `reason: ${reason}, note: ${note || ''}`]
      );

      // 5. Audit with BOTH the original employee and the canceller (no silent void)
      try {
        db.run(
          `INSERT INTO audit_logs (action, objectType, objectId, oldValue, newValue, userName, createdAt)
           VALUES ('order.void_refund', 'orders', ?, ?, ?, ?, datetime('now'))`,
          [orderId,
           JSON.stringify({ total, status: order.status, createdBy: originalBy, userId: originalUserId }),
           JSON.stringify({ refundAmount: total, reason, note, cancelledBy: cancellerName, cancellerRole, originalEmployee: originalBy }),
           cancellerName]
        );
      } catch { /* audit may be unavailable */ }

      commitTransaction();
      const voided = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
      res.json({ success: true, order: voided ? { ...voided, items: JSON.parse((voided.items as string) || '[]') } : null });
    } catch (e) {
      rollbackTransaction();
      throw e;
    }
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Sync: POST /api/sync  (C2: دمج آمن — لا DELETE، لا استبدال أعمى)
// الهوية المستقرة = syncId (وليس autoincrement id). القرار:
//   - INSERT إذا لم يكن السجل موجوداً بالسيرفر
//   - SKIP إذا تطابق المحتوى
//   - UPDATE فقط إذا كانت النسخة المرسلة أحدث بشكل موثوق (version/revision أو فرق زمني خارج نافذة الغموض)
//   - CONFLICT (لا تُكتب) في كل حالة غموض أو تعارض دون نسخة أحدث موثوقة

const AMBIGUITY_MS = 5000; // التواريخ ضمن هذه النافذة غير موثوقة → CONFLICT
// مقارنة "نفس البيانات" من منظور السجل القادم فقط: نصحّب فقط الأعمدة التي يرسلها العميل،
// ونقارن قيمها مع ما هو مخزّن عند السيرفر (السيرفر قد يمتلك أعمدة default إضافية).
function sameData(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const skip = new Set(['id', 'syncId', 'updatedAt', 'updated_at', 'revision', 'version']);
  for (const k of Object.keys(incoming || {})) {
    if (skip.has(k)) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) === false) continue;
    const iv = incoming[k];
    const ev = existing[k];
    const norm = (x: unknown) => (x && typeof x === 'object') ? JSON.stringify(x) : String(x ?? '');
    if (norm(iv) !== norm(ev)) return false;
  }
  return true;
}
function tableNameFor(store: string): string | null {
  const candidate = store === 'tables' ? 'tables_store' : store;
  try {
    const rows = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [candidate]);
    return rows.length > 0 ? candidate : null;
  } catch { return null; }
}

// ===== PT12: توافق أعمدة بين العميل والسيرفر =====
// يرسل العميل حقولاً بأسماء قد لا تطابق أعمدة الجدول (مثل price بدل unitPrice للـ order_items).
// نترجم الأسماء عبر ALIAS، ونجلب قائمة الأعمدة الفعلية للجدول ونكتب الأعمدة الموجودة فعلاً فقط
// حتى لا يحدث "no such column" عند INSERT/UPDATE، مع الحفاظ على كل البيانات التاريخية.
const COLUMN_ALIASES: Record<string, Record<string, string>> = {
  order_items: { price: 'unitPrice' }
};

const _columnCache = new Map<string, string[]>();
function columnsFor(table: string): string[] {
  const cached = _columnCache.get(table);
  if (cached) return cached;
  let names: string[] = [];
  try {
    const rows = queryAll(`PRAGMA table_info(\`${table}\`)`);
    names = rows.map(r => String(r.name));
  } catch { names = []; }
  _columnCache.set(table, names);
  return names;
}
// يبني قائمة أعمدة صالحة للكتابة: يترجم الأسماء ثم يفلتر بالأعمدة الموجودة فعلاً في الجدول.
function validColumns(store: string, target: string, item: Record<string, unknown>): string[] {
  const tableCols = new Set(columnsFor(target));
  const alias = COLUMN_ALIASES[store] || {};
  const out: string[] = [];
  for (const k of Object.keys(item)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || k.length > 64) continue;
    const mapped = alias[k] || k;
    if (!tableCols.has(mapped)) continue; // تجاهل أعمدة غير موجودة بأمان (لا "no such column")
    if (out.indexOf(mapped) === -1) out.push(mapped);
  }
  return out;
}
// ترجمة قياسية لعمود واحد (تُستخدم في تحديث قيم الـ sameData/INSERT).
function mapKey(store: string, k: string): string {
  return (COLUMN_ALIASES[store] || {})[k] || k;
}

app.post('/api/sync', authRequired, requirePermission('sync'), (req, res) => {
  let db;
  const log = { inserted: 0, updated: 0, skipped: 0, conflicts: 0, conflictDetail: [] as any[] };
  try {
    db = getDb();
    const data = req.body || {};
    // H2: هوية الطلب — نمنع مزامنة المخازن الإدارية (users/settings/audit/daily_shifts/shifts)
    // إلا لهوية بصلاحية إدارية (admin/manager). مفتاح الجهاز (device) لا يمكنه تعديلها.
    const identity = resolveIdentity(req as AuthRequest);
    const isAdminish = identity ? (identity.role === 'admin' || identity.role === 'manager') : false;
    const stores = [
      'users', 'invitations', 'tables', 'tables_store', 'orders', 'customers', 'settings', 'inventory',
      'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'daily_shifts',
      'categories', 'products', 'product_modifiers', 'product_variations',
      'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs',
      'order_items', 'order_status_history', 'discounts',
      'invoices', 'suppliers', 'stock_movements', 'product_recipes', 'waste_log',
      'inventory_alerts', 'cash_registers'
    ];
    const processed = new Set<string>();
    beginTransaction();
    for (const store of stores) {
      const items = data[store];
      if (!Array.isArray(items)) continue;
      const target = tableNameFor(store);
      if (!target || processed.has(target)) continue;
      processed.add(target);

      // H2: المخازن الإدارية لا تُزامَن إلا بهوية إدارية (تمنع تعديل كلمات المرور/الإعدادات عبر مفتاح الجهاز)
      if (ADMIN_ONLY_STORES.has(store) && !isAdminish) {
        log.skipped += (items as unknown[]).length;
        log.conflictDetail.push({ store, skipped: items.length, reason: 'مخزن إداري — يلزم صلاحية إدارية' });
        continue;
      }

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const syncId = item.syncId as string | undefined;

        // إعادة ربط الأبوين: نستبدل معرف الأب الرقمي القادم من عميل آخر بالمعرف الصحيح على هذا الخادم
        // عبر الهوية المستقرة (orderSyncId). relationMap: [syncField, fkField, parentTable]
        const remapRule = (store === 'order_items' || store === 'payments' || store === 'refunds' ||
                           store === 'order_status_history' || store === 'invoices')
            ? ['orderSyncId', 'orderId', 'orders']
            : null;
        if (remapRule && item[remapRule[0]]) {
          try {
            const parent = queryOne(`SELECT id FROM \`${remapRule[2]}\` WHERE syncId = ?`, [item[remapRule[0]]]);
            if (parent) item[remapRule[1]] = parent.id;
          } catch { /* keep incoming value */ }
        }

        // F4: منع فتح وردية ثانية لنفس الصندوق على الخادم — لا يسمح بوجود أكثر من وردية مفتوحة
        // (مفتاح واحد: status='open') حتى لو جاءت بهوية مستقرة مختلفة (جهاز/كاشير آخر).
        // لا نستبدل ولا نحذف — نرفض الوردة الثانية ونسجّلها تعارضاً ليتحقق الجهاز محلياً.
        if (store === 'cash_registers' && item && item.status === 'open') {
          try {
            const openCount = queryOne("SELECT COUNT(*) as c FROM cash_registers WHERE status = 'open' ");
            if (openCount && Number(openCount.c) >= 1) {
              const rowSync = item.syncId as string | undefined;
              const already = rowSync
                ? queryOne("SELECT id FROM cash_registers WHERE syncId = ?", [rowSync])
                : undefined;
              if (!already) {
                log.conflicts++;
                log.conflictDetail.push({ syncId: rowSync || null, reason: 'وردية أخرى مفتوحة فعلاً — لا يمكن فتح وردية ثانية', store });
                continue;
              }
            }
          } catch { /* توافق مع قواعد قديمة */ }
        }

        // PT12: بناء نسخة معيارية من الأعمدة — تُترجم الأسماء (price→unitPrice) وتُكتب
        // فقط الأعمدة الموجودة فعلاً في الجدول (يمنع "no such column" ولا يفقد بيانات تاريخية).
        const tableCols = new Set(columnsFor(target));
        const alias = COLUMN_ALIASES[store] || {};
        const cols: string[] = [];
        const vals: unknown[] = [];
        const normItem: Record<string, unknown> = {};
        for (const k of Object.keys(item)) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || k.length > 64) continue;
          const mapped = alias[k] || k;
          if (mapped === 'id') continue;
          if (!tableCols.has(mapped)) continue;
          if (cols.indexOf(mapped) === -1) { cols.push(mapped); vals.push(item[k]); }
          normItem[mapped] = item[k];
        }
        if (cols.length === 0) continue;

        // 1) هل السجل موجود بالسيرفر (بالهوية المستقرة)؟
        let existing: Record<string, unknown> | undefined;
        if (syncId) {
          try { existing = queryOne(`SELECT * FROM \`${target}\` WHERE syncId = ?`, [syncId]); } catch { existing = undefined; }
        }
        // fallback: نبحث بالـ id الرقمي فقط للتوافق مع البيانات القديمة،
        // وبشرط أن يكون الوارد بلا syncId والسجل القديم على السيرفر بلا syncId أيضاً.
        // (يمنع دمج سجل جديد يحمل syncId مختلف مع سجل سيرفر آخر عبر اتفاق معرفات autoincrement المحلية)
        if (!existing && !syncId && item.id != null) {
          try {
            const legacy = queryOne(`SELECT * FROM \`${target}\` WHERE id = ?`, [item.id]);
            if (legacy && !legacy.syncId) existing = legacy;
          } catch { existing = undefined; }
        }

        // 2) دمج
        if (!existing) {
          // INSERT — لا نستورد id الرقمي من عميل آخر (نترك autoincrement يعيّن id محلياً صحيحاً)
          const c = cols.map(k => `\`${k}\``).join(', ');
          const v = cols.map(() => '?').join(', ');
          try {
            db.run(`INSERT INTO \`${target}\` (${c}) VALUES (${v})`, vals);
            log.inserted++;
          } catch (e) { log.conflicts++; log.conflictDetail.push({ syncId, reason: 'فشل إدراج: ' + (e as Error).message, store }); }
        } else if (sameData(existing, normItem)) {
          log.skipped++;
        } else {
          // تحديث موثوق فقط
          const lv = normItem.version != null ? normItem.version : normItem.revision;
          const sv = existing.version != null ? existing.version : existing.revision;
          let newer: 'incoming' | 'existing' | null = null;
          if (lv != null && sv != null && lv !== sv) newer = lv > sv ? 'incoming' : 'existing';
          if (!newer) {
            const it = normItem.updatedAt || normItem.updated_at;
            const et = existing.updatedAt || existing.updated_at;
            if (it && et) {
              const a = new Date(String(et)).getTime();
              const b = new Date(String(it)).getTime();
              if (!Number.isNaN(a) && !Number.isNaN(b)) {
                const d = b - a;
                if (Math.abs(d) >= AMBIGUITY_MS) newer = d > 0 ? 'incoming' : 'existing';
              }
            }
            if (!newer) { if (et && !it) newer = 'existing'; if (!et && it) newer = 'incoming'; }
          }
          if (newer === 'incoming') {
            const set = cols.map(k => `\`${k}\` = ?`).join(', ');
            try {
              db.run(`UPDATE \`${target}\` SET ${set} WHERE id = ?`, [...vals, existing.id]);
              log.updated++;
            } catch (e) { log.conflicts++; log.conflictDetail.push({ syncId, reason: 'فشل تحديث: ' + (e as Error).message, store }); }
          } else {
            // لا نكتب: إما النسخة المحلية أحدث أو غموض تعارض
            log.conflicts++;
            log.conflictDetail.push({ syncId, reason: newer === 'existing' ? 'النسخة المحلية أحدث' : 'تعارض بلا نسخة أحدث موثوقة', store });
          }
        }
      }
    // PT-FKRelink: بعد دمج الدفعة، تُعاد ربط أبناء orders بالمفتاح الخارجي الصحيح
      // (orderId الحقيقي للسيرفر) عبر orderSyncId. العميل دائماً يرسل orderSyncId، وبدون هذا الربط
      // قد ترتبط order_items/payments/invoices بصفوف orders ذات معرفات رقمية محلية غريبة عن السيرفر.
      const FK_CHILDREN = ['order_items', 'payments', 'invoices', 'refunds', 'order_status_history'];
      for (const t of FK_CHILDREN) {
        try {
          db.run(
            `UPDATE \`${t}\` SET orderId = (SELECT o.id FROM orders o WHERE o.syncId = \`${t}\`.orderSyncId)
             WHERE orderSyncId IS NOT NULL AND orderSyncId != ''`
          );
        } catch { /* child table/column may not exist */ }
      }
      // PT-OrderNumberNormalize: أرقام طلبات فريدة لكل يوم (السيرفر مصدر الحقيقة — يعالج طلبات أوفلاين المدفوعة)
      try { normalizeOrderNumbers(); } catch { /* لا تُوقف الدمج إن تعذّرت الكتابة */ }
    }
    commitTransaction();
    // تسجيل سجل المزامنة (sync_log)
    try {
      db.run(
        'INSERT INTO sync_log (direction, inserted, updated, skipped, conflicts, conflictDetail, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['push', log.inserted, log.updated, log.skipped, log.conflicts, JSON.stringify(log.conflictDetail), 'دمج آمن من العميل']
      );
      saveDb();
    } catch { /* sync_log قد لا يوجد في قاعدة قديمة جداً */ }
    res.json({ success: true, message: '✅ تم دمج البيانات (Safe Sync)', log });
  } catch (e: unknown) {
    if (db) rollbackTransaction();
    res.status(500).json({ error: (e as Error).message });
  }
});

// === Aggregation Endpoints ===
app.get('/api/reports/summary', authRequired, requirePermission('reports.read'), (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const orders = queryAll(
      "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid'",
      [from, to]
    );
    const expenses = queryAll(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(date) >= ? AND date(date) <= ?",
      [from, to]
    );
    const refunds = queryAll(
      "SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
      [from, to]
    );
    const payments = queryAll(
      "SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' GROUP BY method",
      [from, to]
    );
    const topItems = queryAll(
      "SELECT oi.name, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.orderId = o.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY oi.name ORDER BY revenue DESC LIMIT 10",
      [from, to]
    );
    const dailySales = queryAll(
      "SELECT date(date) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid' GROUP BY date(date) ORDER BY date(date)",
      [from, to]
    );
    res.json({
      orders: orders[0] || { count: 0, revenue: 0, avgOrder: 0 },
      expenses: (expenses[0] || {}).total || 0,
      refunds: (refunds[0] || {}).total || 0,
      payments,
      topItems,
      dailySales
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/reports/sales-by-category', authRequired, requirePermission('reports.read'), (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const rows = queryAll(
      "SELECT COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') as category, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id JOIN orders o ON oi.orderId = o.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') ORDER BY revenue DESC",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.use('/api', crudRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Lucca Backend running on http://localhost:${PORT}`);
  });
});

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
