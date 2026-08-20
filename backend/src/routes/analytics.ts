import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db.js';

const router = Router();

function dateRange(req: Request): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  return { from: (req.query.from as string) || today, to: (req.query.to as string) || today };
}

function prevDateRange(from: string, to: string): { from: string; to: string } {
  const d1 = new Date(from);
  const d2 = new Date(to);
  const diff = d2.getTime() - d1.getTime();
  return { from: new Date(d1.getTime() - diff).toISOString().slice(0, 10), to: new Date(d2.getTime() - diff).toISOString().slice(0, 10) };
}

// 1. Dashboard KPIs
router.get('/dashboard/kpis', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const pf = prevDateRange(from, to);

    const cur = queryOne(
      "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled')",
      [from, to]
    ) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };

    const prev = queryOne(
      "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled')",
      [pf.from, pf.to]
    ) || { count: 0, revenue: 0, avgOrder: 0 };

    const refundAmt = (queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'", [from, to]) || {}).total || 0;
    const prevRefundAmt = (queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'", [pf.from, pf.to]) || {}).total || 0;

    const netSales = (cur.revenue as number) - (cur.discounts as number) - (refundAmt as number);
    const prevNetSales = (prev.revenue as number) - (prevRefundAmt as number);

    const cancelled = (queryOne("SELECT COUNT(*) as c FROM orders WHERE date >= ? AND date <= ? AND status = 'cancelled'", [from, to]) || {}).c || 0;

    // COGS
    const cogsRow = queryOne(
      "SELECT COALESCE(SUM(oi.quantity * COALESCE(p.costPrice, 0)), 0) as cogs FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled')",
      [from, to]
    );
    const cogs = (cogsRow?.cogs as number) || 0;
    const hasCostData = cogs > 0;
    const grossProfit = hasCostData ? netSales - cogs : null;
    const grossMargin = hasCostData && netSales > 0 ? ((grossProfit as number) / netSales * 100) : null;

    function pct(cur: number, prev: number) {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return ((cur - prev) / prev * 100);
    }

    res.json({
      sales: { value: netSales, prev: prevNetSales, change: pct(netSales, prevNetSales) },
      orders: { value: cur.count, prev: prev.count, change: pct(cur.count as number, prev.count as number) },
      avgOrder: { value: cur.avgOrder, prev: prev.avgOrder, change: pct(cur.avgOrder as number, prev.avgOrder as number) },
      discounts: { value: cur.discounts, change: pct(cur.discounts as number, 0) },
      refunds: { value: refundAmt, prev: prevRefundAmt, change: pct(refundAmt as number, prevRefundAmt as number) },
      cancelled: { value: cancelled },
      grossProfit: hasCostData ? { value: grossProfit, margin: grossMargin } : null,
      hasCostData
    });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 2. Sales by day (for chart)
router.get('/dashboard/sales-by-day', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      "SELECT date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled') GROUP BY date ORDER BY date",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 3. Sales by category
router.get('/dashboard/sales-by-category', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      "SELECT COALESCE(c.nameAr, c.name, p.category, 'غير محدد') as name, SUM(oi.quantity) as quantity, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled') GROUP BY name ORDER BY revenue DESC",
      [from, to]
    );
    const total = rows.reduce((s, r) => s + ((r.revenue as number) || 0), 0);
    res.json(rows.map(r => ({ ...r, percentage: total > 0 ? ((r.revenue as number) / total * 100) : 0 })));
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 4. Top products
router.get('/dashboard/top-products', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const limit = parseInt(req.query.limit as string) || 10;
    const rows = queryAll(
      `SELECT oi.name, p.id as productId, COALESCE(c.nameAr, c.name, p.category, 'غير محدد') as category, SUM(oi.quantity) as quantity, SUM(oi.total) as revenue, COALESCE(p.costPrice, 0) as costPrice FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled') GROUP BY oi.name ORDER BY revenue DESC LIMIT ?`,
      [from, to, limit]
    );
    res.json(rows.map(r => {
      const rev = (r.revenue as number) || 0;
      const qty = (r.quantity as number) || 0;
      const cost = ((r.costPrice as number) || 0) * qty;
      return { ...r, cost, profit: rev - cost, margin: rev > 0 ? ((rev - cost) / rev * 100) : 0 };
    }));
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 5. Payment methods breakdown
router.get('/dashboard/payments', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      "SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' GROUP BY method ORDER BY total DESC",
      [from, to]
    );
    const grandTotal = rows.reduce((s, r) => s + ((r.total as number) || 0), 0);
    res.json(rows.map(r => ({ ...r, percentage: grandTotal > 0 ? ((r.total as number) / grandTotal * 100) : 0 })));
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 6. Table status
router.get('/dashboard/tables', (_req: Request, res: Response) => {
  try {
    const rows = queryAll("SELECT id, number, status, capacity, zone FROM tables_store ORDER BY number");
    const summary = queryAll("SELECT status, COUNT(*) as count FROM tables_store GROUP BY status");
    res.json({ tables: rows, summary });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 7. Live orders
router.get('/dashboard/live-orders', (_req: Request, res: Response) => {
  try {
    const rows = queryAll(
      "SELECT id, orderNumber, tableId, customerName, total, paymentMethod, status, createdBy, date, createdAt FROM orders WHERE status IN ('pending', 'in_preparation', 'ready', 'served') ORDER BY createdAt DESC LIMIT 50"
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 8. Orders summary
router.get('/dashboard/orders-summary', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      "SELECT status, COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM orders WHERE date >= ? AND date <= ? GROUP BY status",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 9. Refunds & Voids
router.get('/dashboard/refunds-voids', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const refunds = queryAll(
      "SELECT id, orderId, amount, reason, createdAt FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' ORDER BY createdAt DESC LIMIT 50",
      [from, to]
    );
    const voids = queryAll(
      "SELECT id, orderNumber, tableId, total, createdBy, date FROM orders WHERE status = 'cancelled' AND date >= ? AND date <= ? ORDER BY date DESC LIMIT 50",
      [from, to]
    );
    const refundTotal = refunds.reduce((s, r) => s + ((r.amount as number) || 0), 0);
    const voidTotal = voids.reduce((s, v) => s + ((v.total as number) || 0), 0);
    res.json({ refunds, voids, refundTotal, voidTotal, refundCount: refunds.length, voidCount: voids.length });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 10. Employee performance
router.get('/dashboard/employees', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      "SELECT o.createdBy as name, COUNT(*) as orders, COALESCE(SUM(o.total), 0) as sales, COALESCE(AVG(o.total), 0) as avgOrder FROM orders o WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled') GROUP BY o.createdBy ORDER BY sales DESC",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 11. Discounts analysis
router.get('/dashboard/discounts', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const summary = queryOne(
      "SELECT COUNT(*) as totalOrders, SUM(CASE WHEN discountAmount > 0 THEN 1 ELSE 0 END) as discountedOrders, COALESCE(SUM(discountAmount), 0) as totalDiscounts, COALESCE(SUM(total), 0) as totalSales FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled')",
      [from, to]
    );
    res.json(summary || { totalOrders: 0, discountedOrders: 0, totalDiscounts: 0, totalSales: 0 });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 12. Inventory overview
router.get('/dashboard/inventory', (_req: Request, res: Response) => {
  try {
    const items = queryAll("SELECT id, name, quantity, unit, minStock, cost, status FROM inventory ORDER BY quantity ASC");
    const totalValue = items.reduce((s, i) => s + ((i.quantity as number) || 0) * ((i.cost as number) || 0), 0);
    const lowStock = items.filter(i => (i.quantity as number) <= (i.minStock as number) && (i.quantity as number) > 0);
    const outOfStock = items.filter(i => (i.quantity as number) <= 0);
    res.json({ items, totalValue, lowStock: lowStock.length, outOfStock: outOfStock.length, totalItems: items.length });
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 13. Business insights (auto-generated)
router.get('/dashboard/insights', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const pf = prevDateRange(from, to);
    const insights: { type: string; message: string; severity: string }[] = [];

    const curSales = ((queryOne("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled')", [from, to]) || {}).t as number) || 0;
    const prevSales = ((queryOne("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE date >= ? AND date <= ? AND status NOT IN ('cancelled')", [pf.from, pf.to]) || {}).t as number) || 0;
    if (prevSales > 0) {
      const ch = ((curSales - prevSales) / prevSales * 100);
      if (ch > 5) insights.push({ type: 'positive', message: `المبيعات ارتفعت ${ch.toFixed(1)}% مقارنة بالفترة السابقة`, severity: 'success' });
      else if (ch < -5) insights.push({ type: 'negative', message: `المبيعات انخفضت ${Math.abs(ch).toFixed(1)}% مقارنة بالفترة السابقة`, severity: 'danger' });
    }

    const topCat = queryOne("SELECT COALESCE(c.nameAr, c.name, 'غير محدد') as name, SUM(oi.total) as rev FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id WHERE o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled') GROUP BY name ORDER BY rev DESC LIMIT 1", [from, to]);
    if (topCat && (topCat.rev as number) > 0) insights.push({ type: 'info', message: `قسم "${topCat.name}" حقق أعلى إيراد`, severity: 'info' });

    const cashPct = queryOne("SELECT COALESCE(SUM(amount), 0) as cash FROM payments WHERE method = 'cash' AND createdAt >= ? AND createdAt <= ? || 'T23:59:59'", [from, to]);
    const totalPay = queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'", [from, to]);
    if ((totalPay?.total as number) > 0) {
      const cp = ((cashPct?.cash as number) / (totalPay?.total as number) * 100);
      if (cp > 40) insights.push({ type: 'info', message: `الكاش يمثل ${cp.toFixed(0)}% من إجمالي المدفوعات`, severity: 'info' });
    }

    const voidCount = (queryOne("SELECT COUNT(*) as c FROM orders WHERE status = 'cancelled' AND date >= ? AND date <= ?", [from, to]) || {}).c || 0;
    const totalOrders = (queryOne("SELECT COUNT(*) as c FROM orders WHERE date >= ? AND date <= ?", [from, to]) || {}).c || 0;
    if (totalOrders > 0 && (voidCount as number) / (totalOrders as number) > 0.1) {
      insights.push({ type: 'warning', message: `نسبة الإلغاءات مرتفعة: ${voidCount} من ${totalOrders} طلب`, severity: 'warning' });
    }

    res.json(insights);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 14. Alerts
router.get('/dashboard/alerts', (req: Request, res: Response) => {
  try {
    const alerts: { severity: string; message: string; type: string }[] = [];

    const lowStock = queryAll("SELECT name, quantity, minStock FROM inventory WHERE quantity <= minStock AND quantity > 0");
    lowStock.forEach(i => alerts.push({ severity: 'warning', message: `مخزون منخفض: ${i.name} (${i.quantity} ${i.unit || ''})`, type: 'low_stock' }));

    const outOfStock = queryAll("SELECT name FROM inventory WHERE quantity <= 0");
    outOfStock.forEach(i => alerts.push({ severity: 'danger', message: `نفذ من المخزون: ${i.name}`, type: 'out_of_stock' }));

    const today = new Date().toISOString().slice(0, 10);
    const highDiscounts = queryOne(
      "SELECT COALESCE(SUM(discountAmount), 0) as total, COALESCE(SUM(total), 0) as sales FROM orders WHERE date = ? AND status NOT IN ('cancelled')",
      [today]
    );
    if ((highDiscounts?.sales as number) > 0 && ((highDiscounts?.total as number) / (highDiscounts?.sales as number) > 0.2)) {
      alerts.push({ severity: 'warning', message: 'نسبة الخصومات مرتفعة اليوم', type: 'high_discounts' });
    }

    res.json(alerts);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 15. Products list with stats
router.get('/dashboard/products', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      `SELECT p.id, p.name, p.price, p.costPrice, p.category, p.available, COALESCE(c.nameAr, c.name, p.category) as categoryName,
       COALESCE(SUM(oi.quantity), 0) as qtySold, COALESCE(SUM(oi.total), 0) as revenue
       FROM products p
       LEFT JOIN categories c ON p.categoryId = c.id
       LEFT JOIN order_items oi ON oi.productId = p.id
       LEFT JOIN orders o ON oi.orderId = o.id AND o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled')
       GROUP BY p.id ORDER BY revenue DESC`,
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 16. Categories list with stats
router.get('/dashboard/categories', (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    const rows = queryAll(
      `SELECT c.id, c.nameAr as name, c.nameEn, c.icon, c.active, c.sortOrder,
       COALESCE(SUM(oi.quantity), 0) as qtySold, COALESCE(SUM(oi.total), 0) as revenue,
       (SELECT COUNT(*) FROM products WHERE categoryId = c.id) as productCount
       FROM categories c
       LEFT JOIN products p ON p.categoryId = c.id
       LEFT JOIN order_items oi ON oi.productId = p.id
       LEFT JOIN orders o ON oi.orderId = o.id AND o.date >= ? AND o.date <= ? AND o.status NOT IN ('cancelled')
       GROUP BY c.id ORDER BY c.sortOrder`,
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 17. Payment methods list
router.get('/dashboard/payment-methods', (_req: Request, res: Response) => {
  try {
    const rows = queryAll("SELECT * FROM payment_methods ORDER BY sortOrder, id");
    res.json(rows);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

// 18. Settings (tax rate, cafe info)
router.get('/dashboard/settings', (_req: Request, res: Response) => {
  try {
    const rows = queryAll("SELECT * FROM settings");
    const obj: Record<string, unknown> = {};
    rows.forEach(r => { obj[r.key as string] = r.value; });
    res.json(obj);
  } catch (e: unknown) { res.status(500).json({ error: (e as Error).message }); }
});

export default router;
