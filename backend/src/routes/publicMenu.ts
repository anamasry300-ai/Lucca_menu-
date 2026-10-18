import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { authRequired, requirePasswordChanged, requireRole } from '../auth.js';
import { DomainError } from '../errors.js';
import {
  createCategory, createItem, getPublicMenu, getMenuSettings, importFromPos, listCategories,
  listItems, processAndStoreMenuImage, removeCategory, removeItem, reorderCategories, reorderItems,
  saveMenuSettings, toggleItemAvailability, updateCategory, updateItem,
} from '../services/publicMenuService.js';

// =====================================================================
// راوتر القراءة العامة (بدون مصادقة) — read-only لصفحة العملاء.
// =====================================================================
export const publicMenuReadRoutes = Router();

// المنيو العام للعملاء (بدون مصادقة — بيانات عرض فقط، بلا أسرار/كتابة).
publicMenuReadRoutes.get('/menu', (_req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getPublicMenu());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// عنوان أساسي موثوق لصفحة المنيو (يُستخدم لرمز QR فقط).
// القاعدة: لا نثق برؤوس Host أو X-Forwarded-* مباشرة لإنشاء الرابط.
// 1) إعداد PUBLIC_MENU_URL من التطبيق (أولوية قصوى).
// 2) وإلا قبول Origin صادر من المتصفح بشرط تطابق host مع طلب الخادم نفسه وبُرتكول http(s) فقط.
// 3) وإلا إرجاع null (يرفض الطلب).
export function resolvePublicMenuBaseUrl(req: Request): string | null {
  const envUrl = process.env.PUBLIC_MENU_URL || '';
  if (envUrl) {
    const u = envUrl.trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^\s]+\.[^\s]+$/i.test(u) || /^https?:\/\/localhost(:\d+)?$/i.test(u)) return u;
    return null;
  }
  const headers = req.headers || {};
  const origin = headers.origin as string | undefined;
  const host = (headers.host as string | undefined) || '';
  if (origin && /^https?:\/\//i.test(origin)) {
    try {
      const o = new URL(origin);
      if (o.protocol === 'http:' || o.protocol === 'https:') {
        if (o.host === host && host && !/@/.test(host)) return o.origin;
      }
      return null; // أصل غير متطابق مع host — لا نولّد QR عليه
    } catch { return null; }
  }
  return null;
}

// رمز QR لرابط صفحة المنيو — مقصور على admin (لوحة المالك تستخدمه؛ صفحة العملاء لا تحتاجه).
// لا يُقبل أي رابط من طلب العميل (query.url يُتجاهل عمداً) ولا يعتمد على Host/X-Forwarded-* إطلاقاً.
publicMenuReadRoutes.get('/menu/qr', authRequired, requirePasswordChanged, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const base = resolvePublicMenuBaseUrl(req);
    if (!base) { res.status(400).json({ error: 'لم يُحدد عنوان أساسي موثوق لصفحة المنيو' }); return; }
    const url = `${base}/menu`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 320 });
    res.setHeader('Cache-Control', 'no-store');
    // مسار بروكسي Electron (JSON فقط عبر IPC) لا يستطيع تمرير جسم SVG — فرمت=json يُعيد {url,svg} دون تغيير الاستجابة الافتراضية.
    if (String((req.query && (req.query as Record<string, unknown>).format) || '').toLowerCase() === 'json') {
      res.json({ url, svg });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// =====================================================================
// راوتر الإدارة (يتطلب جلسة admin) — CRUD + رفع صور + استيراد + إعدادات.
// =====================================================================
export const publicMenuAdminRoutes = Router();

publicMenuAdminRoutes.use(authRequired as any);
publicMenuAdminRoutes.use(requirePasswordChanged as any);
publicMenuAdminRoutes.use(requireRole('admin') as any);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// معالج أخطاء multer بالعربي + معالج أخطاء المجال (DomainError).
function handleError(e: unknown, res: Response) {
  if (e instanceof DomainError) { res.status(e.status).json({ error: e.message }); return; }
  if (e && (e as any).code === 'LIMIT_FILE_SIZE') { res.status(400).json({ error: 'حجم الصورة يتجاوز 5MB' }); return; }
  const msg = e instanceof Error ? e.message : String(e);
  res.status(500).json({ error: msg });
}

function asId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new DomainError(400, 'معرّف غير صالح');
  return n;
}

// ---- الإعدادات ----
publicMenuAdminRoutes.get('/settings', (_req, res) => {
  try { res.json(getMenuSettings()); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.put('/settings', (req, res) => {
  try { res.json(saveMenuSettings(req.body || {})); } catch (e) { handleError(e, res); }
});

// ---- التصنيفات ----
publicMenuAdminRoutes.get('/categories', (_req, res) => {
  try { res.json(listCategories()); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.post('/categories', (req, res) => {
  try { res.status(201).json(createCategory(req.body || {})); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.put('/categories/reorder', (req, res) => {
  try { res.json(reorderCategories((req.body || {}).ids)); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.put('/categories/:id', (req, res) => {
  try { res.json(updateCategory(asId(req.params.id), req.body || {})); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.delete('/categories/:id', (req, res) => {
  try { res.json(removeCategory(asId(req.params.id))); } catch (e) { handleError(e, res); }
});

// ---- المنتجات ----
publicMenuAdminRoutes.get('/items', (req, res) => {
  try {
    res.json(listItems({
      categoryId: req.query.category_id ? Number(req.query.category_id) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      includeDeleted: String(req.query.include_deleted || '') === '1',
    }));
  } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.post('/items', (req, res) => {
  try { res.status(201).json(createItem(req.body || {})); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.put('/items/reorder', (req, res) => {
  try { res.json(reorderItems((req.body || {}).ids)); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.put('/items/:id', (req, res) => {
  try { res.json(updateItem(asId(req.params.id), req.body || {})); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.post('/items/:id/toggle', (req, res) => {
  try { res.json(toggleItemAvailability(asId(req.params.id))); } catch (e) { handleError(e, res); }
});
publicMenuAdminRoutes.delete('/items/:id', (req, res) => {
  try { res.json(removeItem(asId(req.params.id))); } catch (e) { handleError(e, res); }
});

// ---- رفع صورة (multer + sharp) ----
publicMenuAdminRoutes.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req as any, res as any, (err: unknown) => {
    if (err) { handleError(err, res); return; }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const file = (req as any).file as { buffer: Buffer } | undefined;
    if (!file) throw new DomainError(400, 'لم يتم إرفاق صورة');
    const stored = await processAndStoreMenuImage(file.buffer);
    res.status(201).json(stored);
  } catch (e) {
    if (e instanceof DomainError) { res.status(e.status).json({ error: e.message }); return; }
    if (e && (e as any).code === 'LIMIT_FILE_SIZE') { res.status(400).json({ error: 'حجم الصورة يتجاوز 5MB' }); return; }
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- رفع صورة عبر JSON/base64 (لوحة Electron: لا تدعم multipart عبر بروكسي الجلسة) ----
// يُقبل نفس الصيغ والحدود؛ التحقق من النوع الحقيقي يتم عبر البصمة الثنائية داخل processAndStoreMenuImage.
publicMenuAdminRoutes.post('/upload-base64', async (req: Request, res: Response) => {
  try {
    const raw = String((req.body || {}).data || '');
    const b64 = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    if (!b64) throw new DomainError(400, 'لم يتم إرفاق صورة');
    const buf = Buffer.from(b64, 'base64');
    if (!buf || buf.length === 0) throw new DomainError(400, 'بيانات الصورة غير صالحة');
    const stored = await processAndStoreMenuImage(buf);
    res.status(201).json(stored);
  } catch (e) {
    if (e instanceof DomainError) { res.status(e.status).json({ error: e.message }); return; }
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- استيراد لمرة واحدة من الكاشير ----
publicMenuAdminRoutes.post('/import', (req: Request, res: Response) => {
  try {
    const actor = (req as any).identity?.username || 'admin';
    res.json(importFromPos(actor));
  } catch (e) { handleError(e, res); }
});

export default publicMenuAdminRoutes;
