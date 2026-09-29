import { execute, insert, queryAll, queryOne } from '../db.js';
import { dayBound, rangeDays } from '../dateRange.js';

const TABLE_WRITE_COLS: Record<string, string> = {
  number: 'number', status: 'status', capacity: 'capacity', currentOrder: 'currentOrder', zone: 'zone',
};

export function allTables(): Record<string, unknown>[] {
  return queryAll("SELECT id, number, status, capacity, currentOrder, zone FROM tables_store ORDER BY number");
}

export function tablesSummary(): Record<string, unknown>[] {
  return queryAll("SELECT status, COUNT(*) as count FROM tables_store GROUP BY status ORDER BY count DESC");
}

// P0: daily_shifts.date مفتاح نصّي 'YYYY-MM-DD' — نُطبّع حدود النطاق قبل المقارنة
// وإلا أسقط مدخل بصيغة ISO/SQLite كل الورديات في النطاق.
export function dailyShiftsBetween(from: string, to: string): Record<string, unknown>[] {
  const rng = rangeDays(from, to);
  return queryAll(
    "SELECT date, openingBalance, status, openedAt, closedAt, actualCash, expectedCash, difference, cashSales, cardSales, totalSales, totalExpenses, orderCount, notes FROM daily_shifts WHERE date >= ? AND date <= ? ORDER BY date DESC",
    [rng.from, rng.to],
  );
}

export function systemInfo(): Record<string, unknown> {
  return queryOne("SELECT (SELECT COUNT(*) FROM orders) as orders, (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM products) as products") || { orders: 0, users: 0, products: 0 };
}

// ===== كتابة الطاولات (Tier 1 — catalog write) =====
export function tableById(id: number): Record<string, unknown> | undefined {
  return queryOne("SELECT id, number, status, capacity, currentOrder, zone FROM tables_store WHERE id = ?", [id]);
}

export function tableByNumber(number: number, exceptId?: number): Record<string, unknown> | undefined {
  if (exceptId != null) {
    return queryOne("SELECT id FROM tables_store WHERE number = ? AND id <> ?", [number, exceptId]);
  }
  return queryOne("SELECT id FROM tables_store WHERE number = ?", [number]);
}

export function allocateTableId(): number {
  const row = queryOne("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM tables_store");
  return Number(row?.nextId || 1);
}

export function addTableRow(fields: {
  id?: number; number: number; status?: string; capacity?: number; currentOrder?: number | null; zone?: string;
}): number {
  const id = fields.id ?? allocateTableId();
  insert(
    "INSERT INTO tables_store (id, number, status, capacity, currentOrder, zone, syncId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'))",
    [id, fields.number, fields.status || 'available', fields.capacity ?? 4, fields.currentOrder ?? null, fields.zone || 'صالة'],
  );
  return id;
}

export function updateTableRow(id: number, fields: {
  number?: number; status?: string; capacity?: number; currentOrder?: number | null; zone?: string;
}): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(TABLE_WRITE_COLS)) {
    if (fields[key as keyof typeof fields] !== undefined) {
      sets.push(`\`${TABLE_WRITE_COLS[key]}\` = ?`);
      params.push(fields[key as keyof typeof fields]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = datetime('now')");
  execute(`UPDATE tables_store SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deleteTableRow(id: number): { changes: number } {
  return execute("DELETE FROM tables_store WHERE id = ?", [id]);
}

// ===== كتابة الورديات اليومية (Tier 2 — shift write) =====
// P0: تطبيع مفتاح اليوم (dayBound) في كل قراءة/كتابة daily_shifts.
export function dailyShiftByDate(date: string): Record<string, unknown> | undefined {
  return queryOne("SELECT date, openingBalance, status, openedAt, closedAt, actualCash, expectedCash, difference, cashSales, cardSales, totalSales, totalExpenses, orderCount, notes FROM daily_shifts WHERE date = ?", [dayBound(date, '')]);
}

export function addDailyShiftRow(date: string, openingBalance: number): number {
  return insert(
    "INSERT INTO daily_shifts (date, openingBalance, status, openedAt) VALUES (?, ?, 'open', datetime('now'))",
    [dayBound(date, ''), openingBalance],
  );
}

export function closeDailyShiftRow(date: string, fields: {
  actualCash?: number | null; expectedCash?: number | null; difference?: number | null;
  cashSales?: number; cardSales?: number; totalSales?: number; totalExpenses?: number; orderCount?: number; notes?: string;
}): void {
  const cols: Record<string, string> = {
    actualCash: 'actualCash', expectedCash: 'expectedCash', difference: 'difference',
    cashSales: 'cashSales', cardSales: 'cardSales', totalSales: 'totalSales',
    totalExpenses: 'totalExpenses', orderCount: 'orderCount', notes: 'notes',
  };
  const sets = ["status = 'closed'", "closedAt = datetime('now')"];
  const params: unknown[] = [];
  for (const key of Object.keys(cols)) {
    if (fields[key as keyof typeof fields] !== undefined) {
      sets.push(`\`${cols[key]}\` = ?`);
      params.push(fields[key as keyof typeof fields]);
    }
  }
  execute(`UPDATE daily_shifts SET ${sets.join(', ')} WHERE date = ?`, [...params, dayBound(date, '')]);
}

// ===== كتابة ورديات الموظفين (Tier 2 — shift write عبر طبقة القرار) =====
const SHIFT_COLS = 'id, employeeId, date, startTime, endTime, hoursWorked, status, notes';

export function employeeShiftById(id: number): Record<string, unknown> | undefined {
  return queryOne(`SELECT ${SHIFT_COLS} FROM shifts WHERE id = ?`, [id]);
}

export function activeEmployeeShift(employeeId: number): Record<string, unknown> | undefined {
  return queryOne(
    `SELECT ${SHIFT_COLS} FROM shifts WHERE employeeId = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [employeeId],
  );
}

export function addEmployeeShiftRow(employeeId: number, date: string, startTime: string, notes: string): number {
  return insert(
    "INSERT INTO shifts (employeeId, date, startTime, status, notes) VALUES (?, ?, ?, 'active', ?)",
    [employeeId, date, startTime, notes],
  );
}

export function closeEmployeeShiftRow(id: number, endTime: string, hoursWorked: number, notes: string): void {
  execute(
    "UPDATE shifts SET endTime = ?, hoursWorked = ?, status = 'closed', notes = ? WHERE id = ?",
    [endTime, hoursWorked, notes, id],
  );
}