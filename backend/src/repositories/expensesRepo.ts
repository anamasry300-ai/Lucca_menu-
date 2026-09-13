import { execute, insert, queryAll, queryOne } from '../db.js';

export interface ExpenseInput {
  amount: number;
  description?: string;
  category?: string;
  paymentMethod?: string;
  createdBy?: string;
}

export function expensesSummary(from: string, to: string): { total: number; count: number } {
  const row = queryOne(
    "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ?",
    [from, to],
  ) || { total: 0, count: 0 };
  return { total: Number(row.total) || 0, count: Number(row.count) || 0 };
}

export function expensesByCategory(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT category as name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ? GROUP BY category ORDER BY total DESC",
    [from, to],
  );
}

export function expensesByEmployee(from: string, to: string): Record<string, unknown>[] {
  return queryAll(
    "SELECT createdBy as name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE date(date) >= ? AND date(date) <= ? GROUP BY createdBy ORDER BY total DESC",
    [from, to],
  );
}

export function recentExpenses(from: string, to: string, limit = 100): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, amount, description, category, paymentMethod, createdBy, date, createdAt FROM expenses WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC LIMIT ?",
    [from, to, limit],
  );
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