import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, getDb, saveDb, closeDb, queryAll, queryOne, beginTransaction, commitTransaction, rollbackTransaction } from './db.js';
import crudRoutes from './routes/crud.js';
import specialRoutes from './routes/special.js';
import analyticsRoutes from './routes/analytics.js';

const PORT = parseInt(process.env.PORT || '3000');
const API_KEY = process.env.API_KEY || 'lucca-secret-key';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

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
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
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

function apiKeyCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.headers['x-api-key'] as string | undefined;
  if (key && key === API_KEY) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || '';
  if (token === API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use('/api', apiKeyCheck);

app.use('/api', specialRoutes);
app.use('/api', analyticsRoutes);
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
      const total = (order.total as number) || 0;
      const method = paymentMethod || 'cash';
      const createdBy = (order.createdBy as string) || 'unknown';
      const today = new Date().toISOString().slice(0, 10);

      // 1. Generate order_number if missing (ORD-YYYYMMDD-NNN)
      let orderNumber = order.orderNumber as string;
      if (!orderNumber) {
        const dateCompact = today.replace(/-/g, '');
        const todayOrders = queryAll("SELECT COUNT(*) as cnt FROM orders WHERE orderNumber LIKE ?", [`ORD-${dateCompact}-%`]);
        const seq = ((todayOrders[0]?.cnt as number) || 0) + 1;
        orderNumber = `ORD-${dateCompact}-${String(seq).padStart(3, '0')}`;
      }

      // 2. Close the order with payment info
      db.run(
        'UPDATE orders SET status = ?, paymentMethod = ?, paymentStatus = ?, totalPaid = ?, changeAmount = ?, orderNumber = ? WHERE id = ?',
        ['closed', method, 'paid', total, 0, orderNumber, orderId]
      );

      // 3. Free the table if this is a dine-in order
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

      // 4. Insert payment record
      db.run(
        'INSERT INTO payments (orderId, amount, method, status, createdBy) VALUES (?, ?, ?, ?, ?)',
        [orderId, total, method, 'completed', createdBy]
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

// Sync: POST /api/sync
app.post('/api/sync', (req, res) => {
  let db;
  try {
    db = getDb();
    const data = req.body;
    const stores = ['users', 'tables', 'orders', 'customers', 'settings', 'inventory', 'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'daily_shifts', 'categories', 'products', 'product_modifiers', 'product_variations', 'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs', 'order_items', 'order_status_history', 'discounts'];
    beginTransaction();
    for (const store of stores) {
      if (!Array.isArray(data[store])) continue;
      db.run(`DELETE FROM \`${store}\``);
      for (const item of data[store]) {
        const keys = Object.keys(item).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) && k.length <= 64);
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

// === Aggregation Endpoints ===
app.get('/api/reports/summary', (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const orders = queryAll(
      "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder FROM orders WHERE date >= ? AND date <= ? AND status != 'cancelled'",
      [from, to]
    );
    const expenses = queryAll(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?",
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
      "SELECT oi.name, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.orderId = o.id WHERE o.date >= ? AND o.date <= ? AND o.status != 'cancelled' GROUP BY oi.name ORDER BY revenue DESC LIMIT 10",
      [from, to]
    );
    const dailySales = queryAll(
      "SELECT date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue FROM orders WHERE date >= ? AND date <= ? AND status != 'cancelled' GROUP BY date ORDER BY date",
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

app.get('/api/reports/sales-by-category', (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const rows = queryAll(
      "SELECT COALESCE(c.nameAr, c.name, p.category, 'غير محدد') as category, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id JOIN orders o ON oi.orderId = o.id WHERE o.date >= ? AND o.date <= ? AND o.status != 'cancelled' GROUP BY category ORDER BY revenue DESC",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) {
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
