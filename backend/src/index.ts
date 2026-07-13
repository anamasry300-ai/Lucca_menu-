import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, getDb, saveDb, closeDb, queryAll, queryOne, beginTransaction, commitTransaction, rollbackTransaction } from './db.js';
import crudRoutes from './routes/crud.js';
import specialRoutes from './routes/special.js';

const PORT = parseInt(process.env.PORT || '3000');
const API_KEY = process.env.API_KEY || 'lucca-secret-key';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function apiKeyCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.headers['x-api-key'] as string | undefined;
  if (key && key === API_KEY) return next();
  if (req.method === 'GET') return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || '';
  if (token === API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use('/api', apiKeyCheck);

app.get('/api/public-key', (_req, res) => {
  res.json({ apiKey: API_KEY });
});

app.use('/api', specialRoutes);
app.use('/api', crudRoutes);

// Sync: POST /api/sync
// Checkout endpoint: atomically close order and free table
app.post('/api/orders/:id/checkout', (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { paymentMethod } = req.body;

    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status === 'closed') { res.status(409).json({ error: 'Order is already closed' }); return; }

    beginTransaction();
    try {
      // 1. Close the order
      db.run('UPDATE orders SET status = ?, paymentMethod = ? WHERE id = ?', ['closed', paymentMethod || 'cash', orderId]);

      // 2. Free the table if this is a dine-in order
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

      // 3. Update daily shift sales data
      const today = new Date().toISOString().slice(0, 10);
      const existingShift = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [today]);
      const total = (order.total as number) || 0;
      if (existingShift) {
        const cashSales = paymentMethod === 'cash' ? (existingShift.cashSales as number || 0) + total : (existingShift.cashSales as number || 0);
        const cardSales = paymentMethod !== 'cash' ? (existingShift.cardSales as number || 0) + total : (existingShift.cardSales as number || 0);
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

// Sync: POST /api/sync
app.post('/api/sync', (req, res) => {
  let db;
  try {
    db = getDb();
    const data = req.body;
    const stores = ['users', 'tables', 'orders', 'customers', 'settings', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'daily_shifts'];
    beginTransaction();
    for (const store of stores) {
      if (!Array.isArray(data[store])) continue;
      db.run(`DELETE FROM \`${store}\``);
      for (const item of data[store]) {
        const keys = Object.keys(item);
        if (keys.length === 0) continue;
        const cols = keys.map(k => `\`${k}\``).join(', ');
        const vals = keys.map(() => '?').join(', ');
        db.run(`INSERT OR REPLACE INTO \`${store}\` (${cols}) VALUES (${vals})`, keys.map(k => item[k]));
      }
    }
    commitTransaction();
    res.json({ success: true, message: '✅ تم استيراد البيانات' });
  } catch (e: unknown) {
    if (db) rollbackTransaction();
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Lucca Backend running on http://localhost:${PORT}`);
  });
});

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
