# H1-SECURITY-AUDIT — تدقيق كشف مفتاح API / تقوية Public Key (قبل التعديل)
**التاريخ:** 2026-08-31
**النطاق:** `/api/public-key`، كثافة مفتاح API القديم، الاعتماد عليه، تخزينه/تعرضه، علاقته بـ Server Session Token (H2).
**المبدأ:** لم أُعدّل أي كود لاحقاً — هذه المرحلة تشخيص فقط (أُجريت قبل بدء H1).

---

## 1) `/api/public-key` (الوضع الحالي)
`backend/src/index.ts:99-102`:
```js
app.get('/api/public-key', (_req, res) => {
  res.json({ configured: true, secure: true });   // H2: لم يعد يُعيد المفتاح
});
```
- أصبح **public configuration فقط** — لا يعيد أي secret (H2 أزال إعادة المفتاح الفعلي).
- يُستخدم في `index.html:1711` (`testServerConnection`) فقط لاختبار إن كان السيرفر حياً.

## 2) مواضع استدعاء key API / تخزينه
الاعتماد على مفتاح/`x-api-key` في الواجهة:

| الموقع | النوع | الوظيفة |
|---|---|---|
| `index.html:2970` | حرفي `|| 'lucca-secret-key'` | دفع background بعد الطلب |
| `index.html:4839` | `localStorage.luccaApiKey || 'lucca-secret-key'` | قائمة أعمال غير المتزامن |
| `index.html:1714` | يعرض `data.apiKey` | نص `testServerConnection` (قتيل منذ H2) |
| `admin/database.js:2552,2604,2719` | `localStorage.luccaApiKey || 'lucca-secret-key'` | pushAll / pullAll / testConnection |
| `admin/database.js:2737-2739` | يجلب `public-key` ثم يخزّن `data.apiKey` في localStorage | تهيئة (قتيل منذ H2 — لا يُعاد key) |
| `admin/database.js:482,491` | `getApiKey()` → localStorage | `ServerAPI.authHeaders` fallback |
| `admin/index.html:2197`,`_script.html:28` | `localStorage.luccaApiKey \|\| ''` | `apiFetch` fallback (بلا حرفي) |

## 3) تقييم التعرض
- المفتاح **hardcoded** افتراضياً في الخادم (`index.ts:12`, `auth.ts:164`) وفي `.env.example` وفي مراجع حرفية عبر ملفات العميل.
- يُخزَّن في **localStorage** (`luccaApiKey`) ويُرسل سابقاً عبر `/api/public-key` (أُوقف).
- **يُستخرج من DevTools** ومن **كود المصدر** (الحرفي `lucca-secret-key`).
- **النطاق الفعلي لهذا المفتاح الآن (بعد H2) = دور `device` فقط** (`sync/checkout/orders`)، لا إدارة مستخدمين ولا مدفوعات/استردادات ولا تقارير. الخطر الحقيقي محدود بهذا النطاق.

## 4) العلاقة بالمفتاح القديم مقابل Server Session Token
- **Server Session Token** (Bearer من `/api/auth/login`): هوية لكل مستخدم، دور/صلاحيات، TTL — هو المرجع الحاسم للتفويض (الأولوية القصوى في `resolveIdentity`).
- **مفتاح API المشترك** (`x-api-key` أو Bearer == API_KEY): ورقة اعتماد **ثابتة مشتركة** تُحلّ إلى دور `device` فقط (fallback).
- `resolveIdentity` (`auth.ts:153-169`): جلسة المستخدم > مفتاح الجهاز.

## 5) خلاصة/قرار
المفتاح القديم لم يعد سوى **جهاز‑scope**، لكن:
- ما زال **حرفياً في الواجهة** (secret في السورس/DevTools) — مخالفة صريحة لمبدأ H1.
- `/api/public-key` لا يسرّب شيئاً لكن كود التهيئة يقرأ `data.apiKey` (ميت).
- التصميم المعتمد: **محل Device Key مخصّص** يتم تزويده عبر مصادقة admin وبلا حرفي في السورس، مع إزالة كل المراجع الحرفية، وإبقاء نطاق `device` محدداً (لا مفتاح master).

**التحويلات لا تُمسّ؛ لا تغيير على منطق الضرائب. الخطوة التالية: التنفيذ (لا يبدأ H3).**
