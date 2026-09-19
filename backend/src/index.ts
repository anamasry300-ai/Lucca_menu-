import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { initDb, getDb, saveDb, closeDb, queryAll, queryOne, beginTransaction, beginImmediateTransaction, commitTransaction, rollbackTransaction } from './db.js';
import { lookup } from 'node:dns/promises';
import { HttpError, applyStockDeduction, restoreStockAfterVoid } from './stock.js';
import crudRoutes from './routes/crud.js';
import specialRoutes from './routes/special.js';
import analyticsRoutes from './routes/analytics.js';
import authRoutes from './routes/auth.js';
import invitationRoutes from './routes/invitations.js';
import reportRoutes from './routes/reports.js';
import batmanRoutes from './routes/batman.js';
import adminRoutes from './routes/admin.js';
import tableLocksRoutes from './routes/tableLocks.js';
import { authRequired, requirePermission, requirePasswordChanged, resolveIdentity, requireRole, AuthRequest, SESSION_COOKIE, ADMIN_ONLY_STORES, roleHas, getDeviceKeys } from './auth.js';
import logger, { httpLoggerMiddleware } from './logger.js';
import { startBackupScheduler } from './backup.js';

const PORT = parseInt(process.env.PORT || '3000');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

// مولّد هوية مزامنة مستقرة (يستخدمه السيرفر للصفوف التي ينشئها بنفسه مثل دفعات checkout)
function newSyncId(): string {
  return crypto.randomUUID();
}

// C3-P0: حالات الطلب "قيد العمل" وقيم final للدفع — تُستخدم في قيود sync و crud
const ORDER_WORKING = new Set(['pending', 'in_preparation', 'ready', 'served']);
const PAYMENT_TERMINAL = new Set(['paid', 'refunded']);

// C3-P0: P1: تدقيق بسيط على السيرفر (يُسجَّل نجاح/رفض المعاملات المالية)
function logAudit(action: string, objectType: string, objectId: string | number, newValue: unknown, userName: string) {
  try {
    getDb().run(
      "INSERT INTO audit_logs (action, objectType, objectId, oldValue, newValue, userName, createdAt) VALUES (?, ?, ?, '', ?, ?, datetime('now'))",
      [action, objectType, String(objectId), typeof newValue === 'string' ? newValue : JSON.stringify(newValue || ''), userName || 'system']
    );
  } catch { /* audit best-effort */ }
}

// P1: اسم الفاعل للتدقيق — مستخدم الجلسة (اسمه/يوزرنيم) أو الجهاز
function actorFrom(req: any): string {
  const identity = req && req.identity;
  if (identity && identity.kind === 'user') return String(identity.username || identity.name || 'user');
  if (identity && identity.kind === 'device') return 'device';
  return 'system';
}

// C3-P0: خطأ HTTP قابل للفصل صراحةً داخل معاملة DB (يُستخدم عند عجز المخزون أثناء checkout)
// ملاحظة: HttpError أصبح مُصدَّراً من ./stock.js (يستخدمه /checkout و /void ومسار الاسترداد).
// تبقّى أدوات المخزون (applyStockDeduction / restoreStockAfterVoid) في ./stock.js — انظر أعلاه.

// C3-P0: الإجمالي المتوقع (الأصناف − الخصم + الضريبة) — يمنع إبدال total عشوائياً بالمزامنة
function expectedTotalFrom(incoming: Record<string, unknown>, existing?: Record<string, unknown>): number | null {
  const pick = (k: string) => incoming[k] !== undefined ? incoming[k] : (existing ? existing[k] : undefined);
  const subtotal = Number(pick('subtotal'));
  if (!Number.isFinite(subtotal)) return null;
  const discount = Number(pick('discount') || 0);
  const tax = Number(pick('tax') || 0);
  const discountType = String(pick('discountType') || 'percent');
  const discountAmount = discountType === 'fixed' ? discount : subtotal * (discount / 100);
  return subtotal - discountAmount + tax;
}

// تتبّع رقم التسلسل اليومي الحر لأرقام الطلبات (ORD-YYYYMMDD-NNN)
function nextFreeOrderSeq(dateCompact: string): number {
  const rows = queryAll('SELECT orderNumber FROM orders WHERE orderNumber LIKE ?', [`ORD-${dateCompact}-%`]);
  let max = 0;
  for (const r of rows) {
    const m = /-(\d{1,6})$/.exec(String((r as any).orderNumber || ''));
    if (m) { const n = Number(m[1]); if (n > max) max = n; }
  }
  return max + 1;
}

// السيرفر هو مصدر الحقيقة لأرقام الطلبات: يزيل التكرارات (الناتجة عن العدّادات المحلية أوفلاين)
// ويكمل الأرقام الفارغة للطلبات المدفوعة بأحدث تسلسل حر — آمن التكرار (idempotent).
function normalizeOrderNumbers(): void {
  const db = getDb();
  const dateCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateCompact}-`;
  const used = new Set<string>();
  const rows = queryAll('SELECT id, orderNumber FROM orders WHERE orderNumber LIKE ? ORDER BY id', [`${prefix}%`]);
  for (const r of rows) {
    const num = String(r.orderNumber || '');
    if (!used.has(num)) { used.add(num); continue; }
    const cand = `${prefix}${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
    try { db.run('UPDATE orders SET orderNumber = ? WHERE id = ?', [cand, r.id]); used.add(cand); } catch (e) { /* ignore */ }
  }
  const empties = queryAll("SELECT id FROM orders WHERE (orderNumber IS NULL OR orderNumber = '') AND paymentStatus = 'paid'");
  for (const e of empties) {
    if (used.has('')) continue;
    const cand = `${prefix}${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
    try { db.run('UPDATE orders SET orderNumber = ? WHERE id = ?', [cand, e.id]); used.add(cand); } catch (e) { /* ignore */ }
  }
}

// === Rate Limiter (in-memory) ===
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 120; // requests per window
const RATE_LIMIT_AUTH_MAX = 10; // auth attempts per window

// كل استدعاء rateLimit() يحمل مخزنه الخاص (سكوب مستقل): سابقاً كانت كل حدود
// الـ rate limit تتقاسم Map واحدة مفتاحية بالـ ip فقط، فكان عدّاد /api العام
// يخلط بعدّاد /api/orders/:id/checkout → 429 خاطئ بعد 10 طلبات /api دون سبب.
function rateLimit(windowMs = RATE_LIMIT_WINDOW, max = RATE_LIMIT_MAX) {
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
}

// === Security Headers ===
function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// === Input Sanitization (strip null bytes, limit string lengths) ===
// حدود الحقل الواحد: 20000 حرف — تكفي لنصوص POS الطويلة (محتويات قاعدة المعرفة،
// ملاحظات طلبات/فواتير/موردين) مع بقاء الحماية من إساءة استخدام الحمولة
// (الجسم ككل محدود بـ express.json limit 5mb أعلاه). قبل كانت 5000 قد تقصّ النصوص.
function sanitizeInput(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\0/g, '').slice(0, 20000);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('__')) continue; // block prototype pollution
      sanitized[k] = sanitizeInput(v);
    }
    return sanitized;
  }
  return obj;
}

const app = express();

// Security headers first
app.use(securityHeaders);

// HTTP request logging (winston)
app.use(httpLoggerMiddleware);

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization', 'x-session-token'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// Input sanitization
// ملاحظة: بروكسي LLM (/api/proxy-llm) مستثنى من اختصار النصوص (5000 حرف) لأن طلبات الدردشة
// قد تحمل messages أطول (سياق باتمان) — والمسار يتحقق من مدخلاته بنفسه (base http(s) إلزامي).
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    const p = (req.path || '').split('?')[0];
    if (p !== '/api/proxy-llm' && p !== '/api/openai') {
      req.body = sanitizeInput(req.body);
    }
  }
  next();
});

// Rate limiting on all API routes
app.use('/api', rateLimit());

// Stricter rate limit on auth-sensitive endpoints
app.use('/api/orders/:id/checkout', rateLimit(RATE_LIMIT_WINDOW, RATE_LIMIT_AUTH_MAX));

// التحميل العام غير المصادق: /api/auth/* (المصادقة عبر authRequired داخل المسارات)، و /health
// H1: /api/public-key = public configuration فقط، لا يُعيد أي secret إطلاقاً.
app.get('/api/public-key', (_req, res) => {
  // نُعيد بيانات عامة فعلية فقط — لا مفتاح/سر.
  res.json({ configured: true, secure: true, name: 'lucca', auth: 'session' });
});

app.get('/api/auth', (_req, res) => res.json({ status: 'auth-ok' }));
app.use('/api/auth', authRoutes);

// H1: تزويد كشك POS بمفتاح جهاز device-scoped — يتطلب جلسة admin (لا مفتاح/secret في السورس).
// يُزوَّد الكشك مرة عبر هذه الاستدعاء (مصادقة admin)، لا يُخزّن حرفياً في الواجهة، ويمكن تدويره دون إعادة نشر.
app.post('/api/auth/provision-device', authRequired, requirePasswordChanged, requireRole('admin'), (_req, res) => {
  const keys = getDeviceKeys();
  if (keys.length) res.json({ deviceKey: keys[0] });
  else res.status(500).json({ error: 'No device key configured (set DEVICE_API_KEY)' });
});

// H1: استعلام عن حالة الجهاز (admin) — لا يُعاد أي secret.
app.get('/api/auth/device-status', authRequired, requirePasswordChanged, requireRole('admin'), (_req, res) => {
  res.json({ configured: getDeviceKeys().length > 0 });
});

function apiKeyCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const p = (req.originalUrl || req.path || '').split('?')[0];
  // مسارات المصادقة تُدار بمعزل (تتطلب جلسة/مفتاح ضمن وسيطات authRequired)
  if (p.endsWith('/api/auth') || /\/api\/auth\//.test(p)) { next(); return; }
  // التحقق من الدعوة وإنشاء الحساب: عامة قبل الدخول (لا تعيد أي سر/كلمة مرور، البريد مثبّت للدعوة).
  if (/\/api\/invitations\/[^/]+\/(check|activate)$/.test(p)) { next(); return; }
  if (p.endsWith('/api/public-key')) { next(); return; }
  const identity = resolveIdentity(req as AuthRequest);
  if (identity) { next(); return; }
  res.status(401).json({ error: 'Unauthorized' });
}

app.use('/api', apiKeyCheck);

// تُركَّب دعوات الموظفين قبل special/analytics لأن مسارات check/activate عامة قبل الدخول،
// وهذه الرواتر (special/analytics) تفرض authRequired على مستوى الراوتر لكل /api/* —
// لو تُركِّبت بعدها لما وصلت check/activate إليها إطلاقاً (401). بقية مسارات الدعوة
// (الإنشاء) محمية داخلياً بـ requirePermission('employees.write').
app.use('/api', invitationRoutes);
app.use('/api', specialRoutes);
app.use('/api', analyticsRoutes);

app.use('/api', reportRoutes);
app.use('/api/batman', batmanRoutes);
app.use('/api/admin', adminRoutes);

// ===== H1: LLM Proxy (CORS-free — يضيف البطاقة السرية aquí) =====
// POST /api/proxy-llm  (أو alias /api/openai)
// يتطلب هوية (session أو device) عبر apiKeyCheck.
// يستخدم مفتاحاً يرسله العميل (localStorage luccaOpenAIKey) أو مفتاح البيئة OPENAI_API_KEY.
// يدعم مزوّدين:
//   target=openai  (الافتراضي) — يوجّه إلى base (البيئة أو العميل) مع Bearer key
//   target=ollama  — يوجّه إلى Ollama المحلي عبر /v1/chat/completions
// لا يخزّن المفتاح في الواجهة النهائية: البطاقة هنا بين يدي السيرفر فقط.
// P1: حارس SSRF — قائمة بيضاء للمضيفين، منع العناوين الخاصة/الميتاداتا، لا تتبع redirects،
//     سقف مهلة، سقف حجم الطلب والاستجابة. (المصادقة: authRequired + requirePasswordChanged مثل باتمان.)
const ALLOWED_PROXY_BASES = /^https?:\/\//i;

// قائمة بيضاء صارمة للمضيفات المسموح بها (حالة صغيرة). تشمل بيئة openai/ollama افتراضياً.
const PROXY_HOST_ALLOWLIST_BASE = new Set(['api.openai.com', 'api.x.ai', 'localhost', '127.0.0.1']);
function proxyAllowedHosts(): Set<string> {
  const s = new Set(PROXY_HOST_ALLOWLIST_BASE);
  for (const envKey of ['OPENAI_BASE_URL', 'OLLAMA_BASE_URL']) {
    const v = String(process.env[envKey] || '').trim();
    if (!v) continue;
    try { const h = new URL(v).hostname.toLowerCase(); if (h) s.add(h); } catch { /* تجاهل */ }
  }
  return s;
}

// P1: هل العنوان عنوان "خاص/ميتاداتا" يجب رفض الوصول إليه؟
function isPrivateIp(ip: string): boolean {
  const v6 = ip.toLowerCase();
  if (v6.includes(':')) {
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (m) return isPrivateIp(m[1]); // IPv4-mapped
    return false;
  }
  const o = String(ip).split('.').map((x) => Number(x));
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = o;
  if (a === 10) return true;                    // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;      // 192.168/16
  if (a === 169 && b === 254) return true;      // 169.254/16 (metadata 169.254.169.254)
  if (a === 127) return true;                   // 127/8 loopback
  if (a === 0) return true;                     // 0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224 && a <= 255) return true;        // multicast/reserved
  return false;
}

// P1: فحص SSRF قبل أي اتصال — قائمة بيضاء + رفض العناوين الخاصة (حتى بعد DNS)
async function assertSafeUpstreamHost(base: string): Promise<{ host: string }> {
  let url: URL;
  try { url = new URL(base); } catch { throw new HttpError(400, 'base غير صالح — تعذّر تحليل العنوان'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new HttpError(400, 'base غير صالح — لا يوجد مضيف');

  const allowedHosts = proxyAllowedHosts();
  if (!allowedHosts.has(host)) {
    throw new HttpError(400, `مضيف ${host} غير مسموح في قاعدة التوجيه (SSRF block) — أضف مضيف مزوّدك إلى OPENAI_BASE_URL / OLLAMA_BASE_URL`);
  }
  // الاستثناء المطوِّر المحلي يُسمح به (Ollama الشائع localhost/11434)
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { host };

  try {
    // حل DNS (حتى العناوين الحرفية تمر دون طلب) — نفحص العنوان المُحلَّل لصدّ إعادة توجيه/تسمّم
    const { address } = await lookup(host, { family: 0 });
    if (isPrivateIp(address)) {
      throw new HttpError(400, `عنوان ${host} خاص/ميتاداتا (${address}) — غير مسموح (SSRF block)`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `تعذّر التحقق من عنوان ${host} — رُفض الطلب (SSRF block)`);
  }
  return { host };
}

const MAX_PROXY_BODY_BYTES = 1_000_000;      // سقف حجم الطلب (payload)
const MAX_PROXY_TIMEOUT_MS = 120_000;        // سقف مهلة المزود مهما طلب العميل

app.post(['/api/proxy-llm', '/api/openai'], authRequired, requirePasswordChanged, async (req, res) => {
  const body = (req.body as Record<string, unknown>) || {};

  const target = String((req.headers['x-lucca-target'] as string) || body.target || 'openai').trim();
  if (target !== 'ollama' && target !== 'openai') {
    res.status(400).json({ ok: false, error: 'x-lucca-target غير معروف (openai / ollama فقط)' }); return;
  }

  // base: إما من العميل أو البيئة أو الافتراضي
  const rawBase = String(body.base || '').trim().replace(/\/+$/, '')
    || (target === 'ollama'
        ? (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').trim()
        : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim());
  const base = rawBase.replace(/\/+$/, '');
  if (!ALLOWED_PROXY_BASES.test(base)) {
    res.status(400).json({ ok: false, error: 'base غير صالح — يجب أن يبدأ بـ http(s)://' }); return;
  }

  // P1: حارس SSRF قبل أي طلب من المزود
  try {
    await assertSafeUpstreamHost(base);
  } catch (e: unknown) {
    const status = (e as any).status || 400;
    res.status(status).json({ ok: false, error: (e as Error).message }); return;
  }

  // المفتاح: يُرسله العميل (localStorage) أو مفتاح البيئة
  const key = String(body.key || '').trim() || process.env.OPENAI_API_KEY || '';
  if (target === 'openai' && !key) {
    res.status(400).json({ ok: false, error: 'لا يوجد مفتاح OpenAI — أضفه في .env أو بالسطر: مفتاح openai: sk-...' }); return;
  }

  const model = String(body.model || '').trim()
    || (target === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b') : (process.env.OPENAI_MODEL || 'gpt-4o-mini'));

  // بناء messages: يدعم { messages:[...] } أو { prompt:'...' }
  const messages: Array<{ role: string; content: string }> | null =
    Array.isArray(body.messages) ? body.messages as Array<{ role: string; content: string }> :
    (body.prompt != null ? [{ role: 'user', content: String(body.prompt) }] : null);
  if (!messages || messages.length === 0) {
    res.status(400).json({ ok: false, error: 'لا يوجد messages / prompt' }); return;
  }

  // P1: سقف حجم الطلب (payload)
  const payload: Record<string, unknown> = {
    model,
    messages,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    stream: false
  };
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PROXY_BODY_BYTES) {
    res.status(413).json({ ok: false, error: 'حجم الطلب تجاوز الحد المسموح' }); return;
  }

  // P1: سقف مهلة المزود
  const requested = Number(body.timeoutMs) || MAX_PROXY_TIMEOUT_MS;
  const timeoutMs = Math.min(requested, MAX_PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(target === 'ollama' ? { 'x-lucca-target': 'ollama' } : {})
      },
      body: payloadStr,
      redirect: 'manual', // P1: لا نتبع redirects (صدّ SSRF عبر إعادة توجيه)
      signal: AbortSignal.timeout(timeoutMs)
    });

    // P1: رد إعادة توجيه (3xx) → لا نتبعه، نرفض
    if (upstream.status >= 300 && upstream.status < 400) {
      res.status(502).json({ ok: false, provider: target, error: `المزود أراد إعادة توجيه (HTTP ${upstream.status}) — غير مسموح` }); return;
    }

    const rawText = await upstream.text();
    if (rawText.length > MAX_PROXY_BODY_BYTES) {
      res.status(502).json({ ok: false, provider: target, error: 'استجابة المزود تجاوزت الحد المسموح' }); return;
    }
    let j: Record<string, unknown> | null = null;
    try { j = rawText ? JSON.parse(rawText) : null; } catch { /* ليس JSON صالح */ }

    if (!upstream.ok) {
      const detail = (j && ((j as any).error?.message || (j as any).error))
        ? String((j as any).error?.message || (j as any).error)
        : (rawText.slice(0, 500) || `HTTP ${upstream.status}`);
      res.status(502).json({ ok: false, provider: target, error: `${target} HTTP ${upstream.status}: ${detail}` });
      return;
    }

    if (!j || typeof j !== 'object') {
      res.status(502).json({ ok: false, provider: target, error: 'استجابة غير صالحة من المزود' }); return;
    }

    const content = ((j as any).choices?.[0]?.message?.content as string) || '';
    res.json({ ok: !!content, text: content.trim(), provider: target === 'ollama' ? 'ollama' : 'openai', usedBase: base, model });
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(502).json({ ok: false, provider: target, error: isTimeout ? 'انتهت مهلة المزود (timeout)' : (e?.message || String(e)) });
  }
});

// Checkout endpoint: atomically close order and free table
// P1: يدعم division (split) — body.payments = [{ method|paymentMethod, amount, paymentSyncId }]
//     ومجموع الأجزاء يجب أن يطابق إجمالي الطلب (وإلا 409 والطلب يبقى مفتوحاً).
//     التحصيل الكامل داخل معاملة واحدة: طلب مغلق + دفعة/دفعات + خصم مخزون مرة + تدقيق.
// P2-A5: الإجمالي يُعاد حسابه على السيرفر من الأصناف فقط (مصدر الحقيقة) قبل أي تحقق/دفع —
//         تُتجاهل قيمة total القادمة من العميل وتُخزَّن القيمة المحسوبة في معاملة الإغلاق نفسها.
function checkoutTotals(order: Record<string, unknown>): { subtotal: number; discountAmount: number; total: number } {
  let raw = order.items ?? '[]';
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  const arr = Array.isArray(raw) ? raw : [];
  const subtotal = arr.reduce((s: number, it: any) =>
    s + (Number(it && it.quantity) || 1) * (Number((it && (it.unitPrice ?? it.price)) || 0)), 0);
  const discount = Number(order.discount) || 0;
  const discountType = String(order.discountType || 'percent');
  const discountAmount = discountType === 'fixed' ? discount : subtotal * (discount / 100);
  const tax = Number(order.tax) || 0;
  return { subtotal, discountAmount, total: subtotal - discountAmount + tax };
}

app.post('/api/orders/:id/checkout', authRequired, requirePermission('checkout'), (req, res) => {
  try {
    const db = getDb();
    const orderId = String(req.params.id);
    const body = req.body || {};
    const { paymentMethod, paymentSyncId, orderSyncId, payments } = body;
    const changeAmount = Number.isFinite(Number(body.changeAmount)) ? Number(body.changeAmount) : 0;

    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    // P2-A5: إجبار الحساب الصحيح قبل الدفع — يُعاد احتساب الإجماليات من الأصناف ويُستخدم ما خُصم للتو
    Object.assign(order, checkoutTotals(order));

    const isSameOrder = (p: Record<string, unknown>) => (
      String(p.orderId) === String(orderId) ||
      (p.orderSyncId && order.syncId && String(p.orderSyncId) === String(order.syncId))
    );

    // تقسيم الدفع: قائمة أجزاء كلٌّ بدفته المستقرة (paymentSyncId)
    const splitPayments = Array.isArray(payments) && payments.length > 0 ? payments : null;

    // H4: Idempotency — نفس الدفعة/الأجزاء المرسلة من عميل أوفلاين (اكتمل تحصيلها محلياً) لا تُسجَّل مرتين.
    // تُفحص قبل تحقق "الطلب مغلق" لأن إعادة محاولة نفس الدفعة قد تصادف طلباً أغلقته المحاولة الأولى.
    if (splitPayments) {
      const parts: Array<{ method: string; amount: number; syncId: string }> = splitPayments.map((p: any) => ({
        method: String((p && (p.method || p.paymentMethod)) || 'cash'),
        amount: Number((p && p.amount) || 0),
        syncId: String((p && p.paymentSyncId) || '').trim() || newSyncId(),
      }));
      if (parts.some(p => !(p.amount > 0))) { res.status(400).json({ error: 'قيمة كل دفعة يجب أن تكون أكبر من صفر' }); return; }
      // لو وُجدت كل أجزاء الـ split (بنفس syncId) لنفس الطلب → أُنجزت بالفعل → alreadyProcessed
      const found = parts.filter(p => {
        if (!p.syncId) return false;
        const dup = queryOne('SELECT id, orderId, orderSyncId FROM payments WHERE syncId = ?', [p.syncId]);
        return !!dup && isSameOrder(dup);
      });
      if (found.length === parts.length && parts.length > 0) {
        const already = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
        res.json({ success: true, alreadyProcessed: true, order: already ? { ...already, items: JSON.parse((already.items as string) || '[]') } : null });
        return;
      }
    } else if (paymentSyncId) {
      const dup = queryOne('SELECT id, orderId, orderSyncId FROM payments WHERE syncId = ?', [paymentSyncId]);
      if (dup && isSameOrder(dup)) {
        const already = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
        res.json({ success: true, alreadyProcessed: true, order: already ? { ...already, items: JSON.parse((already.items as string) || '[]') } : null });
        return;
      }
    }

    if (order.status === 'closed') { res.status(409).json({ error: 'Order is already closed' }); return; }
    if (order.status === 'cancelled' || order.status === 'completed') { res.status(409).json({ error: `Order is already ${order.status}` }); return; }

    const total = (order.total as number) || 0;
    const createdBy = (order.createdBy as string) || 'unknown';
    const today = new Date().toISOString().slice(0, 10);

    // تحديد الدفعات الفعلية التي سيُغلق بها الطلب — خارج المعاملة (لا كتابات قبل تأكيد الصلاحية)
    let method: string;
    let payRows: Array<{ amount: number; method: string; syncId: string }>;
    if (splitPayments) {
      const parts = splitPayments.map((p: any) => ({
        method: String((p && (p.method || p.paymentMethod)) || 'cash'),
        amount: Number((p && p.amount) || 0),
        syncId: String((p && p.paymentSyncId) || '').trim() || newSyncId(),
      }));
      const collected = parts.reduce((s, p) => s + p.amount, 0);
      if (Math.abs(collected - total) > 0.01) {
        // P1: مبلغ الدفعات لا يغطي الإجمالي (أو يجاوزه) → لا يُغلق الطلب، يبقى مفتوحاً.
        // التدقيق يُسجَّل خارج أي معاملة (لا يُتراجع مع rollback).
        logAudit('checkout.rejected', 'orders', orderId,
          { reason: `split ${collected} ≠ total ${total}`, attemptedBy: actorFrom(req) },
          actorFrom(req));
        res.status(409).json({ error: `مبلغ الدفعات (${collected.toFixed(2)}) لا يطابق إجمالي الطلب (${total.toFixed(2)}) — لم يُغلق الطلب، أعد المحاولة بالمبلغ الصحيح` });
        return;
      }
      method = parts.length === 1 ? parts[0].method : 'split';
      payRows = parts.map(p => ({ amount: p.amount, method: p.method, syncId: p.syncId }));
    } else {
      method = (paymentMethod as string) || 'cash';
      payRows = [{ amount: total, method, syncId: paymentSyncId || newSyncId() }];
    }
    const orderSync = (orderSyncId || (order.syncId as string)) || null;

    beginImmediateTransaction(); // C3-P0: قفل كتابة فوري — لا تداخل مع أي كتابة أخرى أثناء التحصيل
    try {

      // 1. Generate order_number if missing (ORD-YYYYMMDD-NNN)
      let orderNumber = order.orderNumber as string;
      if (!orderNumber) {
        const dateCompact = today.replace(/-/g, '');
        orderNumber = `ORD-${dateCompact}-${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
      } else {
        // السيرفر هو مصدر الحقيقة: رقم مكرر اليوم (عميل أوفلاين) يُعاد توليده بتسلسل حر فريد
        const clash = queryOne('SELECT id FROM orders WHERE orderNumber = ? AND id != ?', [orderNumber, orderId]);
        if (clash) {
          const dateCompact = today.replace(/-/g, '');
          orderNumber = `ORD-${dateCompact}-${String(nextFreeOrderSeq(dateCompact)).padStart(3, '0')}`;
        }
      }

      // 2. Close the order with payment info (P2-A5: يخزّن الإجماليات المحسوبة على السيرفر)
      db.run(
        'UPDATE orders SET status = ?, paymentMethod = ?, paymentStatus = ?, totalPaid = ?, changeAmount = ?, orderNumber = ?, subtotal = ?, discountAmount = ?, total = ? WHERE id = ?',
        ['closed', method, 'paid', total, changeAmount, orderNumber, order.subtotal, order.discountAmount, total, orderId]
      );

      // 3. Free the table if this is a dine-in order
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

      // 4. Insert payment record(s) (مع syncId/orderSyncId حتى يعكسه pull على جهاز آخر)
      // لكل جزء من الـ split سطرُه الخاص بهويته المستقرة (paymentSyncId) — idempotent عند الإعادة.
      for (const pr of payRows) {
        db.run(
          'INSERT INTO payments (orderId, amount, method, status, createdBy, syncId, orderSyncId) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orderId, pr.amount, pr.method, 'completed', createdBy, pr.syncId, orderSync]
        );
      }

      // 5. Insert order items into order_items table
      const items = JSON.parse((order.items as string) || '[]');
      for (const item of items) {
        const itemTotal = item.total || (item.quantity || 1) * (item.unitPrice || item.price || 0);
        db.run(
          'INSERT INTO order_items (orderId, productId, name, quantity, unitPrice, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orderId, item.productId || null, item.name || '', item.quantity || 1, item.unitPrice || item.price || 0, itemTotal, item.notes || '']
        );
      }

      // C3-P0: خصم المخزون داخل نفس معاملة التحصيل (مصدر الحقيقة = السيرفر).
      // غير مزدوج (يُتخطى إن سبقت حركة sale لنفس الطلب)، وعجز المخزون ← 409 وتراجع كامل.
      // لاحظ: يُنفَّذ مرة واحدة حتى مع الدفع المقسّم (كل أجزاء الـ split داخل نفس المعاملة).
      applyStockDeduction(String(orderId), items);

      // 6. Insert status history record
      db.run(
        "INSERT INTO order_status_history (orderId, status, changedBy, createdAt) VALUES (?, ?, ?, datetime('now'))",
        [orderId, 'closed', createdBy]
      );

      // 7. Update daily shift sales data (نقدي/إلكتروني: للـ split نجمع أجزاء الكاش فقط)
      const existingShift = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [today]);
      if (existingShift) {
        const cashTotal = payRows.reduce((s, p) => s + (p.method === 'cash' ? p.amount : 0), 0);
        const cashSales = (existingShift.cashSales as number || 0) + cashTotal;
        const cardSales = (existingShift.cardSales as number || 0) + (total - cashTotal);
        const totalSales = (existingShift.totalSales as number || 0) + total;
        const orderCount = (existingShift.orderCount as number || 0) + 1;
        db.run(
          'UPDATE daily_shifts SET cashSales = ?, cardSales = ?, totalSales = ?, orderCount = ? WHERE date = ?',
          [cashSales, cardSales, totalSales, orderCount, today]
        );
      }

      // P1: تدقيق التحصيل (نجاح) — المبلغ ونوع الدفع وعدد الأجزاء والفاعل
      logAudit('checkout', 'orders', orderId,
        { total, method, parts: payRows.map(p => ({ method: p.method, amount: p.amount, syncId: p.syncId })), actor: actorFrom(req) },
        actorFrom(req));

      commitTransaction();
      const closedOrder = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
      res.json({ success: true, order: closedOrder ? { ...closedOrder, items: JSON.parse((closedOrder.items as string) || '[]') } : null });
    } catch (e) {
      rollbackTransaction();
      // C3-P0: عجز المخزون أثناء التحصيل / P1: خطأ مبلغ الدفعات — خطأ 409 واضح مع تراجع كامل للمعاملة
      if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
      throw e;
    }
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Void/Refund endpoint: إلغاء/استرداد طلب بصلاحية منفصلة (refunds.void — مدير/أدمن فقط)
// + سبب إلزامي + سجل تدقيق يحفظ الموظف الأصلي ومَن ألغى.
app.post('/api/orders/:id/void', authRequired, requirePermission('refunds.void'), (req, res) => {
  try {
    const db = getDb();
    const orderId = req.params.id;
    const { reason, note, refundMethod } = req.body || {};
    if (!reason || !String(reason).trim()) { res.status(400).json({ error: 'السبب إلزامي لا يمكن تركه فارغاً' }); return; }

    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (order.status === 'cancelled') { res.status(409).json({ error: 'Order already voided' }); return; }

    const identity = (req as AuthRequest).identity;
    const cancellerUsername = (identity && identity.username) || 'unknown';
    let cancellerName = cancellerUsername;
    let cancellerRole = (identity && identity.role) || '';
    if (identity && identity.kind === 'user' && identity.userId != null) {
      try {
        const u = queryOne('SELECT name, role FROM users WHERE id = ?', [identity.userId]);
        if (u) {
          cancellerName = ((u.name as string) || cancellerUsername);
          cancellerRole = (u.role as string) || cancellerRole;
        }
      } catch { /* best-effort */ }
    }
    const originalBy = (order.createdBy as string) || 'unknown';
    const originalUserId = (order as any).userId ?? null;
    const total = (order.total as number) || 0;

    // P2-A3: void لا يُسمح إلا لطلب مدفوع فعلاً (صافي مدفوع > 0) — لا إلغاء/استرداد لطلب مفتوح
    const payStatus = String(order.paymentStatus || '');
    const netPaid = Number(order.totalPaid) > 0 ? Number(order.totalPaid) : (total > 0 ? total : 0);
    if (payStatus !== 'paid' || !(netPaid > 0)) {
      res.status(409).json({ error: 'الطلب غير مدفوع — لا يمكن إلغاؤه/استرداده عبر /void. أكمِل الدفع عبر /checkout أو احذف الطلب المفتوح' });
      return;
    }
    // P2-A3: سقف الاسترداد = الصافي المدفوع − مجموع الاستردادات السابقة (يمنع المسترد > المدفوع)
    let alreadyRefunded = 0;
    try {
      const agg = queryOne('SELECT COALESCE(SUM(amount), 0) AS s FROM refunds WHERE orderId = ?', [orderId]);
      alreadyRefunded = Number(agg && agg.s) || 0;
    } catch { /* طاولة الاستردادات قديمة/غير متاحة */ }
    const refundable = netPaid - alreadyRefunded;
    if (!(refundable > 0.01)) {
      res.status(409).json({ error: 'لا مبلغ متبقٍ لاسترداده — الطلب مُستردّ بكامله سابقاً' });
      return;
    }
    // P2-A3: اتخذنا "void يعيد الصافي المتبقي مرة واحدة" — لا يتجاوز سقف الصافي أبداً
    const voidAmount = refundable;

    beginImmediateTransaction(); // C3-P0: قفل كتابة فوري للمعاملات المالية (void)
    try {
      // 1. Insert refund (مكتمل بياناته: الموظف الأصلي + مَن ألغى + السبب)
      db.run(
        'INSERT INTO refunds (orderId, amount, reason, note, refundMethod, createdBy, voidedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
        [orderId, voidAmount, String(reason).trim(), (note || '').trim(), refundMethod || order.paymentMethod || 'cash', originalBy, cancellerName]
      );

      // 2. Cancel the order with void metadata
      db.run(
        `UPDATE orders SET status = 'cancelled', voidReason = ?, voidNote = ?, voidedAt = datetime('now'),
           voidedBy = ?, paymentStatus = 'refunded', refundAmount = ? WHERE id = ?`,
        [String(reason).trim(), (note || '').trim(), cancellerName, voidAmount, orderId]
      );

      // 3. Free the table
      const tableId = order.tableId as string | undefined;
      if (tableId && tableId !== 'takeaway' && !isNaN(Number(tableId))) {
        db.run('UPDATE tables_store SET status = ?, currentOrder = ? WHERE id = ?', ['available', null, Number(tableId)]);
      }

      // 4. Status history
      db.run(
        "INSERT INTO order_status_history (orderId, status, changedBy, notes, createdAt) VALUES (?, ?, ?, ?, datetime('now'))",
        [orderId, 'cancelled', cancellerName, `reason: ${reason}, note: ${note || ''}`]
      );

      // C3-P0: إعادة المخزون الذي خصمه التحصيل — مرة واحدة فقط (داخل نفس المعاملة)
      try { restoreStockAfterVoid(String(orderId)); } catch { /* best-effort داخل المعاملة */ }

      // P2-A3: حركة صندوق سالبة مرة — تُنقص وردية اليوم بنفس المقدار داخل نفس المعاملة.
      // Idempotent: الطلب أصبح cancelled في نفس المعاملة — void ثانٍ يُرفض قبل الوصول إلى هنا.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const sh = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [today]);
        if (sh) {
          const m = String(refundMethod || order.paymentMethod || 'cash');
          const cashPart = (m === 'cash' || m === 'كاش') ? voidAmount : 0;
          db.run(
            'UPDATE daily_shifts SET cashSales = ?, cardSales = ?, totalSales = ? WHERE date = ?',
            [Number(sh.cashSales || 0) - cashPart, Number(sh.cardSales || 0) - (voidAmount - cashPart), Number(sh.totalSales || 0) - voidAmount, today]
          );
        }
      } catch { /* best-effort */ }

      // 5. Audit with BOTH the original employee and the canceller (no silent void)
      try {
        db.run(
          `INSERT INTO audit_logs (action, objectType, objectId, oldValue, newValue, userName, createdAt)
           VALUES ('order.void_refund', 'orders', ?, ?, ?, ?, datetime('now'))`,
          [orderId,
           JSON.stringify({ total, netPaid, alreadyRefunded, status: order.status, createdBy: originalBy, userId: originalUserId }),
           JSON.stringify({ refundAmount: voidAmount, reason, note, cancelledBy: cancellerName, cancellerRole, originalEmployee: originalBy }),
           cancellerName]
        );
      } catch { /* audit may be unavailable */ }

      commitTransaction();
      const voided = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
      res.json({ success: true, order: voided ? { ...voided, items: JSON.parse((voided.items as string) || '[]') } : null });
    } catch (e) {
      rollbackTransaction();
      throw e;
    }
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Sync: POST /api/sync  (C2: دمج آمن — لا DELETE، لا استبدال أعمى)
// الهوية المستقرة = syncId (وليس autoincrement id). القرار:
//   - INSERT إذا لم يكن السجل موجوداً بالسيرفر
//   - SKIP إذا تطابق المحتوى
//   - UPDATE فقط إذا كانت النسخة المرسلة أحدث بشكل موثوق (version/revision أو فرق زمني خارج نافذة الغموض)
//   - CONFLICT (لا تُكتب) في كل حالة غموض أو تعارض دون نسخة أحدث موثوقة

const AMBIGUITY_MS = 5000; // التواريخ ضمن هذه النافذة غير موثوقة → CONFLICT
// مقارنة "نفس البيانات" من منظور السجل القادم فقط: نصحّب فقط الأعمدة التي يرسلها العميل،
// ونقارن قيمها مع ما هو مخزّن عند السيرفر (السيرفر قد يمتلك أعمدة default إضافية).
function sameData(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const skip = new Set(['id', 'syncId', 'updatedAt', 'updated_at', 'revision', 'version']);
  for (const k of Object.keys(incoming || {})) {
    if (skip.has(k)) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) === false) continue;
    const iv = incoming[k];
    const ev = existing[k];
    const norm = (x: unknown) => (x && typeof x === 'object') ? JSON.stringify(x) : String(x ?? '');
    if (norm(iv) !== norm(ev)) return false;
  }
  return true;
}
function tableNameFor(store: string): string | null {
  const candidate = store === 'tables' ? 'tables_store' : store;
  try {
    const rows = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [candidate]);
    return rows.length > 0 ? candidate : null;
  } catch { return null; }
}

// ===== PT12: توافق أعمدة بين العميل والسيرفر =====
// يرسل العميل حقولاً بأسماء قد لا تطابق أعمدة الجدول (مثل price بدل unitPrice للـ order_items).
// نترجم الأسماء عبر ALIAS، ونجلب قائمة الأعمدة الفعلية للجدول ونكتب الأعمدة الموجودة فعلاً فقط
// حتى لا يحدث "no such column" عند INSERT/UPDATE، مع الحفاظ على كل البيانات التاريخية.
const COLUMN_ALIASES: Record<string, Record<string, string>> = {
  order_items: { price: 'unitPrice' }
};

const _columnCache = new Map<string, string[]>();
function columnsFor(table: string): string[] {
  const cached = _columnCache.get(table);
  if (cached) return cached;
  let names: string[] = [];
  try {
    const rows = queryAll(`PRAGMA table_info(\`${table}\`)`);
    names = rows.map(r => String(r.name));
  } catch { names = []; }
  _columnCache.set(table, names);
  return names;
}
// يبني قائمة أعمدة صالحة للكتابة: يترجم الأسماء ثم يفلتر بالأعمدة الموجودة فعلاً في الجدول.
function validColumns(store: string, target: string, item: Record<string, unknown>): string[] {
  const tableCols = new Set(columnsFor(target));
  const alias = COLUMN_ALIASES[store] || {};
  const out: string[] = [];
  for (const k of Object.keys(item)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || k.length > 64) continue;
    const mapped = alias[k] || k;
    if (!tableCols.has(mapped)) continue; // تجاهل أعمدة غير موجودة بأمان (لا "no such column")
    if (out.indexOf(mapped) === -1) out.push(mapped);
  }
  return out;
}
// ترجمة قياسية لعمود واحد (تُستخدم في تحديث قيم الـ sameData/INSERT).
function mapKey(store: string, k: string): string {
  return (COLUMN_ALIASES[store] || {})[k] || k;
}

app.post('/api/sync', authRequired, requirePermission('sync'), (req, res) => {
  let db;
  const log = { inserted: 0, updated: 0, skipped: 0, conflicts: 0, conflictDetail: [] as any[] };
  try {
    db = getDb();
    const data = req.body || {};
    // H2+P2-A4: نمنع مزامنة المخازن الإدارية (users/settings/audit/daily_shifts/shifts والمالية/المخزون)
    // إلا بهوية دور admin حصراً. manager/cashier/device لا يمسّون users أبداً (خصوصاً role/password).
    const identity = resolveIdentity(req as AuthRequest);
    const isAdminish = identity ? (identity.role === 'admin') : false;
    const stores = [
      'users', 'invitations', 'tables', 'tables_store', 'orders', 'customers', 'settings', 'inventory',
      'purchases', 'employees', 'attendance', 'expenses', 'shifts', 'daily_shifts',
      'categories', 'products', 'product_modifiers', 'product_variations',
      'payment_methods', 'taxes', 'payments', 'refunds', 'audit_logs',
      'order_items', 'order_status_history', 'discounts',
      'invoices', 'suppliers', 'stock_movements', 'product_recipes', 'waste_log',
      'inventory_alerts', 'cash_registers'
    ];
    const processed = new Set<string>();
    beginTransaction();
    for (const store of stores) {
      const items = data[store];
      if (!Array.isArray(items)) continue;
      const target = tableNameFor(store);
      if (!target || processed.has(target)) continue;
      processed.add(target);

      // H2: المخازن الإدارية لا تُزامَن إلا بهوية إدارية (تمنع تعديل كلمات المرور/الإعدادات عبر مفتاح الجهاز)
      if (ADMIN_ONLY_STORES.has(store) && !isAdminish) {
        log.skipped += (items as unknown[]).length;
        log.conflictDetail.push({ store, skipped: items.length, reason: 'مخزن إداري — يلزم صلاحية إدارية' });
        continue;
      }

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const syncId = item.syncId as string | undefined;

        // إعادة ربط الأبوين: نستبدل معرف الأب الرقمي القادم من عميل آخر بالمعرف الصحيح على هذا الخادم
        // عبر الهوية المستقرة (orderSyncId). relationMap: [syncField, fkField, parentTable]
        const remapRule = (store === 'order_items' || store === 'payments' || store === 'refunds' ||
                           store === 'order_status_history' || store === 'invoices')
            ? ['orderSyncId', 'orderId', 'orders']
            : null;
        if (remapRule && item[remapRule[0]]) {
          try {
            const parent = queryOne(`SELECT id FROM \`${remapRule[2]}\` WHERE syncId = ?`, [item[remapRule[0]]]);
            if (parent) item[remapRule[1]] = parent.id;
          } catch { /* keep incoming value */ }
        }

        // F4: منع فتح وردية ثانية لنفس الصندوق على الخادم — لا يسمح بوجود أكثر من وردية مفتوحة
        // (مفتاح واحد: status='open') حتى لو جاءت بهوية مستقرة مختلفة (جهاز/كاشير آخر).
        // لا نستبدل ولا نحذف — نرفض الوردة الثانية ونسجّلها تعارضاً ليتحقق الجهاز محلياً.
        if (store === 'cash_registers' && item && item.status === 'open') {
          try {
            const openCount = queryOne("SELECT COUNT(*) as c FROM cash_registers WHERE status = 'open' ");
            if (openCount && Number(openCount.c) >= 1) {
              const rowSync = item.syncId as string | undefined;
              const already = rowSync
                ? queryOne("SELECT id FROM cash_registers WHERE syncId = ?", [rowSync])
                : undefined;
              if (!already) {
                log.conflicts++;
                log.conflictDetail.push({ syncId: rowSync || null, reason: 'وردية أخرى مفتوحة فعلاً — لا يمكن فتح وردية ثانية', store });
                continue;
              }
            }
          } catch { /* توافق مع قواعد قديمة */ }
        }

        // PT12: بناء نسخة معيارية من الأعمدة — تُترجم الأسماء (price→unitPrice) وتُكتب
        // فقط الأعمدة الموجودة فعلاً في الجدول (يمنع "no such column" ولا يفقد بيانات تاريخية).
        const tableCols = new Set(columnsFor(target));
        const alias = COLUMN_ALIASES[store] || {};
        const cols: string[] = [];
        const vals: unknown[] = [];
        const normItem: Record<string, unknown> = {};
        for (const k of Object.keys(item)) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || k.length > 64) continue;
          const mapped = alias[k] || k;
          if (mapped === 'id') continue;
          if (!tableCols.has(mapped)) continue;
          if (cols.indexOf(mapped) === -1) { cols.push(mapped); vals.push(item[k]); }
          normItem[mapped] = item[k];
        }
        if (cols.length === 0) continue;

        // 1) هل السجل موجود بالسيرفر (بالهوية المستقرة)؟
        let existing: Record<string, unknown> | undefined;
        if (syncId) {
          try { existing = queryOne(`SELECT * FROM \`${target}\` WHERE syncId = ?`, [syncId]); } catch { existing = undefined; }
        }
        // fallback: نبحث بالـ id الرقمي فقط للتوافق مع البيانات القديمة،
        // وبشرط أن يكون الوارد بلا syncId والسجل القديم على السيرفر بلا syncId أيضاً.
        // (يمنع دمج سجل جديد يحمل syncId مختلف مع سجل سيرفر آخر عبر اتفاق معرفات autoincrement المحلية)
        if (!existing && !syncId && item.id != null) {
          try {
            const legacy = queryOne(`SELECT * FROM \`${target}\` WHERE id = ?`, [item.id]);
            if (legacy && !legacy.syncId) existing = legacy;
          } catch { existing = undefined; }
        }

        // C3-P0: قيود التزامن المالي — الخادم مصدر الحقيقة للدفع/الإغلاق.
        // لهويات غير إدارية (device/cashier/kitchen):
        //  - الطلب الوارد بحالة نافذة/مدفوعة (paid/closed/... ) لا يُقبل إطلاقاً (لا عبر INSERT ولا UPDATE).
        //  - الطلب المغلق/المدفوع على السيرفر لا يُعدَّل من أي عميل محدود.
        //  - الإجمالي يجب أن يطابق الحساب (الأصناف − الخصم + الضريبة) — لا last-write-wins على total.
        if (store === 'orders' && !isAdminish) {
          const incStatus = normItem.status ? String(normItem.status) : '';
          const incPay = normItem.paymentStatus ? String(normItem.paymentStatus) : '';
          const incTerminal = (incStatus && !ORDER_WORKING.has(incStatus)) || incPay === 'paid' || incPay === 'refunded';
          const exTerminal = existing && existing.status && !ORDER_WORKING.has(String(existing.status));
          if (incTerminal || exTerminal) {
            log.conflicts++;
            log.skipped++;
            log.conflictDetail.push({
              syncId: syncId || null,
              store,
              reason: incTerminal
                ? 'الطلب وارد بحالة نافذة/مدفوعة — لا يُقبل عبر المزامنة (التحصيل عبر /checkout)'
                : 'الطلب مغلق/مدفوع على السيرفر — لا يُعدَّل من عميل محدود'
            });
            continue;
          }
          if (normItem.total !== undefined) {
            const expT = expectedTotalFrom(normItem, existing);
            if (expT != null && Math.abs(Number(normItem.total) - expT) > 0.01) {
              log.conflicts++;
              log.skipped++;
              log.conflictDetail.push({ syncId: syncId || null, store, reason: 'تغيير يدوي للإجمالي غير مطابق للحساب — اترك إجمالي الخادم كما هو' });
              continue;
            }
          }
        }

        // 2) دمج
        if (!existing) {
          // INSERT — لا نستورد id الرقمي من عميل آخر (نترك autoincrement يعيّن id محلياً صحيحاً)
          const c = cols.map(k => `\`${k}\``).join(', ');
          const v = cols.map(() => '?').join(', ');
          try {
            db.run(`INSERT INTO \`${target}\` (${c}) VALUES (${v})`, vals);
            log.inserted++;
          } catch (e) {
            // Phase 3: منافسة كتابة متزامنة لنفس syncId — فهرس ux_orders_syncId الفريد يمنع التكرار،
            // وعند اصطدام الأدخل نسحب للإدراج يتحول لحقن محدّث (idempotent بدل تعارض عالٍ).
            const raced = syncId ? (() => {
              try { return queryOne(`SELECT * FROM \`${target}\` WHERE syncId = ?`, [syncId]) as Record<string, unknown> | undefined; }
              catch { return undefined; }
            })() : undefined;
            if (raced) {
              const set = cols.map(k => `\`${k}\` = ?`).join(', ');
              db.run(`UPDATE \`${target}\` SET ${set} WHERE syncId = ?`, [...cols.map(k => item[k]), syncId]);
              log.updated++;
              log.conflictDetail.push({ syncId, reason: 'سبق ووصل من جهاز آخر — حُدّث بدل التعارض', store });
            } else {
              log.conflicts++;
              log.conflictDetail.push({ syncId, reason: 'فشل إدراج: ' + (e as Error).message, store });
            }
          }
        } else if (sameData(existing, normItem)) {
          log.skipped++;
        } else {
          // تحديث موثوق فقط
          const lv = normItem.version != null ? normItem.version : normItem.revision;
          const sv = existing.version != null ? existing.version : existing.revision;
          let newer: 'incoming' | 'existing' | null = null;
          if (lv != null && sv != null && lv !== sv) newer = lv > sv ? 'incoming' : 'existing';
          if (!newer) {
            const it = normItem.updatedAt || normItem.updated_at;
            const et = existing.updatedAt || existing.updated_at;
            if (it && et) {
              const a = new Date(String(et)).getTime();
              const b = new Date(String(it)).getTime();
              if (!Number.isNaN(a) && !Number.isNaN(b)) {
                const d = b - a;
                if (Math.abs(d) >= AMBIGUITY_MS) newer = d > 0 ? 'incoming' : 'existing';
              }
            }
            if (!newer) { if (et && !it) newer = 'existing'; if (!et && it) newer = 'incoming'; }
          }
          if (newer === 'incoming') {
            const set = cols.map(k => `\`${k}\` = ?`).join(', ');
            try {
              db.run(`UPDATE \`${target}\` SET ${set} WHERE id = ?`, [...vals, existing.id]);
              log.updated++;
            } catch (e) { log.conflicts++; log.conflictDetail.push({ syncId, reason: 'فشل تحديث: ' + (e as Error).message, store }); }
          } else {
            // لا نكتب: إما النسخة المحلية أحدث أو غموض تعارض
            log.conflicts++;
            log.conflictDetail.push({ syncId, reason: newer === 'existing' ? 'النسخة المحلية أحدث' : 'تعارض بلا نسخة أحدث موثوقة', store });
          }
        }
      }
    // PT-FKRelink: بعد دمج الدفعة، تُعاد ربط أبناء orders بالمفتاح الخارجي الصحيح
      // (orderId الحقيقي للسيرفر) عبر orderSyncId. العميل دائماً يرسل orderSyncId، وبدون هذا الربط
      // قد ترتبط order_items/payments/invoices بصفوف orders ذات معرفات رقمية محلية غريبة عن السيرفر.
      const FK_CHILDREN = ['order_items', 'payments', 'invoices', 'refunds', 'order_status_history'];
      for (const t of FK_CHILDREN) {
        try {
          db.run(
            `UPDATE \`${t}\` SET orderId = (SELECT o.id FROM orders o WHERE o.syncId = \`${t}\`.orderSyncId)
             WHERE orderSyncId IS NOT NULL AND orderSyncId != ''`
          );
        } catch { /* child table/column may not exist */ }
      }
    }
    // PT-OrderNumberNormalize: أرقام طلبات فريدة لكل يوم (السيرفر مصدر الحقيقة — يعالج طلبات أوفلاين المدفوعة)
    // يُنفَّذ مرة واحدة فقط بعد دمج كل المخازن (لا مرة لكل مخزن في الحلقة أعلاه).
    try { normalizeOrderNumbers(); } catch { /* لا تُوقف الدمج إن تعذّرت الكتابة */ }
    commitTransaction();
    // تسجيل سجل المزامنة (sync_log)
    try {
      db.run(
        'INSERT INTO sync_log (direction, inserted, updated, skipped, conflicts, conflictDetail, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['push', log.inserted, log.updated, log.skipped, log.conflicts, JSON.stringify(log.conflictDetail), 'دمج آمن من العميل']
      );
      saveDb();
    } catch { /* sync_log قد لا يوجد في قاعدة قديمة جداً */ }
    res.json({ success: true, message: '✅ تم دمج البيانات (Safe Sync)', log });
  } catch (e: unknown) {
    if (db) rollbackTransaction();
    res.status(500).json({ error: (e as Error).message });
  }
});

// === Aggregation Endpoints ===
app.get('/api/reports/summary', authRequired, requirePermission('reports.read'), (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const orders = queryAll(
      "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, COALESCE(AVG(total), 0) as avgOrder FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid'",
      [from, to]
    );
    const expenses = queryAll(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(date) >= ? AND date(date) <= ?",
      [from, to]
    );
    const refunds = queryAll(
      "SELECT COALESCE(SUM(amount), 0) as total FROM refunds WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59'",
      [from, to]
    );
    const payments = queryAll(
      "SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE createdAt >= ? AND createdAt <= ? || 'T23:59:59' GROUP BY method",
      [from, to]
    );
    const topItems = queryAll(
      "SELECT oi.name, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.orderId = o.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY oi.name ORDER BY revenue DESC LIMIT 10",
      [from, to]
    );
    const dailySales = queryAll(
      "SELECT date(date) as date, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue FROM orders WHERE date(date) >= ? AND date(date) <= ? AND paymentStatus = 'paid' GROUP BY date(date) ORDER BY date(date)",
      [from, to]
    );
    res.json({
      orders: orders[0] || { count: 0, revenue: 0, avgOrder: 0 },
      expenses: (expenses[0] || {}).total || 0,
      refunds: (refunds[0] || {}).total || 0,
      payments,
      topItems,
      dailySales
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/reports/sales-by-category', authRequired, requirePermission('reports.read'), (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const rows = queryAll(
      "SELECT COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') as category, SUM(oi.quantity) as totalSold, SUM(oi.total) as revenue FROM order_items oi LEFT JOIN products p ON oi.productId = p.id LEFT JOIN categories c ON p.categoryId = c.id JOIN orders o ON oi.orderId = o.id WHERE date(o.date) >= ? AND date(o.date) <= ? AND o.paymentStatus = 'paid' GROUP BY COALESCE(NULLIF(c.name_ar, ''), c.name, 'غير محدد') ORDER BY revenue DESC",
      [from, to]
    );
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.use('/api/tables', tableLocksRoutes);

app.use('/api', crudRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Start server
initDb().then(() => {
  startBackupScheduler();
  app.listen(PORT, () => {
    console.log(`✅ Lucca Backend running on http://localhost:${PORT}`);
    logger.info('server_started', { port: PORT });
  });
});

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
