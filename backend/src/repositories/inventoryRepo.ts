import { execute, insert, queryAll, queryOne } from '../db.js';

export interface InventoryItemRow {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  minStock: number;
  costPrice: number;
  status: 'out' | 'low' | 'ok';
}

export function allInventory(): InventoryItemRow[] {
  const rows = queryAll(
    "SELECT id, name, quantity, unit, minStock, costPrice, CASE WHEN quantity <= 0 THEN 'out' WHEN quantity <= minStock THEN 'low' ELSE 'ok' END as status FROM inventory ORDER BY quantity ASC",
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name || ''),
    quantity: Number(r.quantity) || 0,
    unit: String(r.unit || ''),
    minStock: Number(r.minStock || r.minQuantity || 0),
    costPrice: Number(r.costPrice || r.cost || 0),
    status: (r.status as InventoryItemRow['status']) || 'ok',
  }));
}

export function inventoryById(id: number): InventoryItemRow | undefined {
  const row = queryOne("SELECT id, name, quantity, unit, minStock, costPrice FROM inventory WHERE id = ?", [id]) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    quantity: Number(row.quantity) || 0,
    unit: String(row.unit || ''),
    minStock: Number(row.minStock || 0),
    costPrice: Number(row.costPrice || row.cost || 0),
    status: 'ok',
  };
}

export function inventoryByTrimmedName(name: string): InventoryItemRow | undefined {
  const row = queryOne(
    "SELECT id, name, quantity, unit, minStock, costPrice FROM inventory WHERE TRIM(name) = TRIM(?) COLLATE NOCASE",
    [name],
  ) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    quantity: Number(row.quantity) || 0,
    unit: String(row.unit || ''),
    minStock: Number(row.minStock || 0),
    costPrice: Number(row.costPrice || row.cost || 0),
    status: 'ok',
  };
}

export function productCostById(id: number): number {
  const row = queryOne('SELECT COALESCE(cost, 0) as cost FROM products WHERE id = ?', [id]);
  return Number(row?.cost || 0);
}

export function productRecipesForProduct(productId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, productId, ingredient, quantity, unit FROM product_recipes WHERE productId = ? ORDER BY id ASC",
    [productId],
  );
}

export function stockMovementsForProduct(productId: number, limit = 200): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, productId, quantity, type, notes, createdAt FROM stock_movements WHERE productId = ? ORDER BY createdAt DESC LIMIT ?",
    [productId, limit],
  );
}

export function inventoryValue(items: InventoryItemRow[]): number {
  return items.reduce((s, i) => s + i.quantity * i.costPrice, 0);
}

export function activeAlerts(): Record<string, unknown>[] {
  return queryAll("SELECT * FROM inventory_alerts WHERE status = 'active' ORDER BY createdAt DESC");
}

export function stockMovements(from: string, to: string, limit = 200): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, productId, productSyncId, quantity, type, notes, createdAt FROM stock_movements WHERE date(createdAt) >= ? AND date(createdAt) <= ? ORDER BY createdAt DESC LIMIT ?",
    [from, to, limit],
  );
}

export interface StockPageOptions {
  q?: string;
  status?: string;
  page: number;
  pageSize: number;
}

function stockWhere(opts: Omit<StockPageOptions, 'page' | 'pageSize'>): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.q) { clauses.push('(name LIKE ? OR id = ?)'); const like = `%${String(opts.q).trim()}%`; params.push(like, String(opts.q).trim() === '' ? 0 : Number(opts.q) || -1); }
  if (opts.status) {
    if (opts.status === 'low') clauses.push('quantity > 0 AND quantity <= minStock');
    else if (opts.status === 'out') clauses.push('quantity <= 0');
  }
  return { where: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

export function stockPage(opts: StockPageOptions): InventoryItemRow[] {
  const { where, params } = stockWhere(opts);
  const rows = queryAll(
    `SELECT id, name, quantity, unit, minStock, costPrice, CASE WHEN quantity <= 0 THEN 'out' WHEN quantity <= minStock THEN 'low' ELSE 'ok' END as status FROM inventory WHERE ${where} ORDER BY quantity ASC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name || ''),
    quantity: Number(r.quantity) || 0,
    unit: String(r.unit || ''),
    minStock: Number(r.minStock || 0),
    costPrice: Number(r.costPrice || 0),
    status: (r.status as InventoryItemRow['status']) || 'ok',
  }));
}

export function stockPageCount(opts: Omit<StockPageOptions, 'page' | 'pageSize'>): number {
  const { where, params } = stockWhere(opts);
  return Number((queryOne(`SELECT COUNT(*) as c FROM inventory WHERE ${where}`, params))?.c || 0);
}

export function movementsPage(from: string, to: string, productId: number | undefined, page: number, pageSize: number): Record<string, unknown>[] {
  const clauses = ['date(sm.createdAt) >= ?', 'date(sm.createdAt) <= ?'];
  const params: unknown[] = [from, to];
  if (productId != null) { clauses.push('sm.productId = ?'); params.push(productId); }
  return queryAll(
    `SELECT sm.id, sm.productId, sm.quantity, sm.type, sm.notes, sm.createdAt,
            COALESCE(p.name, iv.name, sm.productId, '—') as productName
     FROM stock_movements sm
     LEFT JOIN products p ON sm.productId = p.id
     LEFT JOIN inventory iv ON sm.productId = iv.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY sm.createdAt DESC, sm.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
}

export function movementsPageCount(from: string, to: string, productId: number | undefined): number {
  const clauses = ['date(sm.createdAt) >= ?', 'date(sm.createdAt) <= ?'];
  const params: unknown[] = [from, to];
  if (productId != null) { clauses.push('sm.productId = ?'); params.push(productId); }
  return Number((queryOne(`SELECT COUNT(*) as c FROM stock_movements sm WHERE ${clauses.join(' AND ')}`, params))?.c || 0);
}

export interface ProductsPageOptions {
  q?: string;
  categoryId?: number;
  page: number;
  pageSize: number;
}

function productsWhere(opts: Omit<ProductsPageOptions, 'page' | 'pageSize'>): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.categoryId != null) { clauses.push('p.categoryId = ?'); params.push(opts.categoryId); }
  if (opts.q) { const like = `%${String(opts.q).trim()}%`; clauses.push('(p.name LIKE ? OR p.name_ar LIKE ? OR p.name_en LIKE ?)'); params.push(like, like, like); }
  return { where: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

export function productsPage(opts: ProductsPageOptions): Record<string, unknown>[] {
  const { where, params } = productsWhere(opts);
  return queryAll(
    `SELECT p.id, p.name, p.name_ar, p.name_en, p.sku, p.categoryId, p.price, p.cost, p.taxRate, p.available, p.productType,
            COALESCE(c.name_ar, c.name, '') as categoryName
     FROM products p
     LEFT JOIN categories c ON p.categoryId = c.id
     WHERE ${where}
     ORDER BY p.sortOrder ASC, p.id ASC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
  );
}

export function productsPageCount(opts: Omit<ProductsPageOptions, 'page' | 'pageSize'>): number {
  const { where, params } = productsWhere(opts);
  return Number((queryOne(`SELECT COUNT(*) as c FROM products p WHERE ${where}`, params))?.c || 0);
}

// حركات المخزون: اسم الصنف عبر المنتج
export function stockMovementsWithNames(limit = 100): Record<string, unknown>[] {
  try {
    return queryAll(
      `SELECT sm.id, sm.quantity, sm.type, sm.notes, sm.createdAt,
              COALESCE(p.name, pm.name, sm.productId, '—') as productName
       FROM stock_movements sm
       LEFT JOIN products p ON sm.productId = p.id
       LEFT JOIN inventory pm ON sm.productId = pm.id
       ORDER BY sm.id DESC LIMIT ?`,
      [limit],
    );
  } catch {
    return queryAll("SELECT id, quantity, type, notes, createdAt FROM stock_movements ORDER BY id DESC LIMIT ?", [limit]);
  }
}

// ===== كتابة المنتجات (Tier 1 — catalog write) =====
const PRODUCT_COLS: Record<string, string> = {
  name: 'name', name_ar: 'name_ar', name_en: 'name_en', sku: 'sku', categoryId: 'categoryId',
  price: 'price', cost: 'cost', taxRate: 'taxRate', image: 'image', description: 'description',
  components: 'components', available: 'available', productType: 'productType', sortOrder: 'sortOrder',
};

export function productByIdRow(id: number): Record<string, unknown> | undefined {
  return queryOne(
    `SELECT p.id, p.name, p.name_ar, p.name_en, p.sku, p.categoryId, p.price, p.cost, p.taxRate, p.available, p.productType,
            COALESCE(c.name_ar, c.name, '') as categoryName
     FROM products p LEFT JOIN categories c ON p.categoryId = c.id WHERE p.id = ?`,
    [id],
  );
}

export function addProductRow(input: Record<string, unknown>): number {
  return insert(
    `INSERT INTO products (name, name_ar, name_en, sku, categoryId, price, cost, taxRate, image, description, components, available, productType, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      input.name, input.name_ar || '', input.name_en || '', input.sku || '',
      input.categoryId ?? null, input.price ?? 0, input.cost ?? 0, input.taxRate ?? 0,
      input.image || '', input.description || '', input.components || '[]',
      input.available ?? 1, input.productType || 'standard', input.sortOrder ?? 0,
    ],
  );
}

export function updateProductRow(id: number, fields: Partial<Record<string, unknown>>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(PRODUCT_COLS)) {
    if (fields[key] !== undefined) {
      sets.push(`\`${PRODUCT_COLS[key]}\` = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = datetime('now')");
  execute(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deleteProductRow(id: number): { changes: number } {
  return execute('DELETE FROM products WHERE id = ?', [id]);
}

// مرجعية خارجية فقط (الطلبات/المُعدّلات/التباينات) — وصفات المنتج نفسه تُحذف معه ولا تُعتبر مانعاً
export function productReferenced(productId: number): boolean {
  const parts = [
    'SELECT COUNT(*) as c FROM order_items WHERE productId = ?',
    'SELECT COUNT(*) as c FROM product_modifiers WHERE productId = ?',
    'SELECT COUNT(*) as c FROM product_variations WHERE productId = ?',
  ];
  for (const sql of parts) {
    const row = queryOne(sql, [productId]);
    if (row && Number(row.c) > 0) return true;
  }
  return false;
}

export function deleteProductRecipes(productId: number): { changes: number } {
  return execute('DELETE FROM product_recipes WHERE productId = ?', [productId]);
}

export function addRecipeRow(productId: number, ingredient: string, quantity: number, unit: string): number {
  return insert(
    `INSERT INTO product_recipes (productId, ingredient, quantity, unit, createdAt, updatedAt) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [productId, ingredient, quantity, unit || ''],
  );
}

// ===== كتابة المخزون (Tier 2 — inventory write عبر نفس الخدمات) =====
export interface InventoryWriteInput {
  name: string;
  quantity?: number;
  unit?: string;
  minStock?: number;
  costPrice?: number;
}

export function addInventoryItem(input: InventoryWriteInput): number {
  return insert(
    `INSERT INTO inventory (name, quantity, unit, minStock, costPrice, createdAt, lastUpdated, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
    [input.name, input.quantity ?? 0, input.unit || 'قطعة', input.minStock ?? 0, input.costPrice ?? 0],
  );
}

export function updateInventoryItem(id: number, fields: { name?: string; unit?: string; minStock?: number; costPrice?: number }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
  if (fields.unit !== undefined) { sets.push('unit = ?'); params.push(fields.unit); }
  if (fields.minStock !== undefined) { sets.push('minStock = ?'); params.push(fields.minStock); }
  if (fields.costPrice !== undefined) { sets.push('costPrice = ?'); params.push(fields.costPrice); }
  if (sets.length === 0) return;
  sets.push("lastUpdated = datetime('now'), updatedAt = datetime('now')");
  execute(`UPDATE inventory SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

export function deleteInventoryItem(id: number): { changes: number } {
  return execute('DELETE FROM inventory WHERE id = ?', [id]);
}

export function setInventoryQuantity(id: number, quantity: number): void {
  execute("UPDATE inventory SET quantity = ?, lastUpdated = datetime('now'), updatedAt = datetime('now') WHERE id = ?", [quantity, id]);
}

export function insertStockMovement(fields: { productId: number; quantity: number; type: string; notes?: string }): number {
  return insert(
    `INSERT INTO stock_movements (productId, quantity, type, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [fields.productId, fields.quantity, fields.type, fields.notes || ''],
  );
}

export function insertWasteRow(fields: { productId: number; quantity: number; reason?: string }): number {
  return insert(
    `INSERT INTO waste_log (productId, quantity, reason, createdAt, updatedAt) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [fields.productId, fields.quantity, fields.reason || ''],
  );
}

export function latestStockMovement(productId: number): Record<string, unknown> | undefined {
  return queryOne(
    "SELECT id, productId, quantity, type, notes, createdAt FROM stock_movements WHERE productId = ? ORDER BY id DESC LIMIT 1",
    [productId],
  );
}

// بحث صنف المخزون بالاسم (لتحقق مكونات الوصفة)
export function inventoryItemByName(name: string): Record<string, unknown> | undefined {
  return queryOne(
    "SELECT id, name, quantity, unit, minStock, costPrice FROM inventory WHERE TRIM(name) = TRIM(?) COLLATE NOCASE",
    [name],
  );
}

export function productRecipesByProductId(productId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, productId, ingredient, quantity, unit FROM product_recipes WHERE productId = ? ORDER BY id ASC",
    [productId],
  );
}