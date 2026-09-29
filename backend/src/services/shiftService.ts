import { badRequest, conflict, notFound } from '../errors.js';
import {
  activeEmployeeShift, addDailyShiftRow, addEmployeeShiftRow, closeDailyShiftRow,
  closeEmployeeShiftRow, dailyShiftByDate, employeeShiftById,
} from '../repositories/tablesRepo.js';
import { cashPaymentsTotal, cashRefundTotal, nonCashPaymentsTotal, paidOrdersSummary } from '../repositories/ordersRepo.js';
import { cashExpensesTotal } from '../repositories/expensesRepo.js';
import { dayBound, rangeDays } from '../dateRange.js';

const num = (v: unknown): number => Number(v) || 0;

// P0: حدود يومية بصيغة 'YYYY-MM-DD' فقط.
// السبب: payments/refunds.createdAt تُخزَّن بصيغة SQLite 'YYYY-MM-DD HH:MM:SS'،
// والحدّ 'YYYY-MM-DDTHH:00:00' كان يُسقط كل صفحات اليوم (المسافة 0x20 < 'T' 0x54) فتُكتب
// أرقام daily_shifts كلها أصفاراً. rangeDays في dateRange.ts يفرض الصيغة المرجعية.
function window(date: string): { from: string; to: string } {
  return rangeDays(date, date);
}

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const nowTime = (): string => new Date().toISOString().slice(11, 19);

function employeeId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw badRequest('معرف الموظف غير صالح');
  return id;
}

// P0: dayBound يقبل أي صيغة طابع (ISO / SQLite) ويختزلها 'YYYY-MM-DD' —
// عميل يرسل '2026-05-10T10:00:00.000Z' كان يُرفض 400 أو ينشئ مفتاحاً لا يُطابق daily_shifts.date.
function requireDay(raw: unknown): string {
  const day = dayBound(raw, '');
  if (!day) throw badRequest('صيغة التاريخ غير صالحة');
  return day;
}

export function openDailyShift(date: string, openingBalance: number): Record<string, unknown> {
  const day = requireDay(date);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw badRequest('رصيد الافتتاح يجب أن يكون رقماً غير سالب');
  const existing = dailyShiftByDate(day);
  if (existing) {
    if (existing.status === 'open') throw conflict('الوردية مفتوحة بالفعل لهذا اليوم');
    throw conflict('الوردية مغلقة بالفعل لهذا اليوم');
  }
  addDailyShiftRow(day, openingBalance);
  return dailyShiftByDate(day)!;
}

export function closeDailyShift(date: string, actualCash: number, notes?: string): Record<string, unknown> {
  const day = requireDay(date);
  if (!Number.isFinite(actualCash) || actualCash < 0) throw badRequest('رصيد الخزنة الفعلي يجب أن يكون رقماً غير سالب');
  const shift = dailyShiftByDate(day);
  if (!shift) throw notFound('لا توجد وردية مفتوحة لهذا اليوم');
  if (shift.status === 'closed') throw conflict('الوردية مغلقة بالفعل لهذا اليوم');
  const w = window(day);
  const opening = num(shift.openingBalance);
  const cashSales = cashPaymentsTotal(w.from, w.to);
  const cardSales = nonCashPaymentsTotal(w.from, w.to);
  const refunds = cashRefundTotal(w.from, w.to);
  const expenses = cashExpensesTotal(w.from, w.to);
  const expected = opening + cashSales - refunds - expenses;
  const paid = paidOrdersSummary(w.from, w.to) || { count: 0, revenue: 0 };
  closeDailyShiftRow(day, {
    actualCash, expectedCash: expected, difference: Number((actualCash - expected).toFixed(2)),
    cashSales, cardSales, totalSales: Number((cashSales + cardSales).toFixed(2)),
    totalExpenses: expenses, orderCount: num(paid.count), notes: notes || '',
  });
  return dailyShiftByDate(day)!;
}

// ===== وردية الموظف (حضور/انصراف تشغيلي) — مصدر الحقيقة: SQLite =====
export function startEmployeeShift(rawEmployeeId: unknown, date?: string, notes?: string): Record<string, unknown> {
  const id = employeeId(rawEmployeeId);
  const day = date || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest('صيغة التاريخ غير صالحة');
  if (activeEmployeeShift(id)) throw conflict('يوجد وردية نشطة لهذا الموظف بالفعل');
  const rowId = addEmployeeShiftRow(id, day, nowTime(), notes || '');
  return employeeShiftById(rowId)!;
}

export function endEmployeeShift(rawEmployeeId: unknown, notes?: string): Record<string, unknown> {
  const id = employeeId(rawEmployeeId);
  const open = activeEmployeeShift(id);
  if (!open) throw notFound('لا توجد وردية نشطة لهذا الموظف');
  if (open.status === 'closed') throw conflict('الوردية مغلقة بالفعل');
  const end = nowTime();
  const start = String(open.startTime || '');
  let hours = 0;
  if (/^\d{2}:\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}:\d{2}$/.test(end)) {
    const secs = (t: string): number => Number(t.slice(0, 2)) * 3600 + Number(t.slice(3, 5)) * 60 + Number(t.slice(6, 8));
    hours = Math.max(0, (secs(end) - secs(start)) / 3600);
  }
  const rowId = Number(open.id);
  closeEmployeeShiftRow(rowId, end, Number(hours.toFixed(2)), notes || String(open.notes || ''));
  return employeeShiftById(rowId)!;
}