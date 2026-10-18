import { execute, insert, queryAll, queryOne } from '../db.js';

// =====================================================================
// Public Menu (المنيو العام للعملاء) — جداول مستقلة تماماً عن المحاسبة/الكاشير.
// لا يُلمس أي جدول من جداول POS. كل القراءة/الكتابة هنا محصورة في menu_categories/menu_items
// + مفتاح إعداد واحد في جدول settings (menu_*).
// =====================================================================

export interface MenuCategoryInput {
  name_ar: string;
  name_en?: string;
  icon?: string;
  sort_order?: number;
  is_visible?: number;
}

export interface MenuItemInput {
  category_id: number;
  name_ar: string;
  name_en?: string;
  description?: string;
  price?: number;
  image_path?: string;
  thumb_path?: string;
  is_available?: number;
  is_featured?: number;
  sort_order?: number;
}

const CATEGORY_COLS: Record<string, string> = {
  name_ar: 'name_ar', name_en: 'name_en', icon: 'icon',
  sort_order: 'sort_order', is_visible: 'is_visible',
};

const ITEM_COLS: Record<string, string> = {
  category_id: 'category_id', name_ar: 'name_ar', name_en: 'name_en',
  description: 'description', price: 'price', image_path: 'image_path',
  thumb_path: 'thumb_path', is_available: 'is_available',
  is_featured: 'is_featured', sort_order: 'sort_order',
};

// ===== التصنيفات =====
export function allMenuCategories(includeHidden = true): Record<string, unknown>[] {
  const where = includeHidden ? '' : 'WHERE is_visible = 1';
  return queryAll(`SELECT * FROM menu_categories ${where} ORDER BY sort_order ASC, id ASC`);
}

export function menuCategoryById(id: number): Record<string, unknown> | undefined {
  return queryOne('SELECT * FROM menu_categories WHERE id = ?', [id]);
}

export function addMenuCategory(input: MenuCategoryInput): number {
  return insert(
    `INSERT INTO menu_categories (name_ar, name_en, icon, sort_order, is_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [input.name_ar, input.name_en || '', input.icon || '', input.sort_order || 0, input.is_visible ?? 1],
  );
}

export function updateMenuCategoryRow(id: number, fields: Partial<MenuCategoryInput>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(CATEGORY_COLS)) {
    const v = fields[key as keyof MenuCategoryInput];
    if (v !== undefined) { sets.push(`\`${CATEGORY_COLS[key]}\` = ?`); params.push(v); }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  execute(`UPDATE menu_categories SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deleteMenuCategoryRow(id: number): { changes: number } {
  return execute('DELETE FROM menu_categories WHERE id = ?', [id]);
}

export function menuItemsInCategory(categoryId: number): number {
  const row = queryOne('SELECT COUNT(*) AS c FROM menu_items WHERE category_id = ? AND is_deleted = 0', [categoryId]);
  return Number(row?.c || 0);
}

export function reorderMenuCategories(ids: number[]): void {
  for (let i = 0; i < ids.length; i++) {
    execute("UPDATE menu_categories SET sort_order = ?, updated_at = datetime('now') WHERE id = ?", [i, ids[i]]);
  }
}

// ===== المنتجات =====
export function menuItemById(id: number): Record<string, unknown> | undefined {
  return queryOne('SELECT * FROM menu_items WHERE id = ?', [id]);
}

export function allMenuItems(opts: { categoryId?: number; search?: string; includeDeleted?: boolean } = {}): Record<string, unknown>[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeDeleted) clauses.push('is_deleted = 0');
  if (opts.categoryId) { clauses.push('category_id = ?'); params.push(opts.categoryId); }
  if (opts.search) {
    clauses.push('(name_ar LIKE ? OR name_en LIKE ? OR description LIKE ?)');
    const like = `%${opts.search.trim()}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return queryAll(`SELECT * FROM menu_items ${where} ORDER BY sort_order ASC, id ASC`, params);
}

export function addMenuItem(input: MenuItemInput): number {
  return insert(
    `INSERT INTO menu_items
      (category_id, name_ar, name_en, description, price, image_path, thumb_path,
       is_available, is_featured, is_deleted, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
    [
      input.category_id, input.name_ar, input.name_en || '', input.description || '',
      input.price || 0, input.image_path || '', input.thumb_path || '',
      input.is_available ?? 1, input.is_featured ?? 0, input.sort_order || 0,
    ],
  );
}

export function updateMenuItemRow(id: number, fields: Partial<MenuItemInput> & { is_deleted?: number }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(ITEM_COLS)) {
    const v = fields[key as keyof MenuItemInput];
    if (v !== undefined) { sets.push(`\`${ITEM_COLS[key]}\` = ?`); params.push(v); }
  }
  if (fields.is_deleted !== undefined) { sets.push('is_deleted = ?'); params.push(fields.is_deleted); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  execute(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function reorderMenuItems(ids: number[]): void {
  for (let i = 0; i < ids.length; i++) {
    execute("UPDATE menu_items SET sort_order = ?, updated_at = datetime('now') WHERE id = ?", [i, ids[i]]);
  }
}

// كم منتج/تصنيف حيّ آخر يُشير إلى نفس ملف الصورة (image_path أو thumb_path)؟ — يُستخدم قبل حذف الملف.
export function menuImagePathUsageCount(p: string, excludeItemId?: number): number {
  const row = queryOne(
    'SELECT COUNT(*) AS c FROM menu_items WHERE is_deleted = 0 AND id <> ? AND (image_path = ? OR thumb_path = ?)',
    [excludeItemId ?? -1, p, p],
  );
  return Number(row?.c || 0);
}

// ===== إعدادات المنيو العام (في جدول settings المشترك بمفاتيح menu_*) =====
export function getMenuSetting(key: string, fallback = ''): string {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row && row.value != null ? String(row.value) : fallback;
}

export function setMenuSetting(key: string, value: string): void {
  execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}
