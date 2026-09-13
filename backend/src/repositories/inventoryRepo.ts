import { queryAll, queryOne } from '../db.js';

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