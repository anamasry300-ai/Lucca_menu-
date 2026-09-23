import {
  expensesSummary, expensesByCategory, recentExpenses, addExpense, deleteExpense, cashExpensesTotal,
  expensesPage, expensesPageCount,
} from '../repositories/expensesRepo.js';
import { normalizePage, pageResult } from '../pagination.js';

export function getExpenses(options: { from?: string; to?: string; limit?: number } = {}): Record<string, unknown>[] {
  return recentExpenses(options.from || '0000-01-01', options.to || '9999-12-31', options.limit || 100);
}

export function getExpensesPage(options: { from?: string; to?: string; page?: number; pageSize?: number; category?: string } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  const rows = expensesPage(from, to, options.category, p.page, p.pageSize);
  const total = expensesPageCount(from, to, options.category);
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getExpenseSummary(options: { from?: string; to?: string } = {}): { total: number; count: number; byCategory: Record<string, unknown>[]; cash: number } {
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  const s = expensesSummary(from, to);
  return {
    total: s.total,
    count: s.count,
    byCategory: expensesByCategory(from, to),
    cash: cashExpensesTotal(from, to),
  };
}

export function getCashExpenses(options: { from?: string; to?: string } = {}): number {
  return cashExpensesTotal(options.from || '0000-01-01', options.to || '9999-12-31');
}

export function createExpense(input: { amount: number; description?: string; category?: string; paymentMethod?: string; createdBy?: string }): number {
  return addExpense(input);
}

export function removeExpense(id: number): boolean {
  const r = deleteExpense(id);
  return r.changes > 0;
}