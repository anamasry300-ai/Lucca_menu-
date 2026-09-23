import { badRequest, conflict, notFound } from '../errors.js';
import { addDailyShiftRow, closeDailyShiftRow, dailyShiftByDate } from '../repositories/tablesRepo.js';
import { cashPaymentsTotal, cashRefundTotal, nonCashPaymentsTotal, paidOrdersSummary } from '../repositories/ordersRepo.js';
import { cashExpensesTotal } from '../repositories/expensesRepo.js';

const num = (v: unknown): number => Number(v) || 0;

function window(date: string): { from: string; to: string } {
  return { from: `${date}T00:00:00`, to: `${date}T23:59:59` };
}

export function openDailyShift(date: string, openingBalance: number): Record<string, unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('صيغة التاريخ غير صالحة');
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw badRequest('رصيد الافتتاح يجب أن يكون رقماً غير سالب');
  const existing = dailyShiftByDate(date);
  if (existing) {
    if (existing.status === 'open') throw conflict('الوردية مفتوحة بالفعل لهذا اليوم');
    throw conflict('الوردية مغلقة بالفعل لهذا اليوم');
  }
  addDailyShiftRow(date, openingBalance);
  return dailyShiftByDate(date)!;
}

export function closeDailyShift(date: string, actualCash: number, notes?: string): Record<string, unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('صيغة التاريخ غير صالحة');
  if (!Number.isFinite(actualCash) || actualCash < 0) throw badRequest('رصيد الخزنة الفعلي يجب أن يكون رقماً غير سالب');
  const shift = dailyShiftByDate(date);
  if (!shift) throw notFound('لا توجد وردية مفتوحة لهذا اليوم');
  if (shift.status === 'closed') throw conflict('الوردية مغلقة بالفعل لهذا اليوم');
  const w = window(date);
  const opening = num(shift.openingBalance);
  const cashSales = cashPaymentsTotal(w.from, w.to);
  const cardSales = nonCashPaymentsTotal(w.from, w.to);
  const refunds = cashRefundTotal(w.from, w.to);
  const expenses = cashExpensesTotal(w.from, w.to);
  const expected = opening + cashSales - refunds - expenses;
  const paid = paidOrdersSummary(w.from, w.to) || { count: 0, revenue: 0 };
  closeDailyShiftRow(date, {
    actualCash, expectedCash: expected, difference: Number((actualCash - expected).toFixed(2)),
    cashSales, cardSales, totalSales: Number((cashSales + cardSales).toFixed(2)),
    totalExpenses: expenses, orderCount: num(paid.count), notes: notes || '',
  });
  return dailyShiftByDate(date)!;
}