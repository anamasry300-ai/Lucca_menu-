import {
  getNetSales, getGrossSales, getRefunds, getCOGS, getGrossProfit,
  getOperatingExpenses as getOperatingExpensesMetric, getOperatingProfit, getAOV,
  getCancelledCount, getDiscounts, getOrdersCount, getCashExpected, getCashReport, getFinancialReport,
} from './reportService.js';
import { getStock, getStockValue } from './inventoryService.js';
import { getExpenseSummary } from './expenseService.js';
import { getPurchaseSummary as purchaseSummary } from './purchaseService.js';

const today = () => new Date().toISOString().slice(0, 10);

export function getSalesSummary(from: string, to: string) {
  const grossSales = getGrossSales(from, to).value || 0;
  const refunds = getRefunds(from, to).value || 0;
  const net = getNetSales(from, to);
  const aov = getAOV(from, to);
  const netValue = net.value || 0;
  return {
    grossSales,
    discounts: getDiscounts(from, to).value || 0,
    refunds,
    netSales: netValue,
    ordersCount: Math.round(getOrdersCount(from, to).value || 0),
    aov: aov.value,
    cancelledCount: getCancelledCount(from, to).value || 0,
  };
}

export function getProfitAndLoss(from: string, to: string) {
  const netSales = getNetSales(from, to);
  const cogs = getCOGS(from, to);
  const grossProfit = getGrossProfit(from, to);
  const operatingExpenses = getOperatingExpensesMetric(from, to);
  const operatingProfit = getOperatingProfit(from, to);
  return {
    netSales: netSales.value,
    cogs: cogs.value,
    grossProfit: grossProfit.value,
    operatingExpenses: operatingExpenses.value,
    operatingProfit: operatingProfit.value,
    currency: 'SYP' as const,
    completeness: {
      netSales: netSales.completeness,
      cogs: cogs.completeness,
      grossProfit: grossProfit.completeness,
      operatingProfit: operatingProfit.completeness,
    },
  };
}

export function getCashDrawer(from: string, to: string) {
  return getCashReport(from, to);
}

export function getInventorySummary() {
  const items = getStock();
  return {
    totalValue: getStockValue(),
    totalItems: items.length,
    lowStock: items.filter((i) => i.status === 'low').length,
    outOfStock: items.filter((i) => i.status === 'out').length,
    items,
  };
}

export function getPurchaseSummary(from: string, to: string) {
  const s = purchaseSummary({ from, to });
  return { total: s.total, count: s.count, currency: 'SYP' as const };
}

export function getOperatingExpenses(from: string, to: string) {
  const s = getExpenseSummary({ from, to });
  return { total: s.total, count: s.count, cash: s.cash, byCategory: s.byCategory, currency: 'SYP' as const };
}

export function getFinancialReportForPeriod(from?: string, to?: string) {
  const f = from || today();
  const t = to || today();
  return getFinancialReport(f, t);
}

export { getCashExpected };