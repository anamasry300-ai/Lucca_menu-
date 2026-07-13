import { Router, Request, Response } from 'express';
import { getDb, saveDb, queryAll, queryOne, insert, getLastInsertId, beginTransaction, commitTransaction, rollbackTransaction } from '../db.js';

const router = Router();

const VALID_TABLE_STATUSES = new Set(['available', 'occupied', 'reserved', 'cleaning', 'closed']);
const VALID_ORDER_STATUSES = new Set(['pending', 'completed', 'cancelled', 'closed']);
const JSON_COLUMNS = new Set(['items']);

function parseRow(row: Record<string, unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof val === 'string') {
      try { obj[key] = JSON.parse(val as string); } catch { obj[key] = val; }
    } else {
      obj[key] = val;
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

const SAFE_TABLES = new Set([
  'users', 'tables', 'orders', 'customers',
  'inventory', 'purchases', 'employees', 'attendance',
  'expenses', 'shifts', 'daily_shifts'
]);

router.get('/:store', (req: Request, res: Response) => {
  const store = req.params.store as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  try {
    const rows = queryAll(`SELECT * FROM \`${store}\` ORDER BY id`);
    res.json(rows.map(parseRow));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/:store/:id', (req: Request, res: Response) => {
  const store = req.params.store as string;
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  try {
    const row = queryOne(`SELECT * FROM \`${store}\` WHERE id = ?`, [id]);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(parseRow(row));
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/:store', (req: Request, res: Response) => {
  const store = req.params.store as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  try {
    const data = serializeRow(req.body);

    // Validation for orders: check for duplicate active orders on same table
    if (store === 'orders' && data.status === 'pending') {
      const tableId = data.tableId;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        const existing = queryAll(
          'SELECT id FROM orders WHERE tableId = ? AND status = ?',
          [String(tableId), 'pending']
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

    const keys = Object.keys(data);
    if (keys.length === 0) { res.status(400).json({ error: 'No data' }); return; }
    const cols = keys.map(k => `\`${k}\``).join(', ');
    const vals = keys.map(() => '?').join(', ');

    let id: number;
    if (store === 'orders') {
      beginTransaction();
      try {
        id = insert(`INSERT INTO \`${store}\` (${cols}) VALUES (${vals})`, keys.map(k => data[k]));
        // If this order is for a table, update table status
        if (data.tableId && data.tableId !== 'takeaway' && !isNaN(Number(data.tableId)) && data.status === 'pending') {
          const db = getDb();
          db.run(
            'UPDATE tables SET status = ?, currentOrder = ? WHERE id = ?',
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
        const placeholders = keys.map(() => '?').join(', ');
        db.run(
          `INSERT OR REPLACE INTO \`${store}\` (${cols}) VALUES (${placeholders})`,
          keys.map(k => data[k])
        );
        saveDb();
        id = (data.id as number) || 0;
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else {
      id = insert(`INSERT INTO \`${store}\` (${cols}) VALUES (${vals})`, keys.map(k => data[k]));
    }

    const created = queryOne(`SELECT * FROM \`${store}\` WHERE id = ?`, [id || getLastInsertId()]);
    res.status(201).json(created ? parseRow(created) : { id });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.put('/:store/:id', (req: Request, res: Response) => {
  const store = req.params.store as string;
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  try {
    const data = serializeRow(req.body);
    const keys = Object.keys(data);
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
        db.run(`UPDATE \`${store}\` SET ${sets} WHERE id = ?`, [...keys.map(k => data[k]), id]);
        const order = queryOne('SELECT tableId FROM orders WHERE id = ?', [id]);
        if (order && order.tableId && order.tableId !== 'takeaway' && !isNaN(Number(order.tableId))) {
          db.run('UPDATE tables SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(order.tableId)]);
        }
        commitTransaction();
      } catch (e) {
        rollbackTransaction();
        throw e;
      }
    } else {
      db.run(`UPDATE \`${store}\` SET ${sets} WHERE id = ?`, [...keys.map(k => data[k]), id]);
      saveDb();
    }

    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/:store/:id', (req: Request, res: Response) => {
  const store = req.params.store as string;
  const id = req.params.id as string;
  if (!SAFE_TABLES.has(store)) { res.status(400).json({ error: 'Invalid store' }); return; }
  try {
    const db = getDb();
    db.run(`DELETE FROM \`${store}\` WHERE id = ?`, [id]);
    saveDb();
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
