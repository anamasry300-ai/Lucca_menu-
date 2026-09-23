import { execute, insert, queryAll, queryOne } from '../db.js';

// ===== الأقسام (categories) — Tier 1 catalog write =====
const CATEGORY_SELECT = 'id, name, name_ar, name_en, icon, color, image, sortOrder, active';
const CATEGORY_COLS: Record<string, string> = {
  name: 'name', name_ar: 'name_ar', name_en: 'name_en', icon: 'icon', color: 'color',
  image: 'image', sortOrder: 'sortOrder', active: 'active',
};

export interface CategoryWriteInput {
  name: string;
  name_ar?: string;
  name_en?: string;
  icon?: string;
  color?: string;
  image?: string;
  sortOrder?: number;
  active?: number;
}

export function allCategories(): Record<string, unknown>[] {
  return queryAll(`SELECT ${CATEGORY_SELECT} FROM categories ORDER BY sortOrder ASC, id ASC`);
}

export function categoryById(id: number): Record<string, unknown> | undefined {
  return queryOne(`SELECT ${CATEGORY_SELECT} FROM categories WHERE id = ?`, [id]);
}

export function categoryByName(name: string, exceptId?: number): Record<string, unknown> | undefined {
  if (exceptId != null) {
    return queryOne(`SELECT id FROM categories WHERE TRIM(name) = TRIM(?) COLLATE NOCASE AND id <> ?`, [name, exceptId]);
  }
  return queryOne(`SELECT id FROM categories WHERE TRIM(name) = TRIM(?) COLLATE NOCASE`, [name]);
}

export function addCategory(input: CategoryWriteInput): number {
  return insert(
    `INSERT INTO categories (name, name_ar, name_en, icon, color, image, sortOrder, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.name, input.name_ar || '', input.name_en || '', input.icon || '', input.color || '', input.image || '', input.sortOrder || 0, input.active ?? 1],
  );
}

export function updateCategoryRow(id: number, fields: Partial<CategoryWriteInput>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(CATEGORY_COLS)) {
    if (fields[key as keyof CategoryWriteInput] !== undefined) {
      sets.push(`\`${CATEGORY_COLS[key]}\` = ?`);
      params.push(fields[key as keyof CategoryWriteInput]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = datetime('now')");
  execute(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deleteCategoryRow(id: number): { changes: number } {
  return execute('DELETE FROM categories WHERE id = ?', [id]);
}

export function productsInCategory(categoryId: number): number {
  const row = queryOne('SELECT COUNT(*) as c FROM products WHERE categoryId = ?', [categoryId]);
  return Number(row?.c || 0);
}

// ===== طرق الدفع (payment_methods) — Tier 1 catalog write =====
const PM_SELECT = 'id, name, name_ar, name_en, type, icon, active, sortOrder';
const PM_COLS: Record<string, string> = {
  name: 'name', name_ar: 'name_ar', name_en: 'name_en', type: 'type',
  icon: 'icon', active: 'active', sortOrder: 'sortOrder',
};

export interface PaymentMethodWriteInput {
  name: string;
  name_ar?: string;
  name_en?: string;
  type?: string;
  icon?: string;
  active?: number;
  sortOrder?: number;
}

export function allPaymentMethods(): Record<string, unknown>[] {
  return queryAll(`SELECT ${PM_SELECT} FROM payment_methods ORDER BY sortOrder ASC, id ASC`);
}

export function paymentMethodById(id: number): Record<string, unknown> | undefined {
  return queryOne(`SELECT ${PM_SELECT} FROM payment_methods WHERE id = ?`, [id]);
}

export function paymentMethodByName(name: string, exceptId?: number): Record<string, unknown> | undefined {
  if (exceptId != null) {
    return queryOne(`SELECT id FROM payment_methods WHERE TRIM(name) = TRIM(?) COLLATE NOCASE AND id <> ?`, [name, exceptId]);
  }
  return queryOne(`SELECT id FROM payment_methods WHERE TRIM(name) = TRIM(?) COLLATE NOCASE`, [name]);
}

export function addPaymentMethod(input: PaymentMethodWriteInput): number {
  return insert(
    `INSERT INTO payment_methods (name, name_ar, name_en, type, icon, active, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.name, input.name_ar || '', input.name_en || '', input.type || 'other', input.icon || '', input.active ?? 1, input.sortOrder || 0],
  );
}

export function updatePaymentMethodRow(id: number, fields: Partial<PaymentMethodWriteInput>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(PM_COLS)) {
    if (fields[key as keyof PaymentMethodWriteInput] !== undefined) {
      sets.push(`\`${PM_COLS[key]}\` = ?`);
      params.push(fields[key as keyof PaymentMethodWriteInput]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = datetime('now')");
  execute(`UPDATE payment_methods SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deletePaymentMethodRow(id: number): { changes: number } {
  return execute('DELETE FROM payment_methods WHERE id = ?', [id]);
}