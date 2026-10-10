// ===== وحدة سلامة الأموال الموحّدة (مصدر حقيقة واحد) =====
// تُستخدم من crud.ts (إنشاء/تعديل الطلبات وبنود الطلب) و index.ts (المزامنة /api/sync والتحصيل /checkout)
// لضمان أن كل مسارات الكتابة تُطبّق نفس القواعد المالية. لا تعتمد على أي حالة/اتصال — دوال نقية
// (ما عدا validateItemPriceOverride التي تستقبل دالة جلب سعر الكتالوج من الخارج لتفادي الاستيراد الدائري).

export const MAX_ITEM_PRICE = Number(process.env.MAX_ITEM_PRICE || 1_000_000);
export const MAX_ITEM_QTY = Number(process.env.MAX_ITEM_QTY || 100_000);
export const MAX_ORDER_TOTAL = Number(process.env.MAX_ORDER_TOTAL || 100_000_000);

const EPS = 0.01;

type Row = Record<string, unknown>;

function pick(data: Row, existing: Row | undefined, k: string): unknown {
  return data[k] !== undefined ? data[k] : (existing ? existing[k] : undefined);
}

// تحويل items القادمة (سلسلة JSON أو مصفوفة) إلى مصفوفة آمنة — بلا رمي استثناء.
export function parseItems(raw: unknown): any[] {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = []; }
  }
  return Array.isArray(v) ? v : [];
}

// ===== P2-A5: الحساب الإلزامي للإجماليات على السيرفر — مصدر الحقيقة = الأصناف (price×quantity) فقط.
// إجمالي/تحت-إجمالي/مبلغ الخصم القادم من العميل يُتجاهَل ويُعاد حسابه من items + قواعد الخصم/الضريبة.
export function serverOrderTotals(data: Row, existing?: Row): { subtotal: number; discountAmount: number; total: number } {
  const arr = parseItems(data.items !== undefined ? data.items : (existing ? existing.items : '[]'));
  const subtotal = arr.reduce((s: number, it: any) =>
    s + (Number(it && it.quantity) || 1) * (Number((it && (it.unitPrice ?? it.price)) || 0)), 0);
  const discount = Number(pick(data, existing, 'discount') || 0);
  const discountType = String(pick(data, existing, 'discountType') || 'percent') || 'percent';
  const discountAmount = discountType === 'fixed' ? discount : subtotal * (discount / 100);
  const tax = Number(pick(data, existing, 'tax') || 0);
  return { subtotal, discountAmount, total: subtotal - discountAmount + tax };
}

// D-02/F-1: فحص سلامة أموال الطلب (دفاع صلب قبل أي كتابة) — مصدر الحقيقة للمبلغ هو الأصناف.
// يمنع: كمية/سعر سالب أو غير منتهٍ، سعر يتجاوز سقفاً معقولاً، خصماً يقلب الإجمالي سالباً، خصماً
// نسبيّاً > 100، وإجمالياً/تحت-إجمالي سالباً وارداً صراحةً من العميل. يُطبَّق على CRUD والمزامنة معاً.
export function validateOrderMoney(data: Row, existing?: Row): { ok: true } | { ok: false; reason: string } {
  const raw = data.items !== undefined ? data.items : (existing ? existing.items : []);
  const arr = parseItems(raw);
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] as Row;
    if (!it || typeof it !== 'object') continue;
    // مطابقة منطق serverOrderTotals: الكمية الغائبة/الصفرية تُعتبر 1 — لكن السالبة والفاحشة تُرفض.
    const qty = Number(it.quantity) || 1;
    if (!Number.isFinite(qty) || qty < 0 || qty > MAX_ITEM_QTY) {
      return { ok: false, reason: `كمية غير صالحة في الصنف #${i + 1}: ${String(it.quantity)}` };
    }
    const price = Number(it.unitPrice !== undefined ? it.unitPrice : it.price) || 0;
    if (!Number.isFinite(price) || price < 0 || price > MAX_ITEM_PRICE) {
      return { ok: false, reason: `سعر غير صالح في الصنف #${i + 1}: ${String(it.unitPrice !== undefined ? it.unitPrice : it.price)}` };
    }
  }
  // إجمالي/تحت-إجمالي سالب وارد صراحةً من العميل — يُرفض حتى لو تجاهل الخادم قيمته الحسابية.
  if (data.subtotal !== undefined && Number(data.subtotal) < -EPS) {
    return { ok: false, reason: `تحت-إجمالي سالب: ${String(data.subtotal)}` };
  }
  if (data.total !== undefined && Number(data.total) < -EPS) {
    return { ok: false, reason: `إجمالي سالب: ${String(data.total)}` };
  }
  const sub = Number(pick(data, existing, 'subtotal')) || 0;
  const discount = Number(pick(data, existing, 'discount')) || 0;
  const discountType = String(pick(data, existing, 'discountType') || 'percent') || 'percent';
  if (discount < 0) return { ok: false, reason: `خصم سالب: ${discount}` };
  if (discountType !== 'fixed' && discount > 100) return { ok: false, reason: `نسبة خصم > 100: ${discount}` };
  if (discountType === 'fixed' && sub > 0 && discount > sub + EPS) {
    return { ok: false, reason: `خصم ثابت ${discount} يتجاوز تحت-الإجمالي ${sub}` };
  }
  const t = serverOrderTotals(data, existing);
  if (!Number.isFinite(t.total) || t.total < -EPS) return { ok: false, reason: `إجمالي سالب: ${t.total}` };
  if (t.total > MAX_ORDER_TOTAL) return { ok: false, reason: `إجمالي يتجاوز الحد الأقصى المسموح (${MAX_ORDER_TOTAL})` };
  return { ok: true };
}

// F-1: سلامة بند طلب مفرد (order_items) — كمية/سعر غير سالب وفي حدود معقولة.
// يعيد سبب الرفض أو null عند السلامة.
export function validateOrderItemRow(data: Row): string | null {
  if (data.quantity !== undefined) {
    const qty = Number(data.quantity);
    if (!Number.isFinite(qty) || qty < 0 || qty > MAX_ITEM_QTY) return `كمية غير صالحة: ${String(data.quantity)}`;
  }
  if (data.unitPrice !== undefined || data.price !== undefined) {
    const price = Number(data.unitPrice !== undefined ? data.unitPrice : data.price);
    if (!Number.isFinite(price) || price < 0 || price > MAX_ITEM_PRICE) {
      return `سعر غير صالح: ${String(data.unitPrice !== undefined ? data.unitPrice : data.price)}`;
    }
  }
  return null;
}

// F-3/D-02: منع تصفير سعر منتج مدفوع (productId مرتبط بمنتج سعره > 0) بلا صلاحية تجاوز السعر.
// دالة جلب السعر تُمرَّر من الخارج (products قد لا تكون متاحة في السياق النقي).
// واجهة POS (buildOrderPayload في index.html) صارت تُرسل productId للعناصر المربوطة بالمنتجات
// (من MenuSync.buildFromProducts عبر _productId)، فصار الحرس فعّالاً على الطلبات الحقيقية.
// العناصر الحرة/غير المربوطة بالكتالوج تبقى بلا productId (fail-open: لا قيد بلا ربط).
export function validateItemPriceOverride(
  items: any[],
  canOverride: boolean,
  lookupCatalogPrice: (productId: unknown) => number | null
): string | null {
  if (canOverride) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Row;
    if (!it || typeof it !== 'object') continue;
    const pid = it.productId !== undefined ? it.productId : it.product_id;
    if (pid == null || pid === '') continue;
    let catalog: number | null = null;
    try { catalog = lookupCatalogPrice(pid); } catch { catalog = null; }
    if (catalog == null || !(catalog > 0)) continue; // منتج مجاني/غير معروف → لا قيد
    const price = Number(it.unitPrice !== undefined ? it.unitPrice : it.price);
    if (!Number.isFinite(price) || price <= 0) {
      return `سعر غير صالح/صفر لمنتج مدفوع في الصنف #${i + 1} — يتطلب صلاحية price.override`;
    }
  }
  return null;
}
