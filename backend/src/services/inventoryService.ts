import {
  allInventory, inventoryValue, inventoryById, inventoryByTrimmedName,
  productCostById, productRecipesForProduct, stockMovements, stockMovementsForProduct,
  stockPage, stockPageCount, movementsPage, movementsPageCount, productsPage, productsPageCount,
  addInventoryItem, updateInventoryItem, deleteInventoryItem, setInventoryQuantity,
  insertStockMovement, insertWasteRow,
} from '../repositories/inventoryRepo.js';
import { queryOne } from '../db.js';
import { normalizePage, pageResult } from '../pagination.js';
import { badRequest, conflict, notFound } from '../errors.js';

const num = (v: unknown): number => Number(v) || 0;
const str = (v: unknown): string => String(v == null ? '' : v);

export function getStock() {
  return allInventory();
}

export function getStockItem(id: number) {
  return inventoryById(id);
}

export function getStockValue(): number {
  return inventoryValue(allInventory());
}

export function getStockMovements(options: { from?: string; to?: string; productId?: number; limit?: number } = {}): Record<string, unknown>[] {
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  if (options.productId != null) return stockMovementsForProduct(options.productId, options.limit || 200);
  return stockMovements(from, to, options.limit || 200);
}

export function getStockPage(options: { page?: number; pageSize?: number; q?: string; status?: string } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const rows = stockPage({ q: options.q, status: options.status, page: p.page, pageSize: p.pageSize });
  const total = stockPageCount({ q: options.q, status: options.status });
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getMovementsPage(options: { from?: string; to?: string; productId?: number; page?: number; pageSize?: number } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const from = options.from || '0000-01-01';
  const to = options.to || '9999-12-31';
  const rows = movementsPage(from, to, options.productId, p.page, p.pageSize);
  const total = movementsPageCount(from, to, options.productId);
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getProductsPage(options: { page?: number; pageSize?: number; q?: string; categoryId?: number } = {}) {
  const p = normalizePage(options.page, options.pageSize);
  const rows = productsPage({ q: options.q, categoryId: options.categoryId, page: p.page, pageSize: p.pageSize });
  const total = productsPageCount({ q: options.q, categoryId: options.categoryId });
  return pageResult(rows, total, p.page, p.pageSize);
}

export function getProductStock(productId: number): Record<string, unknown>[] {
  const recipes = productRecipesForProduct(productId);
  const matches: Record<string, unknown>[] = [];
  for (const r of recipes) {
    const item = inventoryByTrimmedName(str(r.ingredient));
    if (item) {
      matches.push({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, minStock: item.minStock, costPrice: item.costPrice, status: item.status });
    }
  }
  if (matches.length > 0) return matches;
  const product = queryOne('SELECT id, name FROM products WHERE id = ?', [productId]);
  const name = product ? str(product.name) : '';
  if (!name) return [];
  return allInventory()
    .filter((i) => i.name && i.name.toLowerCase().includes(name.toLowerCase()))
    .map((i) => ({ id: i.id, name: i.name, quantity: i.quantity }));
}

export interface ProductUnitCost {
  cost: number | null;
  source: 'recipe' | 'product' | 'none';
  completeness: 'complete' | 'unavailable';
}

export function getProductUnitCost(productId: number): ProductUnitCost {
  const recipes = productRecipesForProduct(productId);
  if (recipes.length > 0) {
    let total = 0;
    let allResolved = true;
    for (const r of recipes) {
      const ingredient = inventoryByTrimmedName(str(r.ingredient));
      if (!ingredient) {
        allResolved = false;
        break;
      }
      total += num(r.quantity) * ingredient.costPrice;
    }
    if (allResolved) return { cost: total, source: 'recipe', completeness: 'complete' };
  }
  const fallback = productCostById(productId);
  if (fallback > 0) return { cost: fallback, source: 'product', completeness: 'complete' };
  return { cost: null, source: 'none', completeness: 'unavailable' };
}

// ===== كتابة المخزون (Tier 2 — عبر نفس الخدمة المستخدمة بالتقارير) =====
function stockRow(id: number): Record<string, unknown> | undefined {
  const item = inventoryById(id);
  return item ? { ...item } : undefined;
}

export function createStockItem(input: { name: string; quantity?: number; unit?: string; minStock?: number; costPrice?: number }): Record<string, unknown> {
  if (!input.name || String(input.name).trim() === '') throw badRequest('اسم الصنف مطلوب');
  if (inventoryByTrimmedName(input.name)) throw conflict('يوجد صنف بهذا الاسم بالفعل');
  const quantity = num(input.quantity);
  if (quantity < 0) throw badRequest('الكمية لا يمكن أن تكون سالبة');
  if (num(input.costPrice) < 0) throw badRequest('سعر التكلفة لا يمكن أن يكون سالباً');
  const id = addInventoryItem({ name: input.name, quantity, unit: input.unit, minStock: num(input.minStock), costPrice: num(input.costPrice) });
  return stockRow(id)!;
}

export function updateStockItem(id: number, fields: { name?: string; unit?: string; minStock?: number; costPrice?: number }): Record<string, unknown> {
  const item = inventoryById(id);
  if (!item) throw notFound('الصنف غير موجود');
  if (fields.name !== undefined) {
    if (String(fields.name).trim() === '') throw badRequest('اسم الصنف مطلوب');
    const dup = inventoryByTrimmedName(fields.name);
    if (dup && num(dup.id) !== id) throw conflict('يوجد صنف بهذا الاسم بالفعل');
  }
  if (fields.costPrice !== undefined && num(fields.costPrice) < 0) throw badRequest('سعر التكلفة لا يمكن أن يكون سالباً');
  updateInventoryItem(id, fields);
  return stockRow(id)!;
}

export function removeStockItem(id: number): { deleted: boolean } {
  const item = inventoryById(id);
  if (!item) throw notFound('الصنف غير موجود');
  if (num(item.quantity) !== 0) throw conflict('لا يمكن حذف صنف برصيد غير صفري — صحّح الكمية أولاً');
  deleteInventoryItem(id);
  return { deleted: true };
}

export function adjustStock(id: number, delta: number, notes?: string): Record<string, unknown> {
  const item = inventoryById(id);
  if (!item) throw notFound('الصنف غير موجود');
  const d = num(delta);
  if (d === 0) throw badRequest('الفرق يجب ألا يكون صفراً');
  const newQty = num(item.quantity) + d;
  if (newQty < 0) throw badRequest('الكمية الناتجة لا يمكن أن تكون سالبة');
  setInventoryQuantity(id, newQty);
  insertStockMovement({ productId: id, quantity: d, type: 'adjust', notes });
  return stockRow(id)!;
}

export function recordWaste(id: number, quantity: number, reason?: string): Record<string, unknown> {
  const item = inventoryById(id);
  if (!item) throw notFound('الصنف غير موجود');
  const q = num(quantity);
  if (q <= 0) throw badRequest('كمية التالف يجب أن تكون أكبر من صفر');
  const newQty = num(item.quantity) - q;
  if (newQty < 0) throw badRequest('الكمية الناتجة لا يمكن أن تكون سالبة');
  setInventoryQuantity(id, newQty);
  insertWasteRow({ productId: id, quantity: q, reason });
  insertStockMovement({ productId: id, quantity: -q, type: 'waste', notes: reason });
  return stockRow(id)!;
}