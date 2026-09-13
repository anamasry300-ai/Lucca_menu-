import { queryAll, queryOne } from '../db.js';

export interface DateRange {
  from: string;
  to: string;
}

export function paidOrdersSummary(from: string, to: string): Record<string, unknown> | undefined {
  return queryOne(
    "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder, COALESCE(SUM(discountAmount), 0) as discounts FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid'",
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