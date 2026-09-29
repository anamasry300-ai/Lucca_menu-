import { queryOne } from '../db.js';
import { dayBound } from '../dateRange.js';
import {
  paidOrdersSummary, paidOrdersSubtotal, cancelledCount, salesByDay, salesByCategory, topProducts,
  paymentMethods, salesGroupedByPeriod, cashPaymentsTotal, cashRefundTotal, paidOrderItemsBetween,
} from '../repositories/ordersRepo.js';
import { expensesSummary, expensesByCategory, expensesByEmployee, recentExpenses, cashExpensesTotal } from '../repositories/expensesRepo.js';
import { allInventory, inventoryValue, activeAlerts, stockMovementsWithNames } from '../repositories/inventoryRepo.js';
import { allSuppliers, supplierPurchaseTotals, recentPurchases } from '../repositories/supplierRepo.js';
import { allEmployees, employeePerformance, attendanceFor } from '../repositories/employeeRepo.js';
import { getProductUnitCost } from './inventoryService.js';

export function prevDateRange(from: string, to: string): { from: string; to: string } {
  const d1 = new Date(from);
  const d2 = new Date(to);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return { from, to };
  const diff = d2.getTime() - d1.getTime();
  return { from: new Date(d1.getTime() - diff).toISOString().slice(0, 10), to: new Date(d2.getTime() - diff).toISOString().slice(0, 10) };
}

export function pctChange(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

// P0: dayBound على الطرفين — الحدّ `'D || 'T23:59:59'` = نهاية اليوم، لكن الحدّ
// السفلي يجب أن يكون 'YYYY-MM-DD' وإلا أسقط صيغة SQLite 'YYYY-MM-DD HH:MM:SS'.
export function refundTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')],
  );
  return Number(row?.total || 0);
}

export interface SalesReport {
  range: { from: string; to: string; previous: { from: string; to: string } };
  revenue: number;
  orders: number;
  avgOrder: number;
  discounts: number;
  refunds: number;
  netSales: number;
  cancelled: number;
  previous: { revenue: number; orders: number; avgOrder: number; refunds: number; netSales: number };
  change: { revenue: number; orders: number; avgOrder: number; netSales: number };
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  hasCostData: boolean;
  byDay: Record<string, unknown>[];
  byPeriod: Record<string, unknown>[];
  byCategory: Record<string, unknown>[];
  topProducts: Record<string, unknown>[];
  payments: Record<string, unknown>[];
}

export function getSalesReport(from: string, to: string, group = 'day', includeProfit = false): SalesReport {
  const pf = prevDateRange(from, to);
  const cur = paidOrdersSummary(from, to) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };
  const prev = paidOrdersSummary(pf.from, pf.to) || { count: 0, revenue: 0, avgOrder: 0 };
  const refunds = refundTotal(from, to);
  const prevRefunds = refundTotal(pf.from, pf.to);
  const cancelled = cancelledCount(from, to);

  const revenue = Number(cur.revenue) || 0;
  const orders = Number(cur.count) || 0;
  const avgOrder = Number(cur.avgOrder) || 0;
  const discounts = Number(cur.discounts) || 0;
  const netSales = revenue - refunds;
  const prevNetSales = (Number(prev.revenue) || 0) - prevRefunds;
  const prevRevenue = Number(prev.revenue) || 0;
  const prevOrders = Number(prev.count) || 0;
  const prevAvg = Number(prev.avgOrder) || 0;

  const cogsMetric = getCOGS(from, to);
  const cogs = cogsMetric.value;
  const hasCostData = cogsMetric.completeness === 'complete';
  const grossProfit = hasCostData && cogs != null ? netSales - cogs : null;
  const grossMargin = hasCostData && netSales > 0 && grossProfit != null ? Number((((grossProfit as number) / netSales) * 100).toFixed(1)) : null;

  return {
    range: { from, to, previous: pf },
    revenue, orders, avgOrder, discounts, refunds, netSales, cancelled,
    previous: { revenue: prevRevenue, orders: prevOrders, avgOrder: prevAvg, refunds: prevRefunds, netSales: prevNetSales },
    change: {
      revenue: pctChange(revenue, prevRevenue),
      orders: pctChange(orders, prevOrders),
      avgOrder: pctChange(avgOrder, prevAvg),
      netSales: pctChange(netSales, prevNetSales),
    },
    cogs: includeProfit ? cogs : null,
    grossProfit: includeProfit ? grossProfit : null,
    grossMargin: includeProfit ? grossMargin : null,
    hasCostData: includeProfit ? hasCostData : false,
    byDay: salesByDay(from, to),
    byPeriod: salesGroupedByPeriod(from, to, group),
    byCategory: salesByCategory(from, to),
    topProducts: topProducts(from, to),
    payments: paymentMethods(from, to),
  };
}

export interface ExpensesReport {
  range: { from: string; to: string; previous: { from: string; to: string } };
  total: number;
  count: number;
  previous: { total: number; count: number };
  change: { total: number };
  byCategory: Record<string, unknown>[];
  byEmployee: Record<string, unknown>[];
  recent: Record<string, unknown>[];
}

export function getExpensesReport(from: string, to: string): ExpensesReport {
  const pf = prevDateRange(from, to);
  const cur = expensesSummary(from, to);
  const prev = expensesSummary(pf.from, pf.to);
  return {
    range: { from, to, previous: pf },
    total: cur.total,
    count: cur.count,
    previous: { total: prev.total, count: prev.count },
    change: { total: pctChange(cur.total, prev.total) },
    byCategory: expensesByCategory(from, to),
    byEmployee: expensesByEmployee(from, to),
    recent: recentExpenses(from, to),
  };
}

export interface InventoryReport {
  items: ReturnType<typeof allInventory>;
  totalValue: number;
  lowStock: number;
  outOfStock: number;
  totalItems: number;
  alerts: Record<string, unknown>[];
  movements: Record<string, unknown>[];
}

export function getInventoryReport(): InventoryReport {
  const items = allInventory();
  const lowStock = items.filter((i) => i.status === 'low').length;
  const outOfStock = items.filter((i) => i.status === 'out').length;
  return {
    items,
    totalValue: inventoryValue(items),
    lowStock,
    outOfStock,
    totalItems: items.length,
    alerts: activeAlerts(),
    movements: stockMovementsWithNames(100),
  };
}

export interface EmployeesReport {
  employees: Record<string, unknown>[];
  performance: Record<string, unknown>[];
  totals: { orders: number; sales: number };
  previous: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
}

export function getEmployeesReport(from: string, to: string): EmployeesReport {
  const pf = prevDateRange(from, to);
  const performance = employeePerformance(from, to);
  const prevPerf = employeePerformance(pf.from, pf.to);
  const totals = performance.reduce<{ orders: number; sales: number }>(
    (s, r) => ({ orders: s.orders + (Number(r.orders) || 0), sales: s.sales + (Number(r.sales) || 0) }),
    { orders: 0, sales: 0 },
  );
  return {
    employees: allEmployees(),
    performance,
    totals,
    previous: prevPerf,
    attendance: attendanceFor(from, to),
  };
}

export interface SuppliersReport {
  suppliers: ReturnType<typeof allSuppliers>;
  recent: Record<string, unknown>[];
  totals: Record<string, unknown>[];
}

export function getSuppliersReport(from: string, to: string): SuppliersReport {
  return {
    suppliers: allSuppliers(),
    recent: recentPurchases(from, to),
    totals: supplierPurchaseTotals(from, to),
  };
}

export function todayCompact(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Completeness = 'complete' | 'partial' | 'unavailable';

export interface MetricResult {
  value: number | null;
  currency: 'SYP';
  period: { from: string; to: string };
  source: string;
  completeness: Completeness;
  warnings: string[];
}

function metric(period: { from: string; to: string }, value: number | null, source: string, completeness: Completeness, warnings: string[] = []): MetricResult {
  return { value, currency: 'SYP', period, source, completeness, warnings };
}

// P0: daily_shifts.date مفتاح نصّي 'YYYY-MM-DD' — نُطبّع المدخل بالمثل (dayBound).
function dailyShift(date: string): Record<string, unknown> | undefined {
  return queryOne('SELECT * FROM daily_shifts WHERE date = ?', [dayBound(date, '')]);
}

export function getNetSales(from: string, to: string): MetricResult {
  const paid = paidOrdersSummary(from, to) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };
  const revenue = Number(paid.revenue) || 0;
  const refunds = refundTotal(from, to);
  return metric({ from, to }, revenue - refunds, 'Σ orders.total (paid) − Σ refunds.amount', 'complete');
}

export function getGrossSales(from: string, to: string): MetricResult {
  return metric({ from, to }, paidOrdersSubtotal(from, to), 'Σ orders.subtotal (paid)', 'complete');
}

export function getRefunds(from: string, to: string): MetricResult {
  return metric({ from, to }, refundTotal(from, to), 'Σ refunds.amount', 'complete');
}

export function getCancelledCount(from: string, to: string): MetricResult {
  return metric({ from, to }, cancelledCount(from, to), 'COUNT(orders.status = cancelled)', 'complete');
}

export function getAOV(from: string, to: string): MetricResult {
  const paid = paidOrdersSummary(from, to) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };
  const revenue = Number(paid.revenue) || 0;
  const count = Number(paid.count) || 0;
  if (count === 0) return metric({ from, to }, null, 'Σ orders.total (paid) / COUNT(paid)', 'unavailable', ['لا طلبات مدفوعة ضمن الفترة']);
  return metric({ from, to }, revenue / count, 'Σ orders.total (paid) / COUNT(paid)', 'complete');
}

export function getDiscounts(from: string, to: string): MetricResult {
  const paid = paidOrdersSummary(from, to) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };
  return metric({ from, to }, Number(paid.discounts) || 0, 'Σ orders.discountAmount (paid)', 'complete');
}

export function getOrdersCount(from: string, to: string): MetricResult {
  const paid = paidOrdersSummary(from, to) || { count: 0, revenue: 0, avgOrder: 0, discounts: 0 };
  return metric({ from, to }, Number(paid.count) || 0, 'COUNT(orders.paymentStatus = paid)', 'complete');
}

export function getCOGS(from: string, to: string): MetricResult {
  const rows = paidOrderItemsBetween(from, to);
  const warnings: string[] = [];
  let total = 0;
  let resolved = 0;
  for (const row of rows) {
    const unit = getProductUnitCost(Number(row.productId));
    if (unit.cost == null) {
      warnings.push(`لا تكلفة متاحة للمنتج #${row.productId} (${row.productName || ''})`);
      continue;
    }
    total += unit.cost * (Number(row.quantity) || 0);
    resolved += 1;
  }
  const completeness: Completeness = rows.length === 0 ? 'complete' : resolved === rows.length ? 'complete' : resolved === 0 ? 'unavailable' : 'partial';
  return metric({ from, to }, completeness === 'complete' ? total : null, 'Σ(quantity × unitCost): recipe→inventory.costPrice، وإلا products.cost', completeness, warnings);
}

export function getGrossProfit(from: string, to: string): MetricResult {
  const net = getNetSales(from, to);
  const cogs = getCOGS(from, to);
  if (net.value == null || cogs.value == null) {
    return metric({ from, to }, null, 'NetSales − COGS', 'unavailable', cogs.warnings.length ? cogs.warnings : (net.value == null ? ['Net Sales غير متاحة'] : ['COGS غير مكتملة']));
  }
  return metric({ from, to }, net.value - cogs.value, 'NetSales − COGS', 'complete');
}

export function getOperatingExpenses(from: string, to: string): MetricResult {
  const s = expensesSummary(from, to);
  return metric({ from, to }, s.total, 'Σ expenses.amount', 'complete');
}

export function getOperatingProfit(from: string, to: string): MetricResult {
  const gp = getGrossProfit(from, to);
  const opEx = getOperatingExpenses(from, to);
  if (gp.value == null) {
    return metric({ from, to }, null, 'GrossProfit − Σ expenses.amount', 'unavailable', gp.warnings);
  }
  return metric({ from, to }, gp.value - (opEx.value || 0), 'GrossProfit − Σ expenses.amount', 'complete');
}

export function getCashExpected(from: string, to: string): MetricResult {
  const shift = dailyShift(from);
  const opening = Number(shift?.openingBalance || 0);
  const cashSales = cashPaymentsTotal(from, to);
  const refunds = cashRefundTotal(from, to);
  const expenses = cashExpensesTotal(from, to);
  const warnings = shift ? [] : ['لا سجل daily_shifts للفترة — رصيد الافتتاح صفر'];
  return metric({ from, to }, opening + cashSales - refunds - expenses, 'openingBalance + cash payments − cash refunds − cash expenses', 'complete', warnings);
}

export function getCashReport(from: string, to: string): { expected: number; actual: number | null; difference: number | null; currency: 'SYP' } {
  const expected = getCashExpected(from, to).value || 0;
  const shift = dailyShift(to);
  const actual = shift?.actualCash == null ? null : Number(shift.actualCash);
  const difference = actual == null ? null : actual - expected;
  return { expected, actual, difference, currency: 'SYP' };
}

export interface FinancialReport {
  from: string;
  to: string;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  ordersCount: number;
  aov: number | null;
  cancelledCount: number;
  cogs: number | null;
  grossProfit: number | null;
  expenses: number;
  operatingProfit: number | null;
  paymentMethodTotals: Record<string, number>;
  cash: { expected: number; actual: number | null; difference: number | null };
  currency: 'SYP';
  taxEnabled: boolean;
  completeness: Record<string, Completeness>;
}

export function getFinancialReport(from: string, to: string): FinancialReport {
  const paid = paidOrdersSummary(from, to) || { count: 0, revenue: 0, discounts: 0 };
  const net = getNetSales(from, to);
  const gross = getGrossSales(from, to);
  const refunds = getRefunds(from, to);
  const cogs = getCOGS(from, to);
  const gp = getGrossProfit(from, to);
  const opEx = getOperatingExpenses(from, to);
  const opProfit = getOperatingProfit(from, to);
  const aov = getAOV(from, to);
  const cancelled = getCancelledCount(from, to);
  const cash = getCashReport(from, to);
  const paymentMethodTotals: Record<string, number> = {};
  for (const row of paymentMethods(from, to)) {
    paymentMethodTotals[String(row.method || 'unknown')] = Number(row.total) || 0;
  }
  return {
    from,
    to,
    grossSales: gross.value || 0,
    discounts: Number(paid.discounts) || 0,
    refunds: refunds.value || 0,
    netSales: net.value || 0,
    ordersCount: Number(paid.count) || 0,
    aov: aov.value,
    cancelledCount: cancelled.value || 0,
    cogs: cogs.value,
    grossProfit: gp.value,
    expenses: opEx.value || 0,
    operatingProfit: opProfit.value,
    paymentMethodTotals,
    cash,
    currency: 'SYP',
    taxEnabled: false,
    completeness: {
      netSales: net.completeness,
      discounts: getDiscounts(from, to).completeness,
      refunds: refunds.completeness,
      orders: getOrdersCount(from, to).completeness,
      aov: aov.completeness,
      cancelledCount: cancelled.completeness,
      cogs: cogs.completeness,
      grossProfit: gp.completeness,
      expenses: opEx.completeness,
      operatingProfit: opProfit.completeness,
      cash: 'complete' as Completeness,
      dates: from && to ? 'complete' as Completeness : 'unavailable' as Completeness,
    },
  };
}