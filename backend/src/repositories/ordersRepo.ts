import { queryAll, queryOne } from '../db.js';

export interface DateRange {
  from: string;
  to: string;
}

export interface OrdersPageOptions {
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  status?: string;
  paymentStatus?: string;
  orderType?: string;
  q?: string;
}

function ordersWhere(from: string, to: string, opts: Omit<OrdersPageOptions, 'page' | 'pageSize'>): { where: string; params: unknown[] } {
  const clauses = ['date(date) >= ?', 'date(date) <= ?'];
  const params: unknown[] = [from, to];
  if (opts.status) { clauses.push('status = ?'); params.push(opts.status); }
  if (opts.paymentStatus) { clauses.push('paymentStatus = ?'); params.push(opts.paymentStatus); }
  if (opts.orderType) { clauses.push('orderType = ?'); params.push(opts.orderType); }
  if (opts.q) {
    clauses.push("(orderNumber LIKE ? OR customerName LIKE ? OR createdBy LIKE ? OR CAST(id AS TEXT) = ?)");
    const like = `%${String(opts.q).trim()}%`;
    params.push(like, like, like, String(opts.q).trim());
  }
  return { where: clauses.join(' AND '), params };
}

export function ordersPage(opts: OrdersPageOptions): Record<string, unknown>[] {
  const from = opts.from || '0000-01-01';
  const to = opts.to || '9999-12-31';
  const { where, params } = ordersWhere(from, to, opts);
  return queryAll(
    `SELECT id, orderNumber, tableId, orderType, customerName, status, paymentStatus, subtotal, discount, discountAmount, tax, total, totalPaid, changeAmount, date, createdBy, createdAt FROM orders WHERE ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
  );
}

export function ordersPageCount(opts: Omit<OrdersPageOptions, 'page' | 'pageSize'>): number {
  const from = opts.from || '0000-01-01';
  const to = opts.to || '9999-12-31';
  const { where, params } = ordersWhere(from, to, opts);
  return Number((queryOne(`SELECT COUNT(*) as c FROM orders WHERE ${where}`, params))?.c || 0);
}

export function paidOrdersSummary(from: string, to: string): Record<string, unknown> | undefined {
  return queryOne(
    "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid'",
    [from, to],
  );
}

export function paidOrdersSubtotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(subtotal), 0) as subtotal FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid'",
    [from, to],
  );
  return Number(row?.subtotal || 0);
}

export function orderById(id: number): Record<string, unknown> | undefined {
  return queryOne('SELECT * FROM orders WHERE id = ?', [id]);
}

export function ordersBetween(from: string, to: string, limit = 200): Record<string, unknown>[] {
  return queryAll(
    "SELECT * FROM orders WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC, id DESC LIMIT ?",
    [from, to, limit],
  );
}

export function orderItemsForOrder(orderId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, orderId, productId, name, quantity, unitPrice, total, cost, discount, discountType, tax, modifiers, notes, status FROM order_items WHERE orderId = ?",
    [orderId],
  );
}

export function paymentsForOrder(orderId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, orderId, amount, method, status, reference, createdBy, createdAt FROM payments WHERE orderId = ? ORDER BY createdAt DESC",
    [orderId],
  );
}

export function paymentsBetween(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, orderId, amount, method, status, reference, createdBy, createdAt FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' ORDER BY createdAt DESC",
    [from, to],
  );
}

export function refundsForOrder(orderId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, orderId, amount, type, reason, createdBy, refundMethod, createdAt FROM refunds WHERE orderId = ? ORDER BY createdAt DESC",
    [orderId],
  );
}

export function refundsBetween(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, orderId, amount, type, reason, createdBy, refundMethod, createdAt FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' ORDER BY createdAt DESC",
    [from, to],
  );
}

export function cashPaymentsTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE method = 'cash' AND status = 'completed' AND createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
    [from, to],
  );
  return Number(row?.total || 0);
}

// غير النقدي (card/wallet/bank/other) — يستخدمه إقفال الوردية لملء cardSales
export function nonCashPaymentsTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE method <> 'cash' AND status = 'completed' AND createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
    [from, to],
  );
  return Number(row?.total || 0);
}

export function cashRefundTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE refundMethod = 'cash' AND createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
    [from, to],
  );
  return Number(row?.total || 0);
}

export function paidOrderItemsBetween(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT oi.productId, oi.name as productName, oi.quantity FROM order_items oi JOIN orders o ON oi.orderId = o.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid'",
    [from, to],
  );
}

export function cancelledCount(from: string, to: string): number {
  return Number(((queryOne(
    "SELECT COUNT(*) as c FROM orders WHERE date(date) >= ? AND date(date) <= ? AND status = 'cancelled'",
    [from, to],
  )) || {}).c || 0);
}

export function salesByDay(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT date(date) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid' GROUP BY date(date) ORDER BY date(date)",
    [from, to],
  );
}

export function salesByCategory(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') as name, SUM(oi.quantity) as quantity, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') ORDER BY revenue DESC",
    [from, to],
  );
}

export function topProducts(from: string, to: string, limit = 10): Record<string, unknown>[] {
  return queryAll(
    `SELECT oi.name, p.id as productId, COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') as category, SUM(oi.quantity) as quantity, SUM(oi.total) as revenue, COALESCE(p.cost, 0) as costPrice FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY oi.name ORDER BY revenue DESC LIMIT ?`,
    [from, to, limit],
  );
}

export function paymentMethods(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' GROUP BY method ORDER BY total DESC",
    [from, to],
  );
}

export function cogsFor(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost, 0)), 0) as cogs FROM order_items oi JOIN orders o ON oi.orderId = o.id LEFT JOIN products p ON oi.productId = p.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid'",
    [from, to],
  );
  return Number(row?.cogs || 0);
}

// توزيع المبيعات حسب مجموعة الأيام (أسبوع/شهر) — تقريب للمجموعة عبر strftime
export function salesGroupedByPeriod(from: string, to: string, group: string): Record<string, unknown>[] {
  const expr = group === 'week'
    ? "strftime('%Y-W%W', date(date))"
    : group === 'month'
      ? "strftime('%Y-%m', date(date))"
      : 'date(date)';
  return queryAll(
    `SELECT ${expr} as period, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid' GROUP BY period ORDER BY period`,
    [from, to],
  );
}