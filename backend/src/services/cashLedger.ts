import { insert, queryOne, beginTransaction, commitTransaction, rollbackTransaction } from '../db.js';
import { dayBound } from '../dateRange.js';

export type CashRefType = 'expense' | 'payment' | 'refund' | 'opening' | 'adjustment' | 'reversal' | 'manual';

// المبلغ يُخزّن بأصغر وحدة نقدية صحيحة (قرش مصري = 1/100 جنيه)، عددًا صحيحًا ≥ 0.
// الاتجاه يُحدّد عبر direction: 'in' = تدفق داخل الخزنة، 'out' = تدفق خارج منها.
export interface CashMovementInput {
  branchId: number;
  shiftDate?: string;              // تاريخ الوردية اليومية المرتبطة (yyyy-mm-dd)
  direction: 'in' | 'out';
  amount: number;                  // بالقرش (int ≥ 0)
  referenceType: CashRefType;
  referenceId: number | null;
  idempotencyKey?: string;         // إن تكرر الطلب بالمفتاح نفسه، تُعاد الحركة القائمة دون تكرار
  note?: string;
  createdBy: string;
  createdByUser?: number | null;
}

export interface CashMovementResult {
  id: number;
  inserted: boolean;               // false إن كانت الحركة موجودة سلفاً لنفس مفتاح التهيؤ
}

/**
 * تسجّل حركة نقدية واحدة فقط. إن وفُد idempotencyKey وحركة قائمة بنفس المفتاح، تُعاد القائمة بدون تكرار.
 * تُنفّذ داخل معاملة لحفظ اتساق السجل المالي.
 */
export function recordCashMovement(input: CashMovementInput): CashMovementResult {
  if (input.idempotencyKey) {
    try {
      const existing = queryOne('SELECT id FROM cash_movements WHERE idempotency_key = ?', [input.idempotencyKey]);
      if (existing) return { id: Number(existing.id), inserted: false };
    } catch { /* الجدول قد لا يكون موجوداً بعد — نُكمل الإدراج */ }
  }
  const amountPiastres = Math.max(0, Math.round(Number(input.amount) || 0));
  beginTransaction();
  try {
    const id = insert(
      `INSERT INTO cash_movements
         (branch_id, shift_date, direction, amount, reference_type, reference_id, idempotency_key, note, created_by, created_by_user, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.branchId,
        input.shiftDate ?? null,
        input.direction,
        amountPiastres,
        input.referenceType,
        input.referenceId ?? null,
        input.idempotencyKey ?? null,
        input.note ?? '',
        input.createdBy,
        input.createdByUser ?? null,
      ],
    );
    commitTransaction();
    return { id: Number(id), inserted: true };
  } catch (e) {
    rollbackTransaction();
    throw e;
  }
}

/**
 * صافي الحركات النقدية (بالقرش) لنطاق تواريخ وفرع اختياري: الداخل موجب، الخارج سالب.
 * يُستخدَم لحساب النقدية المتوقعة من دفتر الحركات (مصدر الحقيقة).
 */
export function sumCashMovements(from: string, to: string, branchId?: number): number {
  const bc = branchId == null ? { sql: '', params: [] as unknown[] } : { sql: ' AND branch_id = ?', params: [branchId] };
  const row = queryOne(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) as net
     FROM cash_movements
     WHERE date(created_at) >= ? AND date(created_at) <= ? ${bc.sql}`,
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31'), ...bc.params],
  );
  return Number(row?.net || 0);
}

/**
 * صافي الحركات النقدية (بالقرش) لتاريخ محدد وفرع.
 */
export function sumCashMovementsForDate(date: string, branchId?: number): number {
  const d = dayBound(date, '');
  const bc = branchId == null ? { sql: '', params: [] as unknown[] } : { sql: ' AND branch_id = ?', params: [branchId] };
  const row = queryOne(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) as net
     FROM cash_movements
     WHERE shift_date = ? ${bc.sql}`,
    [d, ...bc.params],
  );
  return Number(row?.net || 0);
}

/** تحويل مبلغ بالجنيه إلى قرش (أصغر وحدة صحيحة). */
export function toPiastres(egp: number): number { return Math.max(0, Math.round(Number(egp) || 0) * 100); }
/** تحويل قرش إلى جنيه. */
export function fromPiastres(p: number): number { return Number(p || 0) / 100; }
