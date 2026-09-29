import { execute, insert, queryAll, queryOne } from '../db.js';
import { dayBound } from '../dateRange.js';

export interface ExpenseInput {
  amount: number;
  description?: string;
  category?: string;
  paymentMethod?: string;
  createdBy?: string;
}

// P0: حدود النطاق تُختزل إلى يوم (dayBound) — expenses.date يُخزَّن ISO، والحدّ
// ذي الوقت ('...T00:00:00') كان يُسقط كل مصروفات اليوم من cashExpensesTotal/التقرير.
export function expensesSummary(from: string, to: string): { total: number; count: number } {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ?",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')],
  ) || { total: 0, count: 0 };
  return { total: Number(row.total) || 0, count: Number(row.count) || 0 };
}

export function cashExpensesTotal(from: string, to: string): number {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE paymentMethod = 'cash' AND date(date) >= ? AND date(date) <= ?",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')],
  );
  return Number(row?.total || 0);
}

export function expensesByCategory(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT category as name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ? GROUP BY category ORDER BY total DESC",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')],
  );
}

export function expensesByEmployee(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT createdBy as name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ? GROUP BY createdBy ORDER BY total DESC",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')],
  );
}

export function recentExpenses(from: string, to: string, limit = 100): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, amount, description, category, paymentMethod, createdBy, date, createdAt FROM expenses WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC LIMIT ?",
    [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31'), limit],
  );
}

export function expensesPage(from: string, to: string, category: string | undefined, page: number, pageSize: number): Record<string, unknown>[] {
  const clauses = ['date(date) >= ?', 'date(date) <= ?'];
  const params: unknown[] = [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')];
  if (category) { clauses.push('category = ?'); params.push(category); }
  return queryAll(
    `SELECT id, amount, description, category, paymentMethod, createdBy, date, createdAt FROM expenses WHERE ${clauses.join(' AND ')} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
}

export function expensesPageCount(from: string, to: string, category: string | undefined): number {
  const clauses = ['date(date) >= ?', 'date(date) <= ?'];
  const params: unknown[] = [dayBound(from, '0000-01-01'), dayBound(to, '9999-12-31')];
  if (category) { clauses.push('category = ?'); params.push(category); }
  return Number((queryOne(`SELECT COUNT(*) as c FROM expenses WHERE ${clauses.join(' AND ')}`, params))?.c || 0);
}

export function addExpense(input: ExpenseInput): number {
  return insert(
    'INSERT INTO expenses (amount, description, category, paymentMethod, createdBy, date) VALUES (?, ?, ?, ?, ?, ?)',
    [
      input.amount,
      input.description || '',
      input.category || 'general',
      input.paymentMethod || 'cash',
      input.createdBy || 'system',
      new Date().toISOString(),
    ],
  );
}

export function deleteExpense(id: number): { changes: number } {
  return execute('DELETE FROM expenses WHERE id = ?', [id]);
}