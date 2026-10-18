import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { badRequest, notFound } from '../errors.js';
import {
  addMenuCategory, addMenuItem, allMenuCategories, allMenuItems, deleteMenuCategoryRow,
  getMenuSetting, menuCategoryById, menuItemById, menuItemsInCategory, menuImagePathUsageCount,
  reorderMenuCategories, reorderMenuItems, setMenuSetting, updateMenuCategoryRow, updateMenuItemRow,
} from '../repositories/publicMenuRepo.js';
import { queryAll, beginImmediateTransaction, commitTransaction, rollbackTransaction } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// مجلد رفع صور المنيو العام — على القرص (خارج قاعدة البيانات). ممنوع base64 في القاعدة.
// dev  : backend/src/services -> backend/data/uploads/menu
// prod : backend/dist/services -> backend/data/uploads/menu
export const MENU_UPLOADS_DIR = process.env.MENU_UPLOADS_DIR
  || path.join(__dirname, '..', '..', 'data', 'uploads', 'menu');
export const MENU_UPLOADS_URL_PREFIX = '/uploads/menu';

// ===== مسارات صور المنيو العامة: مسارات محلية معتمدة فقط (لا روابط خارجية/بروتوكولات مخصصة) =====
// المبدأ: لا يُقبل سوى مسار يبدأ بالبادئة المعتمدة /uploads/menu وباسم ملف آمن (بصيغة uuid.webp المولّدة من الرفع).
// الرابط الخارجي أو javascript:/data:/file: أو نسبي ../ يُرفض — ومنع العرض العام للقديم دون حذفه.
const MENU_IMAGE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isAllowedMenuImagePath(p: string | null | undefined): boolean {
  if (!p) return true; // بدون صورة
  if (typeof p !== 'string') return false;
  const s = p.trim();
  if (!s) return true;
  if (!s.startsWith(MENU_UPLOADS_URL_PREFIX + '/')) return false;
  const name = s.slice(MENU_UPLOADS_URL_PREFIX.length + 1);
  if (!name || name.includes('..') || name.includes('\\') || name.includes('/')) return false;
  return MENU_IMAGE_NAME_RE.test(name);
}

// تنقية مسار للعرض العام/الإداري: نُعيد '' بدل أي مسار غير معتمد (لا نلمس القيمة المخزنة).
export function sanitizeMenuImagePath(p: string | null | undefined): string {
  return isAllowedMenuImagePath(p) ? String(p || '').trim() : '';
}

// فرض صارم عند الإدخال (إنشاء/تعديل): أي path غير فارغ يجب أن يكون محلياً معتمداً.
export function assertMenuImagePathInput(p: unknown): string {
  if (p === undefined || p === null) return '';
  const s = String(p).trim();
  if (!s) return '';
  if (!isAllowedMenuImagePath(s)) throw badRequest('مسار الصورة غير مسموح: يُقبل فقط مسار محلي مرفوع (بصيغة uuid.webp) ضمن /uploads/menu');
  return s;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MAGIC: Array<{ mime: string; check: (b: Buffer) => boolean }> = [
  // JPEG: FF D8 FF
  { mime: 'image/jpeg', check: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png', check: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  // WebP: "RIFF"...."WEBP"
  { mime: 'image/webp', check: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

export function ensureMenuUploadsDir(): void {
  if (!fs.existsSync(MENU_UPLOADS_DIR)) fs.mkdirSync(MENU_UPLOADS_DIR, { recursive: true });
}

// التحقق من النوع الحقيقي للملف عبر البصمة الثنائية (magic bytes) وليس امتداد الاسم/مزاعم العميل.
export function detectRealImageMime(buf: Buffer): string | null {
  for (const m of ALLOWED_MAGIC) if (m.check(buf)) return m.mime;
  return null;
}

export interface StoredImage {
  image_path: string;
  thumb_path: string;
}

// يعالج صورة مرفوعة: تحقق → resizing (max 1200) + thumbnail (400) بصيغة webp → تخزين على القرص.
export async function processAndStoreMenuImage(buffer: Buffer): Promise<StoredImage> {
  if (!buffer || buffer.length === 0) throw badRequest('الملف فارغ');
  if (buffer.length > MAX_IMAGE_BYTES) throw badRequest('حجم الصورة يتجاوز 5MB');
  const mime = detectRealImageMime(buffer);
  if (!mime) throw badRequest('نوع الملف غير مدعوم (يُسمح بـ jpg/png/webp فقط)');

  ensureMenuUploadsDir();

  // يتحقق sharp من صحة الصورة فعلياً (يرفض المحتوى غير الصوري رغم بصمة الرأس)
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw badRequest('تعذّر قراءة الصورة — الملف تالف أو ليس صورة صالحة');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
    throw badRequest('صيغة الصورة غير مدعومة');
  }

  const base = crypto.randomUUID();
  const fullName = `${base}.webp`;
  const thumbName = `${base}_thumb.webp`;
  const fullPath = path.join(MENU_UPLOADS_DIR, fullName);
  const thumbPath = path.join(MENU_UPLOADS_DIR, thumbName);

  await sharp(buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(fullPath);

  await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumbPath);

  return {
    image_path: `${MENU_UPLOADS_URL_PREFIX}/${fullName}`,
    thumb_path: `${MENU_UPLOADS_URL_PREFIX}/${thumbName}`,
  };
}

// حذف ملفات الصورة من القرص (فقط داخل مجلد الرفع المعتمد — لا path traversal ولا روابط خارجية).
// ملاحظة: عملية ملفات "أفضل جهد" خارجة عن معاملات قاعدة البيانات عمداً (لا تُخلط مع تَراجُع DB).
export function deleteMenuImageFiles(...paths: Array<string | undefined | null>): void {
  const root = path.resolve(MENU_UPLOADS_DIR);
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue;
    if (/^https?:\/\//i.test(p)) continue; // صورة خارجية — لا نحذف ملفاً محلياً أبداً
    const name = path.basename(p.split('?')[0]);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const full = path.resolve(root, name);
    if (full !== root && !full.startsWith(root + path.sep)) continue; // تأكيد البقاء داخل المجلد المعتمد
    try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch { /* أفضل جهد */ }
  }
}

// حذف صور قديمة عند الاستبدال/الحذف — فقط إن لم يعد أي منتج/تصنيف حيّ آخر يُشير إليها.
export function deleteMenuImagesIfUnused(paths: Array<string | undefined | null>, excludeItemId: number): void {
  const candidates = (paths || []).filter((p) => isAllowedMenuImagePath(p));
  const unused = candidates.filter((p) => menuImagePathUsageCount(String(p), excludeItemId) === 0);
  deleteMenuImageFiles(...unused);
}

// ===== التصنيفات =====
export function listCategories() {
  return allMenuCategories(true);
}

export function createCategory(input: Record<string, unknown>) {
  const name_ar = String(input.name_ar || '').trim();
  if (!name_ar) throw badRequest('اسم التصنيف بالعربية مطلوب');
  const id = addMenuCategory({
    name_ar,
    name_en: String(input.name_en || '').trim(),
    icon: String(input.icon || '').trim(),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    is_visible: input.is_visible === undefined ? 1 : (Number(input.is_visible) ? 1 : 0),
  });
  return menuCategoryById(id);
}

export function updateCategory(id: number, input: Record<string, unknown>) {
  const existing = menuCategoryById(id);
  if (!existing) throw notFound('التصنيف غير موجود');
  const fields: Record<string, unknown> = {};
  if (input.name_ar !== undefined) {
    const v = String(input.name_ar).trim();
    if (!v) throw badRequest('اسم التصنيف بالعربية مطلوب');
    fields.name_ar = v;
  }
  if (input.name_en !== undefined) fields.name_en = String(input.name_en || '').trim();
  if (input.icon !== undefined) fields.icon = String(input.icon || '').trim();
  if (input.sort_order !== undefined) fields.sort_order = Number(input.sort_order) || 0;
  if (input.is_visible !== undefined) fields.is_visible = Number(input.is_visible) ? 1 : 0;
  updateMenuCategoryRow(id, fields as any);
  return menuCategoryById(id);
}

export function removeCategory(id: number) {
  const existing = menuCategoryById(id);
  if (!existing) throw notFound('التصنيف غير موجود');
  const count = menuItemsInCategory(id);
  if (count > 0) throw badRequest('لا يمكن حذف تصنيف يحتوي على منتجات. انقل المنتجات أو امسحها أولاً.');
  deleteMenuCategoryRow(id);
  return { deleted: true };
}

export function reorderCategories(ids: unknown) {
  const arr = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!arr.length) throw badRequest('قائمة الترتيب مطلوبة');
  reorderMenuCategories(arr);
  return { reordered: arr.length };
}

// ===== المنتجات =====
export function listItems(opts: { categoryId?: number; search?: string; includeDeleted?: boolean }) {
  // تنقية مسارات الصور عند العرض (الإداري): لا نُعيد روابط خارجية قديمة — القيمة المخزنة تبقى دون مساس.
  return allMenuItems(opts).map((r) => ({
    ...r,
    image_path: sanitizeMenuImagePath(String(r.image_path || '')),
    thumb_path: sanitizeMenuImagePath(String(r.thumb_path || '')),
  }));
}

function normalizeItemFields(input: Record<string, unknown>, partial: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.category_id !== undefined) {
    const n = Number(input.category_id);
    if (!Number.isInteger(n) || n <= 0) throw badRequest('التصنيف مطلوب');
    if (!menuCategoryById(n)) throw badRequest('التصنيف غير موجود');
    fields.category_id = n;
  } else if (!partial) {
    throw badRequest('التصنيف مطلوب');
  }
  if (input.name_ar !== undefined) {
    const v = String(input.name_ar).trim();
    if (!v) throw badRequest('اسم المنتج مطلوب');
    fields.name_ar = v;
  } else if (!partial) {
    throw badRequest('اسم المنتج مطلوب');
  }
  if (input.name_en !== undefined) fields.name_en = String(input.name_en || '').trim();
  if (input.description !== undefined) fields.description = String(input.description || '');
  if (input.price !== undefined) {
    const p = Number(input.price);
    if (!Number.isFinite(p) || p < 0) throw badRequest('السعر غير صالح');
    fields.price = p;
  }
  if (input.image_path !== undefined) fields.image_path = assertMenuImagePathInput(input.image_path);
  if (input.thumb_path !== undefined) fields.thumb_path = assertMenuImagePathInput(input.thumb_path);
  if (input.is_available !== undefined) fields.is_available = Number(input.is_available) ? 1 : 0;
  if (input.is_featured !== undefined) fields.is_featured = Number(input.is_featured) ? 1 : 0;
  if (input.sort_order !== undefined) fields.sort_order = Number(input.sort_order) || 0;
  return fields;
}

export function createItem(input: Record<string, unknown>) {
  const fields = normalizeItemFields(input, false);
  const id = addMenuItem(fields as any);
  return menuItemById(id);
}

export function updateItem(id: number, input: Record<string, unknown>) {
  const existing = menuItemById(id);
  if (!existing) throw notFound('المنتج غير موجود');
  const fields = normalizeItemFields(input, true);
  // قيم قديمة غير موثوقة (روابط خارجية زمن سابق): لا نمحوها تلقائياً عند الحفظ، بل نبقيها في القاعدة
  // وتُعرض بلا صورة (placeholder) إلى أن يرفع المالك صورة جديدة — لا حذف ولا كسر للبيانات القديمة.
  if (fields.image_path === '' && !isAllowedMenuImagePath(String(existing.image_path || ''))) delete fields.image_path;
  if (fields.thumb_path === '' && !isAllowedMenuImagePath(String(existing.thumb_path || ''))) delete fields.thumb_path;
  // عند استبدال الصورة: احذف الملفات القديمة فقط إن لم تُعد تُستخدم بمثنت/تصنيف آخر حي.
  if (fields.image_path !== undefined) {
    const oldImg = String(existing.image_path || '');
    const oldThumb = String(existing.thumb_path || '');
    const newImg = String(fields.image_path || '');
    if ((oldImg || oldThumb) && newImg !== oldImg) deleteMenuImagesIfUnused([oldImg, oldThumb], id);
  }
  updateMenuItemRow(id, fields as any);
  return menuItemById(id);
}

export function removeItem(id: number) {
  const existing = menuItemById(id);
  if (!existing) throw notFound('المنتج غير موجود');
  // حذف ناعم (is_deleted=1) + مسح ملفات الصورة من القرص (فقط إن لم تُشر إليها عناصر أخرى حيّة)
  deleteMenuImagesIfUnused([String(existing.image_path || ''), String(existing.thumb_path || '')], id);
  updateMenuItemRow(id, { is_deleted: 1, image_path: '', thumb_path: '' } as any);
  return { deleted: true };
}

export function toggleItemAvailability(id: number) {
  const existing = menuItemById(id);
  if (!existing) throw notFound('المنتج غير موجود');
  const next = Number(existing.is_available) ? 0 : 1;
  updateMenuItemRow(id, { is_available: next } as any);
  return menuItemById(id);
}

export function reorderItems(ids: unknown) {
  const arr = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!arr.length) throw badRequest('قائمة الترتيب مطلوبة');
  reorderMenuItems(arr);
  return { reordered: arr.length };
}

// ===== الإعدادات =====
export interface MenuSettings {
  title: string;
  subtitle: string;
  hideUnavailable: boolean;
  syncPriceWithPos: boolean;
  currency: string;
  whatsapp: string;
}

export function getMenuSettings(): MenuSettings {
  return {
    title: getMenuSetting('menu_title', 'Lucca Specialty Coffee'),
    subtitle: getMenuSetting('menu_subtitle', 'المنيو'),
    hideUnavailable: getMenuSetting('menu_hide_unavailable', '0') === '1',
    syncPriceWithPos: getMenuSetting('menu_sync_price_pos', '0') === '1',
    currency: getMenuSetting('menu_currency', 'ج.م'),
    whatsapp: getMenuSetting('menu_whatsapp', ''),
  };
}

export function saveMenuSettings(input: Record<string, unknown>): MenuSettings {
  if (input.title !== undefined) setMenuSetting('menu_title', String(input.title || '').slice(0, 120));
  if (input.subtitle !== undefined) setMenuSetting('menu_subtitle', String(input.subtitle || '').slice(0, 200));
  if (input.currency !== undefined) setMenuSetting('menu_currency', String(input.currency || '').slice(0, 16));
  if (input.whatsapp !== undefined) setMenuSetting('menu_whatsapp', String(input.whatsapp || '').slice(0, 40));
  if (input.hideUnavailable !== undefined) setMenuSetting('menu_hide_unavailable', input.hideUnavailable ? '1' : '0');
  if (input.syncPriceWithPos !== undefined) setMenuSetting('menu_sync_price_pos', input.syncPriceWithPos ? '1' : '0');
  return getMenuSettings();
}

// ===== القراءة العامة (لصفحة العملاء) =====
export interface PublicMenuItem {
  id: number;
  name_ar: string;
  name_en: string;
  description: string;
  price: number;
  image_path: string;
  thumb_path: string;
  is_available: boolean;
  is_featured: boolean;
}

export interface PublicMenuCategory {
  id: number;
  name_ar: string;
  name_en: string;
  icon: string;
  items: PublicMenuItem[];
}

export function getPublicMenu(): { settings: { title: string; subtitle: string; hideUnavailable: boolean; currency: string; whatsapp: string }; categories: PublicMenuCategory[] } {
  const settings = getMenuSettings();
  // الإعدادات العامة: عرض فقط — لا يُسرب مفاتيح إدارة (كخيار المزامنة القديم) لعملاء المنيو.
  const publicSettings: { title: string; subtitle: string; hideUnavailable: boolean; currency: string; whatsapp: string } = {
    title: settings.title,
    subtitle: settings.subtitle,
    hideUnavailable: settings.hideUnavailable,
    currency: settings.currency,
    whatsapp: settings.whatsapp,
  };
  const cats = allMenuCategories(false);
  const items = allMenuItems({});
  const byCat = new Map<number, Record<string, unknown>[]>();
  for (const it of items) {
    const cid = Number(it.category_id);
    if (!byCat.has(cid)) byCat.set(cid, []);
    byCat.get(cid)!.push(it);
  }
  const categories: PublicMenuCategory[] = cats.map((c) => ({
    id: Number(c.id),
    name_ar: String(c.name_ar || ''),
    name_en: String(c.name_en || ''),
    icon: String(c.icon || ''),
    items: (byCat.get(Number(c.id)) || [])
      .filter((it) => (settings.hideUnavailable ? Number(it.is_available) === 1 : true))
      .map((it) => ({
        id: Number(it.id),
        name_ar: String(it.name_ar || ''),
        name_en: String(it.name_en || ''),
        description: String(it.description || ''),
        price: Number(it.price || 0),
        image_path: sanitizeMenuImagePath(String(it.image_path || '')),
        thumb_path: sanitizeMenuImagePath(String(it.thumb_path || '')),
        is_available: Number(it.is_available) === 1,
        is_featured: Number(it.is_featured) === 1,
      })),
  })).filter((c) => c.items.length > 0 || !settings.hideUnavailable);

  return { settings: publicSettings, categories };
}

// ===== استيراد لمرة واحدة من الكاشير (بدون ربط الجداول) =====
// يُقسم إلى: (1) بناء خطة (قراءات فقط — لا كتابة)، (2) تنفيذ الخطة داخل معاملة قاعدة كتبة واحدة ذرّية.
// أي فشل أثناء التنفيذ يُرجع كل الاستيراد (rollback) فلا تُترك بيانات جزئية.
interface PlannedCategory { sourcePosId: number; name_ar: string; name_en: string; icon: string; sort_order: number; }
interface PlannedItem {
  sourceCategoryPosId: number;
  pendingCategory: boolean; // true: التصنيف يُنشأ ضمن هذه الخطة (بعد إنشائه يُربط عبر sourceCategoryPosId)
  name_ar: string; name_en: string; description: string; price: number;
  image_path: string; thumb_path: string; is_available: number; is_featured: number; sort_order: number;
}
export interface MenuImportPlan {
  categories: PlannedCategory[];
  items: PlannedItem[];
  counts: { importedCategories: number; importedItems: number; skippedItems: number };
}

export function buildMenuImportPlan(): MenuImportPlan {
  const posCats = queryAll('SELECT * FROM categories ORDER BY sortOrder ASC, id ASC');
  const posProducts = queryAll('SELECT * FROM products ORDER BY sortOrder ASC, id ASC');

  const existingCats = allMenuCategories(true);
  const nameToMenuCat = new Map<string, number>();
  for (const c of existingCats) nameToMenuCat.set(String(c.name_ar || '').trim().toLowerCase(), Number(c.id));

  const categories: PlannedCategory[] = [];
  let importedCategories = 0;
  let order = existingCats.length + 1;
  // posCatId → معرّف مصدر التصنيف المخطط المقترح ضمن هذه الخطة (أو -1 لمن يحمل اسم تصنيف قائم في المنيو).
  // التصنيفان المكرران بالاسم داخل الكاشير يُدمجان على تصنيف مخطط واحد (لا يُكتب تصنيفان بنفس الاسم).
  const posCatToSourcePos = new Map<number, number>();
  const plannedKeyToIdx = new Map<string, number>();
  for (const c of posCats) {
    const nameAr = String(c.name_ar || c.name || '').trim();
    if (!nameAr) continue;
    const key = nameAr.toLowerCase();
    const catId = Number(c.id);
    const existingId = nameToMenuCat.get(key);
    if (existingId && existingId > 0) {
      posCatToSourcePos.set(catId, -1); // تصنيف قائم فعلياً في المنيو — لا إنشاء
      continue;
    }
    const plannedIdx = plannedKeyToIdx.get(key);
    if (plannedIdx !== undefined) {
      // اسم مكرر ضمن هذه الخطة: يُدمج على تصنيف البدء المخطط (نفس مصدر/اسم/ترتيب).
      const firstSrcPos = posCatToSourcePos.get(Number(posCats[plannedIdx].id));
      posCatToSourcePos.set(catId, firstSrcPos !== undefined && firstSrcPos > 0 ? firstSrcPos : -1);
      continue;
    }
    plannedKeyToIdx.set(key, categories.length);
    posCatToSourcePos.set(catId, catId);
    categories.push({
      sourcePosId: catId,
      name_ar: nameAr,
      name_en: String(c.name_en || '').trim(),
      icon: String(c.icon || '').trim(),
      sort_order: order++,
    });
    importedCategories++;
  }

  const existingItems = allMenuItems({ includeDeleted: true });
  // مفتاح تتبّع التكرار: (e|p + وجهة التصنيف + اسم). نحتفظ بفراغ اسمي حتى لا يصطدم تصنيفان مخططان.
  const seen = new Set(existingItems.filter((i) => Number(i.is_deleted) === 0).map((i) => `e\0${i.category_id}\u0000${String(i.name_ar || '').trim().toLowerCase()}`));
  // للتصنيفات المخطط إنشاؤها حديثاً: اسم التصنيف المخطط (merge/قيد الخطة) لضمان تناسق R/C للتكرار عبر مرات الاستيراد.
  const plannedNameBySrc = new Map<number, string>();
  for (const c of categories) plannedNameBySrc.set(c.sourcePosId, String(c.name_ar).trim().toLowerCase());

  const items: PlannedItem[] = [];
  let importedItems = 0;
  let skippedItems = 0;
  for (const p of posProducts) {
    const nameAr = String(p.name_ar || p.name || '').trim();
    if (!nameAr) { skippedItems++; continue; }
    const posCatId = Number(p.categoryId);
    const plannedSrcPos = posCatToSourcePos.get(posCatId);
    // لا نُستورد لمنتج لا ينتمي لتصنيف قائم ولا مقرّر ضمن الخطة (المصفوفة لا تعرف تصنيفه)
    if (plannedSrcPos === undefined) { skippedItems++; continue; }
    let menuCatId: number = 0;
    let pendingCategory = false;
    if (plannedSrcPos > 0) {
      pendingCategory = true; // سيُنشأ تصنيف جديد ونربط المنتج به لاحقاً عبر idByPos
    } else {
      const posCat = posCats.find((c) => Number(c.id) === posCatId);
      menuCatId = nameToMenuCat.get(String(posCat?.name_ar || posCat?.name || '').trim().toLowerCase()) || 0;
      if (menuCatId <= 0) { skippedItems++; continue; } // اسم مقرر/مكرر بلا معرّف قائم — لا نستورد
    }
    const nameLower = nameAr.toLowerCase();
    const key = pendingCategory ? `p\u0000${plannedNameBySrc.get(plannedSrcPos) || ''}\u0000${nameLower}` : `e\u0000${menuCatId}\u0000${nameLower}`;
    if (seen.has(key)) { skippedItems++; continue; }
    seen.add(key);
    // لا صورة إلا لمسار محلي معتمد (مرفوع داخل /uploads/menu) — الروابط الخارجية القديمة مهملة (تُستورد بلا صورة)
    const img = String(p.image || '');
    items.push({
      sourceCategoryPosId: pendingCategory ? plannedSrcPos : menuCatId,
      pendingCategory,
      name_ar: nameAr,
      name_en: String(p.name_en || '').trim(),
      description: String(p.description || ''),
      price: Number(p.price || 0),
      image_path: isAllowedMenuImagePath(img) ? img.trim() : '',
      thumb_path: '',
      is_available: Number(p.available) === 0 ? 0 : 1,
      is_featured: String(p.badge || '') === 'popular' ? 1 : 0,
      sort_order: Number(p.sortOrder || 0),
    });
    importedItems++;
  }

  return { categories, items, counts: { importedCategories, importedItems, skippedItems } };
}

// تنفيذ الخطة داخل معاملة واحدة: كل شيء ينجح معاً أو لا شيء (ROLLBACK عند أي خطأ).
export function applyImportPlan(plan: MenuImportPlan): { importedCategories: number; importedItems: number; skippedItems: number } {
  beginImmediateTransaction();
  try {
    const idByPos = new Map<number, number>();
    for (const c of plan.categories) {
      idByPos.set(c.sourcePosId, addMenuCategory({
        name_ar: c.name_ar, name_en: c.name_en, icon: c.icon, sort_order: c.sort_order, is_visible: 1,
      }));
    }
    for (const it of plan.items) {
      const catId = it.pendingCategory ? idByPos.get(it.sourceCategoryPosId) : it.sourceCategoryPosId;
      if (!catId || catId <= 0) throw new Error('تصنيف غير صالح أثناء الاستيراد');
      addMenuItem({
        category_id: catId,
        name_ar: it.name_ar, name_en: it.name_en, description: it.description, price: it.price,
        image_path: it.image_path, thumb_path: it.thumb_path,
        is_available: it.is_available, is_featured: it.is_featured, sort_order: it.sort_order,
      });
    }
    commitTransaction();
  } catch (e) {
    try { rollbackTransaction(); } catch { /* لا معاملة مفتوحة */ }
    throw e;
  }
  return plan.counts;
}

export function importFromPos(_actor: string): { importedCategories: number; importedItems: number; skippedItems: number; log: string[] } {
  const plan = buildMenuImportPlan();
  const counts = applyImportPlan(plan);
  const log = [`تم استيراد ${counts.importedCategories} تصنيف و${counts.importedItems} منتج (تم تجاهل ${counts.skippedItems})`];
  return { ...counts, log };
}
