import { badRequest, conflict, notFound } from '../errors.js';
import {
  addCategory, addPaymentMethod, allCategories, allPaymentMethods, categoryById, categoryByName,
  deleteCategoryRow, deletePaymentMethodRow, paymentMethodById, paymentMethodByName,
  productsInCategory, updateCategoryRow, updatePaymentMethodRow,
} from '../repositories/catalogRepo.js';
import { beginTransaction, commitTransaction, rollbackTransaction } from '../db.js';
import {
  addRecipeRow, addProductRow, deleteProductRecipes, deleteProductRow, inventoryItemByName,
  productByIdRow, productRecipesByProductId, productReferenced, updateProductRow,
} from '../repositories/inventoryRepo.js';
import {
  addTableRow, allocateTableId, deleteTableRow, tableById, tableByNumber, updateTableRow,
} from '../repositories/tablesRepo.js';

export const TABLE_STATUSES = ['available', 'occupied', 'reserved', 'cleaning', 'closed'];
export const PAYMENT_METHOD_TYPES = ['cash', 'card', 'wallet', 'bank', 'other'];
export const PRODUCT_TYPES = ['standard', 'modifier', 'combo'];

function requireNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`الحقل ${field} يجب أن يكون رقماً`);
  return n;
}

// ===================== جداول (Tables) =====================
export function createTable(input: {
  number: number; status?: string; capacity?: number; currentOrder?: number | null; zone?: string;
}): Record<string, unknown> {
  const number = Number(input.number);
  if (!Number.isInteger(number) || number <= 0) throw badRequest('رقم الطاولة يجب أن يكون رقماً صحيحاً موجباً');
  if (tableByNumber(number)) throw conflict(`يوجد جدول برقم ${number} بالفعل`);
  const status = input.status ?? 'available';
  if (!TABLE_STATUSES.includes(status)) throw badRequest(`حالة الطاولة غير صالحة: ${status}`);
  const id = addTableRow({
    id: allocateTableId(),
    number,
    status,
    capacity: input.capacity == null ? 4 : requireNumber(input.capacity, 'capacity'),
    currentOrder: input.currentOrder == null ? null : requireNumber(input.currentOrder, 'currentOrder'),
    zone: input.zone || 'صالة',
  });
  return tableById(id)!;
}

export function updateTable(id: number, fields: {
  number?: number; status?: string; capacity?: number; currentOrder?: number | null; zone?: string;
}): Record<string, unknown> {
  const existing = tableById(id);
  if (!existing) throw notFound('الجدول غير موجود');
  if (fields.number !== undefined) {
    const number = Number(fields.number);
    if (!Number.isInteger(number) || number <= 0) throw badRequest('رقم الطاولة يجب أن يكون رقماً صحيحاً موجباً');
    const dup = tableByNumber(number, id);
    if (dup) throw conflict(`يوجد جدول برقم ${number} بالفعل`);
    fields.number = number;
  }
  if (fields.status !== undefined && !TABLE_STATUSES.includes(fields.status)) {
    throw badRequest(`حالة الطاولة غير صالحة: ${fields.status}`);
  }
  if (fields.capacity !== undefined && fields.capacity != null && Number(fields.capacity) < 1) {
    throw badRequest('سعة الطاولة يجب أن تكون 1 على الأقل');
  }
  updateTableRow(id, fields);
  return tableById(id)!;
}

export function deleteTable(id: number): { deleted: boolean } {
  const existing = tableById(id);
  if (!existing) throw notFound('الجدول غير موجود');
  if (existing.status === 'occupied') throw conflict('لا يمكن حذف جدول مشغول حاليًا');
  deleteTableRow(id);
  return { deleted: true };
}

// ===================== أقسام (Categories) =====================
export function getCategories(): Record<string, unknown>[] {
  return allCategories();
}

export function createCategory(input: {
  name: string; name_ar?: string; name_en?: string; icon?: string; color?: string; image?: string; sortOrder?: number; active?: number;
}): Record<string, unknown> {
  if (!input.name || String(input.name).trim() === '') throw badRequest('اسم القسم مطلوب');
  if (categoryByName(input.name)) throw conflict('يوجد قسم بهذا الاسم بالفعل');
  const id = addCategory({
    name: input.name, name_ar: input.name_ar, name_en: input.name_en, icon: input.icon,
    color: input.color, image: input.image, sortOrder: input.sortOrder, active: input.active,
  });
  return categoryById(id)!;
}

export function updateCategory(id: number, fields: Partial<{
  name: string; name_ar?: string; name_en?: string; icon?: string; color?: string; image?: string; sortOrder?: number; active?: number;
}>): Record<string, unknown> {
  const existing = categoryById(id);
  if (!existing) throw notFound('القسم غير موجود');
  if (fields.name !== undefined) {
    if (String(fields.name).trim() === '') throw badRequest('اسم القسم مطلوب');
    const dup = categoryByName(fields.name, id);
    if (dup) throw conflict('يوجد قسم بهذا الاسم بالفعل');
  }
  updateCategoryRow(id, fields);
  return categoryById(id)!;
}

export function deleteCategory(id: number): { deleted: boolean } {
  const existing = categoryById(id);
  if (!existing) throw notFound('القسم غير موجود');
  const linked = productsInCategory(id);
  if (linked > 0) throw conflict(`لا يمكن حذف قسم يحتوي على ${linked} منتج`);
  deleteCategoryRow(id);
  return { deleted: true };
}

// ===================== منتجات + وصفات (Products & Recipes) =====================
export function createProduct(input: {
  name: string; name_ar?: string; name_en?: string; sku?: string; categoryId?: number;
  price?: number; cost?: number; taxRate?: number; image?: string; description?: string;
  components?: string; available?: number; productType?: string; sortOrder?: number; recipes?: { ingredient: string; quantity: number; unit?: string }[];
}): Record<string, unknown> {
  if (!input.name || String(input.name).trim() === '') throw badRequest('اسم المنتج مطلوب');
  const price = requireNumber(input.price ?? 0, 'price');
  const cost = requireNumber(input.cost ?? 0, 'cost');
  if (price < 0) throw badRequest('السعر لا يمكن أن يكون سالباً');
  if (cost < 0) throw badRequest('التكلفة لا يمكن أن تكون سالبة');
  const productType = input.productType ?? 'standard';
  if (!PRODUCT_TYPES.includes(productType)) throw badRequest(`نوع المنتج غير صالح: ${productType}`);
  const categoryId = input.categoryId == null ? null : Number(input.categoryId);
  if (input.categoryId != null && !categoryById(categoryId!)) throw badRequest('معرف القسم غير موجود');
  const recipes = input.recipes || [];
  for (const r of recipes) {
    if (!r.ingredient || String(r.ingredient).trim() === '') throw badRequest('اسم المكوّن مطلوب');
    if (!inventoryItemByName(r.ingredient)) throw badRequest(`مكوّن الوصفة غير موجود في المخزون: ${r.ingredient}`);
    if (Number(r.quantity) <= 0) throw badRequest('كمية المكوّن يجب أن تكون أكبر من صفر');
  }
  beginTransaction();
  try {
    const id = addProductRow({
      name: input.name, name_ar: input.name_ar, name_en: input.name_en, sku: input.sku, categoryId,
      price, cost, taxRate: input.taxRate ?? 0, image: input.image, description: input.description,
      components: input.components || '[]', available: input.available ?? 1, productType, sortOrder: input.sortOrder ?? 0,
    });
    for (const r of recipes) {
      addRecipeRow(id, r.ingredient, r.quantity, r.unit || '');
    }
    commitTransaction();
    return productByIdRow(id)!;
  } catch (e) {
    rollbackTransaction();
    throw e;
  }
}

export function updateProduct(id: number, fields: Partial<{
  name: string; name_ar?: string; name_en?: string; sku?: string; categoryId?: number;
  price?: number; cost?: number; taxRate?: number; image?: string; description?: string;
  components?: string; available?: number; productType?: string; sortOrder?: number;
}>, recipes?: { ingredient: string; quantity: number; unit?: string }[]): Record<string, unknown> {
  const existing = productByIdRow(id);
  if (!existing) throw notFound('المنتج غير موجود');
  if (fields.name !== undefined && String(fields.name).trim() === '') throw badRequest('اسم المنتج مطلوب');
  if (fields.price !== undefined && Number(fields.price) < 0) throw badRequest('السعر لا يمكن أن يكون سالباً');
  if (fields.cost !== undefined && Number(fields.cost) < 0) throw badRequest('التكلفة لا يمكن أن تكون سالبة');
  if (fields.productType !== undefined && !PRODUCT_TYPES.includes(fields.productType)) {
    throw badRequest(`نوع المنتج غير صالح: ${fields.productType}`);
  }
  const categoryId = fields.categoryId == null ? undefined : Number(fields.categoryId);
  if (fields.categoryId != null && !categoryById(categoryId!)) throw badRequest('معرف القسم غير موجود');
  beginTransaction();
  try {
    updateProductRow(id, { ...fields, categoryId });
    if (recipes !== undefined) {
      for (const r of recipes) {
        if (!r.ingredient || String(r.ingredient).trim() === '') throw badRequest('اسم المكوّن مطلوب');
        if (!inventoryItemByName(r.ingredient)) throw badRequest(`مكوّن الوصفة غير موجود في المخزون: ${r.ingredient}`);
        if (Number(r.quantity) <= 0) throw badRequest('كمية المكوّن يجب أن تكون أكبر من صفر');
      }
      deleteProductRecipes(id);
      for (const r of recipes) {
        addRecipeRow(id, r.ingredient, r.quantity, r.unit || '');
      }
    }
    commitTransaction();
    return productByIdRow(id)!;
  } catch (e) {
    rollbackTransaction();
    throw e;
  }
}

export function deleteProduct(id: number): { deleted: boolean } {
  const existing = productByIdRow(id);
  if (!existing) throw notFound('المنتج غير موجود');
  if (productReferenced(id)) throw conflict('لا يمكن حذف منتج مرجعي في طلبات/أصناف/وصفات سابقة');
  deleteProductRecipes(id);
  deleteProductRow(id);
  return { deleted: true };
}

export function setProductRecipes(productId: number, recipes: { ingredient: string; quantity: number; unit?: string }[]): Record<string, unknown>[] {
  const existing = productByIdRow(productId);
  if (!existing) throw notFound('المنتج غير موجود');
  for (const r of recipes) {
    if (!r.ingredient || String(r.ingredient).trim() === '') throw badRequest('اسم المكوّن مطلوب');
    if (!inventoryItemByName(r.ingredient)) throw badRequest(`مكوّن الوصفة غير موجود في المخزون: ${r.ingredient}`);
    if (Number(r.quantity) <= 0) throw badRequest(`كمية المكوّن ${r.ingredient} يجب أن تكون أكبر من صفر`);
  }
  beginTransaction();
  try {
    deleteProductRecipes(productId);
    for (const r of recipes) {
      addRecipeRow(productId, r.ingredient, r.quantity, r.unit || '');
    }
    commitTransaction();
  } catch (e) {
    rollbackTransaction();
    throw e;
  }
  return getProductRecipes(productId);
}

export function getProductRecipes(productId: number): Record<string, unknown>[] {
  if (!productByIdRow(productId)) throw notFound('المنتج غير موجود');
  return productRecipesByProductId(productId);
}

// ===================== طرق الدفع (Payment Methods) =====================
export function getPaymentMethods(): Record<string, unknown>[] {
  return allPaymentMethods();
}

export function createPaymentMethod(input: {
  name: string; name_ar?: string; name_en?: string; type?: string; icon?: string; active?: number; sortOrder?: number;
}): Record<string, unknown> {
  if (!input.name || String(input.name).trim() === '') throw badRequest('اسم طريقة الدفع مطلوب');
  const type = input.type ?? 'other';
  if (!PAYMENT_METHOD_TYPES.includes(type)) throw badRequest(`نوع طريقة الدفع غير صالح: ${type}`);
  if (paymentMethodByName(input.name)) throw conflict('يوجد طريقة دفع بهذا الاسم بالفعل');
  const id = addPaymentMethod({
    name: input.name, name_ar: input.name_ar, name_en: input.name_en, type,
    icon: input.icon, active: input.active, sortOrder: input.sortOrder,
  });
  return paymentMethodById(id)!;
}

export function updatePaymentMethod(id: number, fields: Partial<{
  name: string; name_ar?: string; name_en?: string; type?: string; icon?: string; active?: number; sortOrder?: number;
}>): Record<string, unknown> {
  const existing = paymentMethodById(id);
  if (!existing) throw notFound('طريقة الدفع غير موجودة');
  if (fields.name !== undefined) {
    if (String(fields.name).trim() === '') throw badRequest('اسم طريقة الدفع مطلوب');
    const dup = paymentMethodByName(fields.name, id);
    if (dup) throw conflict('يوجد طريقة دفع بهذا الاسم بالفعل');
  }
  if (fields.type !== undefined && !PAYMENT_METHOD_TYPES.includes(fields.type)) {
    throw badRequest(`نوع طريقة الدفع غير صالح: ${fields.type}`);
  }
  updatePaymentMethodRow(id, fields);
  return paymentMethodById(id)!;
}

export function deletePaymentMethod(id: number): { deleted: boolean } {
  const existing = paymentMethodById(id);
  if (!existing) throw notFound('طريقة الدفع غير موجودة');
  deletePaymentMethodRow(id);
  return { deleted: true };
}