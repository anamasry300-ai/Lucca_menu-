import { execute, insert, queryAll, queryOne } from '../db.js';

export interface SupplierRow {
  id: number;
  name: string;
  phone: string;
  contact: string;
  updatedAt: string;
}

export function allSuppliers(): SupplierRow[] {
  const rows = queryAll('SELECT id, syncId, name, phone, contact, updatedAt FROM suppliers ORDER BY name COLLATE NOCASE');
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name || ''),
    phone: String(r.phone || ''),
    contact: String(r.contact || ''),
    updatedAt: String(r.updatedAt || ''),
  }));
}

// إجمالي مشتريات كل مورد ضمن فترة — purchases يحمل اسم المورد كـ TEXT (supplier) وليس معرفاً FK
export function supplierPurchaseTotals(from: string, to: string): Record<string, unknown>[] {
  try {
    return queryAll(
      `SELECT COALESCE(NULLIF(s.name, ''), NULLIF(p.supplier, ''), 'غير محدد') as name,
             COUNT(*) as count,
             COALESCE(SUM(p.total), 0) as total
       FROM purchases p
       LEFT JOIN suppliers s ON s.name = p.supplier
       WHERE date(p.date) >= ? AND date(p.date) <= ?
       GROUP BY COALESCE(NULLIF(s.name, ''), NULLIF(p.supplier, ''), 'غير محدد')
       ORDER BY total DESC`,
      [from, to],
    );
  } catch {
    return [];
  }
}

export function recentPurchases(from: string, to: string, limit = 100): Record<string, unknown>[] {
  try {
    return queryAll(
      `SELECT p.id, p.total, p.date, p.notes, p.createdBy,
              COALESCE(NULLIF(s.name, ''), NULLIF(p.supplier, ''), 'غير محدد') as supplier
       FROM purchases p
       LEFT JOIN suppliers s ON s.name = p.supplier
       WHERE date(p.date) >= ? AND date(p.date) <= ?
       ORDER BY p.date DESC LIMIT ?`,
      [from, to, limit],
    );
  } catch {
    return queryAll(
      "SELECT id, total, date, notes, createdBy, COALESCE(NULLIF(supplier, ''), 'غير محدد') as supplier FROM purchases WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC LIMIT ?",
      [from, to, limit],
    );
  }
}

export function purchasesBetween(from: string, to: string, limit = 200): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, name, item, quantity, costPrice, total, supplier, notes, date, createdBy, createdAt FROM purchases WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC, id DESC LIMIT ?",
    [from, to, limit],
  );
}

export function purchasesPage(from: string, to: string, page: number, pageSize: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT id, name, item, quantity, costPrice, total, supplier, notes, date, createdBy, createdAt FROM purchases WHERE date(date) >= ? AND date(date) <= ? ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
    [from, to, pageSize, (page - 1) * pageSize],
  );
}

export function purchasesPageCount(from: string, to: string): number {
  return Number((queryOne("SELECT COUNT(*) as c FROM purchases WHERE date(date) >= ? AND date(date) <= ?", [from, to]))?.c || 0);
}

export function purchaseById(id: number): Record<string, unknown> | undefined {
  return queryOne("SELECT id, name, item, quantity, costPrice, total, supplier, notes, date, createdBy, createdAt FROM purchases WHERE id = ?", [id]);
}

export function purchaseTotals(from: string, to: string): { total: number; count: number } {
  const row = queryOne(
    "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM purchases WHERE date(date) >= ? AND date(date) <= ?",
    [from, to],
  ) || { total: 0, count: 0 };
  return { total: Number(row.total) || 0, count: Number(row.count) || 0 };
}

// ===== كتابة المشتريات (Tier 2 — عبر نفس الخدمة/الريبو المستخدمة بالقراءة) =====
export interface PurchaseWriteInput {
  name?: string;
  item?: string;
  quantity?: number;
  costPrice?: number;
  total?: number;
  supplier?: string;
  notes?: string;
  date?: string;
  createdBy?: string;
}

export function addPurchaseRow(input: PurchaseWriteInput): number {
  return insert(
    `INSERT INTO purchases (name, item, quantity, costPrice, total, supplier, notes, date, createdAt, createdBy, syncId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, NULL, datetime('now'))`,
    [
      input.name || '', input.item || '', input.quantity ?? 1, input.costPrice ?? 0,
      input.total ?? 0, input.supplier || '', input.notes || '', input.date || new Date().toISOString().slice(0, 10),
      input.createdBy || 'system',
    ],
  );
}

export function deletePurchaseRow(id: number): { changes: number } {
  return execute('DELETE FROM purchases WHERE id = ?', [id]);
}