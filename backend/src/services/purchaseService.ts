import { allSuppliers, purchasesBetween, purchaseById, purchaseTotals, purchasesPage, purchasesPageCount, addPurchaseRow, deletePurchaseRow } from '../repositories/supplierRepo.js';
import { normalizePage, pageResult } from '../pagination.js';
import { badRequest, notFound } from '../errors.js';

const num = (v: unknown): number => Number(v) || 0;

export function getPurchases(options: { from?: string; to?: string; limit?: number } = {}): Record<string, unknown>[] {
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  return purchasesBetween(from, to, options.limit || 200);
}

export function getPurchasesPage(options: { from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  const rows = purchasesPage(from, to, p.page, p.pageSize);
  const total = purchasesPageCount(from, to);
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getPurchase(id: number): Record<string, unknown> | undefined {
  const row = purchaseById(id);
  if (!row) return undefined;
  return {
    id: num(row.id),
    name: String(row.name || ''),
    item: String(row.item || ''),
    quantity: num(row.quantity),
    costPrice: num(row.costPrice),
    total: num(row.total),
    supplier: String(row.supplier || ''),
    notes: String(row.notes || ''),
    date: String(row.date || ''),
    createdBy: String(row.createdBy || ''),
  };
}

export function getPurchaseSummary(options: { from?: string; to?: string } = {}): { total: number; count: number } {
  return purchaseTotals(options.from || '0000-01-01', options.to || '9999-12-31');
}

export function getSuppliers() {
  return allSuppliers();
}

export function createPurchase(input: {
  name?: string; item?: string; quantity?: number; costPrice?: number; total?: number;
  supplier?: string; notes?: string; date?: string; createdBy?: string;
}): Record<string, unknown> {
  const quantity = num(input.quantity ?? 1);
  const costPrice = num(input.costPrice ?? 0);
  if (quantity < 0) throw badRequest('الكمية لا يمكن أن تكون سالبة');
  if (costPrice < 0) throw badRequest('سعر التكلفة لا يمكن أن يكون سالباً');
  const total = input.total != null ? num(input.total) : quantity * costPrice;
  if (total < 0) throw badRequest('الإجمالي لا يمكن أن يكون سالباً');
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw badRequest('صيغة التاريخ غير صالحة');
  const id = addPurchaseRow({ name: input.name, item: input.item, quantity, costPrice, total, supplier: input.supplier, notes: input.notes, date: input.date, createdBy: input.createdBy });
  return getPurchase(id)!;
}

export function removePurchase(id: number): { deleted: boolean } {
  if (!purchaseById(id)) throw notFound('عملية الشراء غير موجودة');
  deletePurchaseRow(id);
  return { deleted: true };
}