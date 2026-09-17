import { Router, Request, Response } from 'express';
import { getDb, saveDb, queryAll, queryOne, insert, getLastInsertId, beginTransaction, commitTransaction, rollbackTransaction } from '../db.js';
import { authRequired, requirePasswordChanged, AuthRequest, roleHas } from '../auth.js';
import { restoreStockAfterVoid } from '../stock.js';

const VALID_COL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const router = Router();

// ===== H2: تفويض (Authorization) على الخادم =====
// ===== H3: توحيد تطبيق التفويض على خريطة ROLE_PERMISSIONS (مصدر حقيقة واحد) =====
router.use(authRequired as any);
router.use(requirePasswordChanged as any);

function isAdminish(req: AuthRequest): boolean {
  const id = req.identity;
  return !!id && (id.role === 'admin' || id.role === 'manager');
}

// ===== H3: قراءة المخازن =====
// القراءة الوظيفية (POS/المزامنة pull) تبقى متاحة لكل هوية موثَّقة كما في وضع H2/C2،
// عدا المخازن الحساسة التي يقرؤها الإداري/المدير فقط:
//   users (تسريب hashes كلمات المرور)، audit_logs (سجل نشاط)، daily_shifts/shifts (إدارة كاش).
// المصدر: ROLE_PERMISSIONS (auth.ts) + متطلبات ظهور POS.
const READ_RESTRICTED = new Set(['users', 'audit_logs', 'daily_shifts', 'shifts']);

// مخازن إدارية حساسة: الكتابة/الحذف عليها إداري/مدير فقط (كما في H2)
// P1: 'refunds' أُزيل من هنا — مسار الاسترداد الصريح أصبح مسموحاً للمدير (صلاحية refunds.write)
//     (ويبقى محجوباً على الكاشير/الجهاز لأن دورهما بلا تلك الصلاحية).
const WRITE_ADMIN_STORES = new Set([
  'users', 'settings', 'audit_logs', 'daily_shifts', 'shifts', 'suppliers', 'stock_movements', 'inventory_alerts'
]);

// خريطة كل مخزن → صلاحية كتابته. المصدر: ROLE_PERMISSIONS (auth.ts).
// تُطبَّق على الأدوار المحدودة (device/cashier/kitchen) لمنع كتابة مخازن للقراءة فقط.
// admin/manager يحتفظان بسلوك H2 (يُمنعان فقط عن المخازن الإدارية الحساسة) تفادياً لإقفال سير عمل المدير.
const STORE_WRITE_PERM: Record<string, string> = {
  'tables': 'tables.write', 'tables_store': 'tables.write', 'orders': 'orders.write',
  'customers': 'customers.write',
  'inventory': 'inventory.write', 'employees': 'employees.write',
  'attendance': 'attendance.write', 'expenses': 'expenses.write', 'shifts': 'shifts.write',
  'daily_shifts': 'daily-shifts.write', 'categories': 'categories.write', 'products': 'products.write',
  'product_modifiers': 'products.write', 'product_variations': 'products.write',
  'product_recipes': 'products.write',
  'payment_methods': 'payments.write', 'payments': 'payments.write',
  'purchases': 'purchases.write', 'refunds': 'refunds.write',
  'cash_registers': 'cash-registers.write',
};

// منع القراءة: إداري/مدير فقط للمخازن الحساسة؛ device يقرأ settings؛ بقية المخازن وظيفية (POS/pull)
function readDenied(req: AuthRequest, store: string): boolean {
  const id = req.identity;
  if (!id) return true;
  if (id.role === 'admin') return false;
  if (READ_RESTRICTED.has(store)) return !isAdminish(req); // users/audit/daily_shifts/shifts حساسة
  if (store === 'settings') return !(id.role === 'manager' || id.role === 'device'); // device يقرأ الإعدادات
  return false; // أي هوية موثَّقة تقرأ بقية المخازن الوظيفية (نمط H2 + sync pull)
}
// منع الكتابة:
//  - admin: الكل مسموح.
//  - manager (إداري/مدير، غير admin): يُمنع فقط عن المخازن الإدارية الحساسة (سلوك H2 — لا إقفال لسير عمل المدير).
//  - device/cashier/kitchen (أدوار محدودة): يُقيَّدون بصلاحية كتابة المخزن من ROLE_PERMISSIONS
//    → لا يستطيعون كتابة مخازن للقراءة فقط (inventory/products/categories...) — إصلاح R1/R2.
function writeDenied(req: AuthRequest, store: string): boolean {
  const id = req.identity;
  if (!id) return true;
  if (id.role === 'admin') return false;
  if (store === 'users') return true; // لا يُنشأ عبر CRUD أصلاً
  if (isAdminish(req)) return WRITE_ADMIN_STORES.has(store); // إداري/مدير
  const perm = STORE_WRITE_PERM[store];
  if (!perm) return true; // دور محدود لا يكتب مخزناً غير مقيّد (إداري/مدير فقط)
  return !roleHas(id.role, perm);
}
// الحذف عمومي: إداري/مدير فقط (لا دور محدود يملك إزالة)
function deleteDenied(req: AuthRequest): boolean {
  return !isAdminish(req);
}

function storeFor(req: Request): string {
  return req.params.store as string;
}

const VALID_TABLE_STATUSES = new Set(['available', 'occupied', 'reserved', 'cleaning', 'closed']);
const VALID_ORDER_STATUSES = new Set(['pending', 'in_preparation', 'ready', 'served', 'completed', 'cancelled', 'closed']);
// C3-P0: حالات الطلب "قيد العمل" — فقط هذه تُنشأ/تُعدَّل عبر CRUD؛ الإقفال/الدفع حصري عبر checkout/void
const ORDER_WORKING_STATUSES = new Set(['pending', 'in_preparation', 'ready', 'served']);
const PAYMENT_TERMINAL_SET = new Set(['paid', 'refunded']);
// C3-P0: حقول مالية محلورة في الطلب لا تتغيّر عبر CRUD (تحددها /checkout و /void)
const ORDER_MONEY_IMMUTABLE = ['totalPaid', 'paidAmount', 'changeAmount', 'paymentMethod', 'paymentMethodId'];
const JSON_COLUMNS = new Set(['items', 'modifiers']);

function parseRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof val === 'string') {
      try { obj[key] = JSON.parse(val as string); } catch { obj[key] = val; }
    } else {
      obj[key] = val;
    }
  }
  // Fix corrupted items: convert {"0":0,"1":0} object → []
  if (obj.items !== undefined && obj.items !== null && !Array.isArray(obj.items)) {
    const raw = obj.items as Record<string, unknown>;
    const isNumericKeyed = typeof raw === 'object' && Object.keys(raw).every(k => /^\d+$/.test(k));
    if (isNumericKeyed && Object.values(raw).every(v => v === 0 || v === null || v === '')) {
      obj.items = [];
    }
  }
  // PT12: تُرجع order_items للعميل باسم الحقل الذي يتوقعه العميل (price بدل unitPrice)
  if (table === 'order_items') {
    if (obj.unitPrice !== undefined && obj.price === undefined) {
      obj.price = obj.unitPrice;
    }
  }
  return obj;
}

function serializeRow(obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    if (JSON_COLUMNS.has(key) && Array.isArray(val)) {
      row[key] = JSON.stringify(val);
    } else {
      row[key] = val;
    }
  }
  return row;
}

// C3-P0: اسم الفاعل من هوية الطلب (للتدقيق التوثيقي بدلاً من 'system' العامة)
function actorName(req: Request): string {
  const id = (req as AuthRequest).identity;
  return (id && id.username) || (id && id.role) || 'unknown';
}

// C3-P0: هل الطلب مدفوع/مغلق/ملغى؟ (العرض الختامي — أي كتابة لاحقة = 409)
function isOrderPaidOrClosed(row: Record<string, unknown>): boolean {
  const status = String(row.status || '');
  const ps = String(row.paymentStatus || '');
  if (status === 'closed' || status === 'completed' || status === 'cancelled') return true;
  return ps === 'paid' || ps === 'refunded';
}

// C3-P0: الإجمالي المتوقع من الأصناف والخصم والضريبة — يمنع كتابة total عشوائي (إجبار الحساب الصحيح)
function computeExpectedTotal(data: Record<string, unknown>, existing?: Record<string, unknown>): number | null {
  const pick = (k: string) => data[k] !== undefined ? data[k] : (existing ? existing[k] : undefined);
  const subtotal = Number(pick('subtotal'));
  if (!Number.isFinite(subtotal)) return null;
  const discount = Number(pick('discount') || 0);
  const tax = Number(pick('tax') || 0);
  const discountType = String(pick('discountType') || 'percent');
  const discountAmount = discountType === 'fixed' ? discount : subtotal * (discount / 100);
  return subtotal - discountAmount + tax;
}

function recordAuditLog(action: string, objectType: string, objectId: string | number, newValue?: unknown, userName = 'system') {
  try {
    const db = getDb();
    db.run(
      "INSERT INTO audit_logs (action, objectType, objectId, newValue, userName, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [action, objectType, String(objectId), typeof newValue === 'string' ? newValue : JSON.stringify(newValue || ''), userName || 'system']
    );
  } catch (_) { /* audit logging is best-effort */ }
}

// C3-P0: تدقيق الرفض المالي المصرَّح به (حتى يعرف المدير أن محاولةً رُفضت ولم تُنفَّذ أبداً)
function auditReject(req: Request, store: string, id: string | number, reason: string) {
  recordAuditLog(`${store}.rejected`, store, id, JSON.stringify({ reason, attemptedBy: actorName(req) }), actorName(req));
}

const SAFE_TABLES = new Set([
  'users', 'tables', 'tables_store', 'orders', 'customers',
  'inventory', 'purchases', 'employees', 'attendance',
  'expenses', 'shifts', 'daily_shifts',
  'categories', 'products', 'product_modifiers', 'product_variations',
  'payment_methods', 'taxes', 'payments', 'refunds',
  'order_items', 'order_status_history', 'audit_logs', 'discounts',
  // PT13: collections مؤكَّدة الوجود في schema السيرفر (db.ts) والمضافة إلى sync/backup
  'invoices', 'suppliers', 'stock_movements', 'product_recipes', 'waste_log', 'settings', 'inventory_alerts',
  'cash_registers'
]);

const STORE_TABLE_MAP: Record<string, string> = {
  tables: 'tables_store'
};

const STORE_ORDER_BY: Record<string, string> = {
  daily_shifts: 'date DESC',
  settings: 'key'
};

function tableNameForStore(store: string): string {
  return STORE_TABLE_MAP[store] || store;
}

function orderByForStore(store: string): string {
  return STORE_ORDER_BY[store] || 'id';
}

router.get('/:store', (req: Request, res: Response) => {
  const store = storeFor(req);
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  if (readDenied(req as AuthRequest, store)) { res.status(403).json({ error: 'Forbidden' }); return; }
  try {
    const table = tableNameForStore(store);
    const rows = queryAll(`SELECT * FROM \`${table}\` ORDER BY ${orderByForStore(store)}`);
    res.json(rows.map(r => parseRow(store, r)));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/:store/:id', (req: Request, res: Response) => {
  const store = storeFor(req);
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  if (readDenied(req as AuthRequest, store)) { res.status(403).json({ error: 'Forbidden' }); return; }
  try {
    const table = tableNameForStore(store);
    const row = queryOne(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(parseRow(store, row));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/:store', (req: Request, res: Response) => {
  const store = req.params.store as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  if (writeDenied(req as AuthRequest, store)) { res.status(403).json({ error: 'Forbidden' }); return; }
  // Prevent direct user creation via generic CRUD (use dedicated endpoint)
  if (store === 'users') { res.status(403).json({ error: 'Cannot create users via generic endpoint' }); return; }
  try {
    const data = serializeRow(req.body);
    const table = tableNameForStore(store);

    // Validation for orders: check for duplicate active orders on same table
    if (store === 'orders' && data.status === 'pending') {
      const tableId = data.tableId;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        const existing = queryAll(
          "SELECT id FROM orders WHERE tableId = ? AND status IN ('pending', 'in_preparation', 'ready', 'served')",
          [String(tableId)]
        );
        if (existing.length > 0) {
          res.status(409).json({ error: 'Table already has an active order', existingOrderId: existing[0].id });
          return;
        }
      }
    }

    // Validation for tables: validate status
    if (store === 'tables' && data.status && !VALID_TABLE_STATUSES.has(data.status as string)) {
      res.status(400).json({ error: `Invalid table status: ${data.status}. Must be one of: ${[...VALID_TABLE_STATUSES].join(', ')}` });
      return;
    }

    // Validation for orders: validate status
    if (store === 'orders' && data.status && !VALID_ORDER_STATUSES.has(data.status as string)) {
      res.status(400).json({ error: `Invalid order status: ${data.status}` });
      return;
    }

    // C3-P0: لا يُنشأ طلب مغلق/مدفوع عبر CRUD — الإقفال/الدفع حصري عبر /checkout و /void
    if (store === 'orders') {
      const hasTerminalStatus = data.status && !ORDER_WORKING_STATUSES.has(data.status as string);
      const hasTerminalPay = data.paymentStatus && PAYMENT_TERMINAL_SET.has(data.paymentStatus as string);
      const markedPaid = data.paid === true || data.paid === 1 || data.paid === 'true';
      if (hasTerminalStatus || hasTerminalPay || markedPaid) {
        auditReject(req, 'orders', String(data.orderId ?? ''), 'محاولة إنشاء طلب مغلق/مدفوع عبر CRUD');
        res.status(409).json({ error: 'لا يمكن إنشاء طلب مغلق/مدفوع عبر CRUD — استخدم /checkout للتحصيل و /void للإلغاء' });
        return;
      }
    }

    // C3-P0: الدفعات لا تُسجَّل عبر CRUD — المصدر الوحيد هو /checkout (المعاملة الكاملة على الخادم)
    if (store === 'payments') {
      auditReject(req, 'payments', String(data.orderId ?? ''), 'محاولة إضافة دفعة عبر CRUD');
      res.status(409).json({ error: 'لا يمكن إضافة دفعات عبر CRUD — التحصيل حصري عبر /checkout' });
      return;
    }

    // C3-P0: استرداد نقدي مُتحقق منه فقط: سبب + قيمة موجبة ≤ صافي المدفوع + طلب مدفوع فعلاً
    if (store === 'refunds') {
      const amount = Number(data.amount || 0);
      const reason = String(data.reason || '').trim();
      if (!reason) {
        auditReject(req, 'refunds', String(data.orderId ?? ''), 'استرداد بدون سبب');
        res.status(409).json({ error: 'سبب الاسترداد إلزامي ولا يمكن تركه فارغاً' }); return;
      }
      if (!(amount > 0)) {
        auditReject(req, 'refunds', String(data.orderId ?? ''), 'استرداد بقيمة غير موجبة');
        res.status(409).json({ error: 'قيمة الاسترداد يجب أن تكون أكبر من صفر' }); return;
      }
      if (data.orderId != null) {
        const refundOrder = queryOne('SELECT total, totalPaid, paymentStatus FROM orders WHERE id = ?', [data.orderId]);
        if (!refundOrder) {
          auditReject(req, 'refunds', String(data.orderId ?? ''), 'استرداد لطلب غير موجود');
          res.status(400).json({ error: 'الطلب المرتبط غير موجود' }); return;
        }
        if (String(refundOrder.paymentStatus || '') !== 'paid') {
          auditReject(req, 'refunds', String(data.orderId ?? ''), 'استرداد لطلب غير مدفوع');
          res.status(409).json({ error: 'لا يمكن استرداد طلب غير مدفوع — أكمِل الدفع أولاً عبر /checkout' }); return;
        }
        const netPaid = Number(refundOrder.totalPaid) || Number(refundOrder.total) || 0;
        if (amount > netPaid) {
          auditReject(req, 'refunds', String(data.orderId ?? ''), `استرداد ${amount} > صافي المدفوع ${netPaid}`);
          res.status(409).json({ error: 'قيمة الاسترداد أكبر من صافي المدفوع للطلب' }); return;
        }
        // P1: مجموع الاستردادات السابقة + هذه الاسترداد يجب ألا يتجاوز صافي المدفوع — يمنع الاسترداد المزدوج
        let alreadyRefunded = 0;
        try {
          const agg = queryOne('SELECT COALESCE(SUM(amount), 0) AS s FROM refunds WHERE orderId = ?', [data.orderId]);
          alreadyRefunded = Number(agg && agg.s) || 0;
        } catch { /* جدول قديم بلا refunds */ }
        if (alreadyRefunded + amount > netPaid) {
          auditReject(req, 'refunds', String(data.orderId ?? ''), `استرداد مزدوج: مجموع ${alreadyRefunded} + ${amount} > ${netPaid}`);
          res.status(409).json({ error: `مجموع الاستردادات (${(alreadyRefunded + amount).toFixed(2)}) يتجاوز صافي المدفوع (${netPaid.toFixed(2)}) — توقف، لا يُسمح بالاسترداد المزدوج` }); return;
        }
      }
    }

    // F4: منع فتح وردية كاش ثانية على نفس الصندوق (لا يُسمح بأكثر من وردية مفتوحة)
    if (store === 'cash_registers' && data.status === 'open') {
      const openCount = queryOne("SELECT COUNT(*) as c FROM cash_registers WHERE status = 'open' ");
      if (openCount && Number(openCount.c) >= 1) {
        res.status(409).json({ error: 'يوجد صندوق مفتوح بالفعل — أغلقه أولاً.' });
        return;
      }
    }

    const safeKeys = Object.keys(data).filter(k => VALID_COL_RE.test(k) && k.length <= 64);
    if (safeKeys.length === 0) { res.status(400).json({ error: 'No valid columns' }); return; }
    const cols = safeKeys.map(k => `\`${k}\``).join(', ');
    const vals = safeKeys.map(() => '?').join(', ');

    let id: number;
    if (store === 'orders') {
      beginTransaction();
      try {
        id = insert(`INSERT INTO \`${store}\` (${cols}) VALUES (${vals})`, safeKeys.map(k => data[k]));
        // If this order is for a table, update table status
        if (data.tableId && data.tableId !== 'takeaway' && !isNaN(Number(data.tableId)) && data.status === 'pending') {
          const db = getDb();
          db.run(
            'UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?',
            ['occupied', id, Number(data.tableId)]
          );
        }
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else if (store === 'tables') {
      // Use INSERT OR REPLACE for tables to prevent duplicate key errors
      beginTransaction();
      try {
        const db = getDb();
        const placeholders = safeKeys.map(() => '?').join(', ');
        db.run(
          `INSERT OR REPLACE INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
          safeKeys.map(k => data[k])
        );
        saveDb();
        id = (data.id as number) || 0;
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else if (store === 'refunds') {
      // P1: الاسترداد الصريح داخل معاملة: يُسجَّل الاسترداد ثم تعاد مخزون الوصفات/الأصناف
      // التي خصمها التحصيل — مرة واحدة فقط (كل حركة sale للطلب ← حركة return واحدة).
      beginTransaction();
      try {
        const db = getDb();
        id = insert(`INSERT INTO \`${table}\` (${cols}) VALUES (${vals})`, safeKeys.map(k => data[k]));
        if (data.orderId != null) {
          restoreStockAfterVoid(String(data.orderId));
        }
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else {
      id = insert(`INSERT INTO \`${table}\` (${cols}) VALUES (${vals})`, safeKeys.map(k => data[k]));
    }

    const created = queryOne(`SELECT * FROM \`${table}\` WHERE id = ?`, [id || getLastInsertId()]);
    recordAuditLog('create', store, id || getLastInsertId(), created);
    res.status(201).json(created ? parseRow(store, created) : { id });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.put('/:store/:id', (req: Request, res: Response) => {
  const store = storeFor(req);
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  if (writeDenied(req as AuthRequest, store)) { res.status(403).json({ error: 'Forbidden' }); return; }
  try {
    const data = serializeRow(req.body);
    const table = tableNameForStore(store);
    const allKeys = Object.keys(data);
    const keys = allKeys.filter(k => VALID_COL_RE.test(k) && k.length <= 64);
    if (keys.length === 0) { res.json({ success: true }); return; }

    // C3-P0: الدفعات لا تُعدَّل عبر CRUD — التحصيل حصري عبر /checkout و /void
    if (store === 'payments') {
      auditReject(req, 'payments', id, 'محاولة تعديل دفعة عبر CRUD');
      res.status(409).json({ error: 'لا يمكن تعديل الدفعات عبر CRUD — التحصيل حصري عبر /checkout' });
      return;
    }

    // C3-P0: قيود الطلبات — لا إغلاق/دفع عبر CRUD، ولا تغيير أموال محلورة، وإجبار الحساب الصحيح للإجمالي
    let existingOrder: Record<string, unknown> | undefined;
    if (store === 'orders') {
      existingOrder = queryOne('SELECT * FROM orders WHERE id = ?', [id]);
      if (!existingOrder) { res.status(404).json({ error: 'Order not found' }); return; }
      // طلب مدفوع/مغلق/ملغى لا يُعدَّل ولا يُنقل (لا صمت — 409 صريح)
      if (isOrderPaidOrClosed(existingOrder)) {
        auditReject(req, 'orders', id, 'محاولة تعديل طلب مدفوع/مغلق');
        res.status(409).json({ error: 'الطلب مدفوع/مغلق — لا يُعدَّل عبر CRUD (التحصيل/الإلغاء عبر /checkout و /void)' });
        return;
      }
      const incStatus = data.status ? String(data.status) : '';
      const incPay = data.paymentStatus ? String(data.paymentStatus) : '';
      const markedPaid = data.paid === true || data.paid === 1 || data.paid === 'true';
      if ((incStatus && !ORDER_WORKING_STATUSES.has(incStatus)) || (incPay && PAYMENT_TERMINAL_SET.has(incPay)) || markedPaid) {
        auditReject(req, 'orders', id, `حالة/دفع نافذ مردود: status=${incStatus} paymentStatus=${incPay} paid=${String(data.paid)}`);
        res.status(409).json({ error: 'لا يمكن إغلاق/دفع طلب عبر CRUD — استخدم /checkout للتحصيل و /void للإلغاء' });
        return;
      }
      // حقول مالية محلورة — لا تتغيّر يدوياً (متغيراتها تحددها /checkout و /void فقط)
      for (const k of ORDER_MONEY_IMMUTABLE) {
        if (data[k] === undefined) continue;
        const exV = existingOrder[k] === undefined || existingOrder[k] === null ? '' : String(existingOrder[k]);
        if (k === 'paymentMethod' && !exV) continue; // لم تُحدَّد بعد — يُسمح بالتثبيت لأول مرة
        const inf = Number(data[k]);
        const exf = Number(existingOrder[k]);
        if (Number.isFinite(inf) && Number.isFinite(exf)) {
          if (Math.abs(inf - exf) < 0.01) continue;
        } else if (String(data[k]) === exV) {
          continue;
        }
        auditReject(req, 'orders', id, `تغيير يدوي للحقل المالي "${k}" (${exV} → ${String(data[k])})`);
        res.status(409).json({ error: `لا يمكن تغيير "${k}" يدوياً عبر CRUD — يُحدَّد هذا الحقل من /checkout أو /void` });
        return;
      }
      // الإجمالي يجب أن يطابق الحساب: الأصناف − الخصم + الضريبة (يمنع تعميد total = 0 بالشباك)
      const expectedTotal = computeExpectedTotal(data, existingOrder);
      if (data.total !== undefined && expectedTotal != null && Math.abs(Number(data.total) - expectedTotal) > 0.01) {
        auditReject(req, 'orders', id, `إجمالي غير مطابق للحساب: ${String(data.total)} ≠ ${expectedTotal}`);
        res.status(409).json({ error: 'الإجمالي لا يطابق الحساب (الأصناف − الخصم + الضريبة) — أُعِد حسابه صحياً' });
        return;
      }
    }

    // Validation for table status updates
    if (store === 'tables' && data.status && !VALID_TABLE_STATUSES.has(data.status as string)) {
      res.status(400).json({ error: `Invalid table status: ${data.status}` });
      return;
    }
    if (store === 'orders' && data.status && !VALID_ORDER_STATUSES.has(data.status as string)) {
      res.status(400).json({ error: `Invalid order status: ${data.status}` });
      return;
    }

    const sets = keys.map(k => `\`${k}\` = ?`).join(', ');
    const db = getDb();

    // When completing/cancelling/closing an order, free the table in the same transaction
    if (store === 'orders' && (data.status === 'completed' || data.status === 'cancelled' || data.status === 'closed')) {
      beginTransaction();
      try {
        db.run(`UPDATE \`${table}\` SET ${sets} WHERE id = ?`, [...keys.map(k => data[k]), id]);
        const order = queryOne('SELECT tableId FROM orders WHERE id = ?', [id]);
        if (order && order.tableId && order.tableId !== 'takeaway' && !isNaN(Number(order.tableId))) {
          db.run('UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(order.tableId)]);
        }
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else {
      db.run(`UPDATE \`${table}\` SET ${sets} WHERE id = ?`, [...keys.map(k => data[k]), id]);
      saveDb();
    }

    // C3-P0: تدقيق تعديل الصفوف المالية/الطلبات (نجاح التعديل يُسجَّل وليس فقط الإنشاء)
    if (store === 'orders' || store === 'order_items' || store === 'payments') {
      const after = queryOne(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
      if (after) recordAuditLog('update', store, id, after, actorName(req));
    }

    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/:store/:id', (req: Request, res: Response) => {
  const store = storeFor(req);
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  if (deleteDenied(req as AuthRequest)) { res.status(403).json({ error: 'Forbidden: delete requires admin/manager' }); return; }
  try {
    const db = getDb();
    const table = tableNameForStore(store);

    // C3-P0: الدفعات لا تُحذف عبر CRUD (المصدر الوحيد: /checkout)، والاستردادات حذفها admin فقط
    if (store === 'payments') {
      auditReject(req, 'payments', id, 'محاولة حذف دفعة عبر CRUD');
      res.status(409).json({ error: 'لا يمكن حذف دفعة عبر CRUD — التحصيل/الإلغاء عبر /checkout و /void' });
      return;
    }
    if (store === 'refunds') {
      const idnty = (req as AuthRequest).identity;
      if (!idnty || idnty.role !== 'admin') {
        auditReject(req, 'refunds', id, 'محاولة حذف سجل استرداد بدون دور admin');
        res.status(403).json({ error: 'حذف سجل الاسترداد يتطلب صلاحية admin' });
        return;
      }
    }

    // C3-P0: الطلب المدفوع/المغلق لا يُحذف عبر CRUD + تدقيق الحذف للصفوف المالية
    let deletedRow: Record<string, unknown> | undefined;
    if (store === 'orders' || store === 'order_items' || store === 'payments' || store === 'refunds') {
      deletedRow = queryOne(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
      if (store === 'orders' && deletedRow && isOrderPaidOrClosed(deletedRow)) {
        auditReject(req, 'orders', id, 'محاولة حذف طلب مدفوع/مغلق');
        res.status(409).json({ error: 'الطلب مدفوع/مغلق — لا يُحذف عبر CRUD' });
        return;
      }
      if (!deletedRow) { res.status(404).json({ error: 'Not found' }); return; }
    }
    db.run(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
    saveDb();
    if (deletedRow) recordAuditLog('delete', store, id, deletedRow, actorName(req));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
