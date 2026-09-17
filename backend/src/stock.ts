import { getDb, queryOne, queryAll } from './db.js';

// C3-P0/P1: مساعدات المخزون المشتركة — تُستخدم من /checkout و /void (index.ts) ومسار الاسترداد (crud.ts)
// منفصلة في وحدة مستقلة لتجنّب الاستيراد الدائري بين index.ts (يستورد crudRoutes) و crud.ts.

// خطأ HTTP قابل للفصل صراحةً داخل معاملة DB (يُستخدم عند عجز المخزون أثناء checkout)
export class HttpError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// قراءة إعداد نصي من settings — القيم المنطقية true/1/yes
export function getSettingBool(key: string): boolean {
  try {
    const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
    const v = String((row && row.value) ?? '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  } catch { return false; }
}

// خطة خصم المخزون لصفوف الطلب (وصفات المنتج أولاً ثم الاسم 1:1 — بنفس منطق العميل)
export interface StockPlanItem { name: string; qty: number; productId: number | null; }

export function stockDeductionPlan(items: any[]): StockPlanItem[] {
  const plan: StockPlanItem[] = [];
  for (const it of items || []) {
    const productId = (it && (it.productId ?? it.product_id)) ?? null;
    const wanted = Number((it && it.quantity) || 1);
    let appliedByRecipe = false;
    if (productId) {
      try {
        const recipes = queryAll('SELECT ingredient, quantity FROM product_recipes WHERE productId = ?', [productId]) as any[];
        for (const r of recipes) {
          const ing = String((r && r.ingredient) || '').trim();
          if (!ing) continue;
          plan.push({ name: ing, qty: (Number((r && r.quantity) || 1) || 1) * wanted, productId });
          appliedByRecipe = true;
        }
      } catch { /* جداول قديمة قبل product_recipes */ }
    }
    if (!appliedByRecipe) {
      const name = String((it && it.name) || '').trim();
      if (name) plan.push({ name, qty: wanted, productId });
    }
  }
  return plan;
}

// الخصم الفعلي للمخزون داخل معاملة checkout (idempotent عبر حركة sale مسجلة لنفس الطلب)
export function applyStockDeduction(orderId: string | number, items: any[]): void {
  const db = getDb();
  const already = queryOne("SELECT COUNT(*) AS c FROM stock_movements WHERE orderId = ? AND type = 'sale'", [orderId]);
  if (already && Number((already as any).c) > 0) return; // لا خصم مزدوج — نفس الطلب/نفس الدفعة
  const allowNeg = getSettingBool('allowNegativeStock');
  const plan = stockDeductionPlan(items);
  const shortfall: string[] = [];
  for (const p of plan) {
    const inv = queryOne('SELECT id, name, quantity FROM inventory WHERE name = ?', [p.name]) as any;
    if (!inv) {
      // لا يوجد صنف مخزون مقابِل — لا نمنع البيع (لا يوجد ما نتحقق منه)، لكن نسجّل حركة إعلامية
      db.run(
        "INSERT INTO stock_movements (productId, orderId, quantity, type, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        [p.productId, orderId, -p.qty, 'sale', `طلب #${orderId} :: ${p.name} (بدون صنف مخزون مقابِل)`]
      );
      continue;
    }
    const available = Number(inv.quantity) || 0;
    if (!allowNeg && available < p.qty) {
      shortfall.push(`${p.name} (المُتاح ${available} — المطلوب ${p.qty})`);
      continue;
    }
    db.run("UPDATE inventory SET quantity = ?, lastUpdated = datetime('now') WHERE id = ?", [available - p.qty, inv.id]);
    db.run(
      "INSERT INTO stock_movements (productId, orderId, quantity, type, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [p.productId, orderId, -p.qty, 'sale', `طلب #${orderId} :: ${p.name}`]
    );
  }
  if (shortfall.length) {
    throw new HttpError(
      409,
      'مخزون غير كافٍ لإتمام البيع: ' + shortfall.join('، ') +
      (allowNeg ? '' : ' — فعِّل إعداد allowNegativeStock للسماح بالبيع رغم نقص المخزون')
    );
  }
}

// إعادة المخزون بعد الإلغاء (void) أو الاسترداد مرة واحدة فقط (كل حركة sale لنفس الطلب ← حركة return)
export function restoreStockAfterVoid(orderId: string | number): void {
  const db = getDb();
  const saleMoves = queryAll("SELECT id, productId, quantity, notes FROM stock_movements WHERE orderId = ? AND type = 'sale'", [orderId]);
  if (!saleMoves.length) return; // لم يُخصم شيء عند التحصيل → لا إعادة
  try {
    const ret = queryOne("SELECT COUNT(*) AS c FROM stock_movements WHERE orderId = ? AND type = 'return'", [orderId]);
    if (ret && Number((ret as any).c) > 0) return; // سبقت إعادة → لا نعيد مرتين
  } catch { /* buildId قد لا يوجد في قاعدة قديمة */ }
  for (const m of saleMoves) {
    const note = String((m as any).notes || '');
    const name = note.split(' :: ')[1] || '';
    const amount = Math.abs(Number((m as any).quantity) || 0);
    if (!amount) continue;
    let row: any;
    if (name) {
      try { row = queryOne('SELECT id, quantity FROM inventory WHERE name = ?', [name]); } catch { row = undefined; }
      if (row) db.run("UPDATE inventory SET quantity = ?, lastUpdated = datetime('now') WHERE id = ?", [Number(row.quantity) + amount, row.id]);
    }
    db.run(
      "INSERT INTO stock_movements (productId, orderId, quantity, type, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [(m as any).productId ?? null, orderId, amount, 'return', `استرداد مخزون طلب #${orderId}${name ? ' :: ' + name : ''}`]
    );
  }
}