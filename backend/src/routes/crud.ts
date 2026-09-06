import { Router, Request, Response } from 'express';
import { getDb, saveDb, queryAll, queryOne, insert, getLastInsertId, beginTransaction, commitTransaction, rollbackTransaction } from '../db.js';
import { authRequired, AuthRequest, roleHas } from '../auth.js';

const VALID_COL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const router = Router();

// ===== H2: تفويض (Authorization) على الخادم =====
// ===== H3: توحيد تطبيق التفويض على خريطة ROLE_PERMISSIONS (مصدر حقيقة واحد) =====
router.use(authRequired as any);

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
const WRITE_ADMIN_STORES = new Set([
  'users', 'settings', 'audit_logs', 'daily_shifts', 'shifts', 'refunds', 'suppliers', 'stock_movements', 'inventory_alerts'
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

function recordAuditLog(action: string, objectType: string, objectId: string | number, newValue?: unknown) {
  try {
    const db = getDb();
    db.run(
      "INSERT INTO audit_logs (action, objectType, objectId, newValue, userName, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [action, objectType, String(objectId), typeof newValue === 'string' ? newValue : JSON.stringify(newValue || ''), 'system']
    );
  } catch (_) { /* audit logging is best-effort */ }
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
    db.run(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
    saveDb();
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
