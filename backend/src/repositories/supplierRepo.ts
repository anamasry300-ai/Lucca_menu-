import { queryAll } from '../db.js';

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