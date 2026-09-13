import { queryOne } from '../db.js';
import {
  paidOrdersSummary, cancelledCount, salesByDay, salesByCategory, topProducts,
  paymentMethods, cogsFor, salesGroupedByPeriod,
} from '../repositories/ordersRepo.js';
import { expensesSummary, expensesByCategory, expensesByEmployee, recentExpenses } from '../repositories/expensesRepo.js';
import { allInventory, inventoryValue, activeAlerts, stockMovementsWithNames } from '../repositories/inventoryRepo.js';
import { allSuppliers, supplierPurchaseTotals, recentPurchases } from '../repositories/supplierRepo.js';
import { allEmployees, employeePerformance, attendanceFor } from '../repositories/employeeRepo.js';

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

export function refundTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
    [from, to],
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

function anyProductCost(): boolean {
  try {
    const row = queryOne("SELECT COALESCE(SUM(COALESCE(cost, 0)), 0) as c FROM products");
    return Number(row?.c || 0) > 0;
  } catch { return false; }
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
  const netSales = revenue - discounts - refunds;
  const prevNetSales = (Number(prev.revenue) || 0) - prevRefunds;
  const prevRevenue = Number(prev.revenue) || 0;
  const prevOrders = Number(prev.count) || 0;
  const prevAvg = Number(prev.avgOrder) || 0;

  const cogs = cogsFor(from, to);
  const hasCostData = cogs > 0 || anyProductCost();
  const grossProfit = hasCostData ? netSales - cogs : null;
  const grossMargin = hasCostData && netSales > 0 ? Number(((grossProfit as number) / netSales * 100).toFixed(1)) : null;

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