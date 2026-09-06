# H2-FIX-REPORT — إصلاح المصادقة والصلاحيات على الخادم
**التاريخ:** 2026-08-31
**المرجع:** التصميم المعتمد + `H2-SECURITY-AUDIT.md` (العثور على المشاكل).
**النطاق:** تنفيذ H2 فقط (مصادقة لكل مستخدم + تفويض أدوار + تأمين كلمة المرور + جلسات + اختبارات).
**لم يُنفَّذ بعد:** H1/H3/H5/H6 ومنطق الضرائب — تنتظر موافقتك.
**المبدأ:** أي تغيير هنا على قواعد/مخازن **مؤقتة** للاختبار فقط؛ بيانات الإنتاج لم تُمسّ، وعمل نسخة احتياطية كاملة قبل التعديل.

---

## 1) النموذج الأمني الحالي (قبل الإصلاح)
الخلاصة من التدقيق:
- تسجيل الدخول **عميل فقط** (`LuccaDB.Users.login`) يقرأ IndexedDB المحلية.
- كلمات مرور **نص صريح** (الافتراضي `admin/123456`).
- **لا** مصادقة لكل مستخدم ولا تفويض أدوار على الخادم؛ كل `/api/*` خلف مفتاح API ثابت مشترك (`lucca-secret-key`).
- `GET /api/public-key` يسرّب المفتاح لغير المصادقين.
- البوابة الإدارية (`posAdminAuthed` وفحص الدور) **client-side فقط** — قابلة للتجاوز.
- لا جلسات ولا توكنات.

---

## 2) التصميم المعتمد (نفّذ)
1. **التفويض على الخادم هو المرجع الحاسم:** جلسات مستخدمين (admin/manager/cashier/kitchen) + مفتاح جهاز (نطاق POS محدود). لا تجاوز عبر المفتاح أو localStorage أو إخفاء الواجهة.
2. **تشفير كلمة المرور** بـ Node `crypto.pbkdf2Sync` (PBKDF2‑SHA512، 100000 تكرار، ملح عشوائي UUID) — يطابق صيغة العميل `pbkdf2:<salt>:<hash>`، بلا أي اعتماديات أصلية جديدة (رُفض bcrypt/argon2).
3. **ترحيل انتقالي بلا قفل:** عند تسجيل الدخول، تتحقق من النص القديم (legacy plaintext) أو التجزئة وتُعيد تخزينها مشفّرة شفافاً (`migrateLegacyPassword`)؛ `admin/123456` يبقى يعمل ثم يُفرض تغييرها.
4. **جلسات في الذاكرة** (Server-side in-memory، تُصفّر عند إعادة تشغيل الخادم) مع TTL قابل للضبط `SESSION_TTL_MS` (افتراضي 12h).

---

## 3) التغييرات التي أُجريت

### الخادم
**`backend/src/auth.ts` (جديد)** — وحدة مصادقة:
- `hashPassword`/`verifyPassword` (PBKDF2‑SHA512، 100k تكرار، ملح UUID) + `migrateLegacyPassword` (يرحّل نصّاً صريحاً أو قديماً إلى `pbkdf2:`).
- `sessions` Map مع TTL و `SESSION_SECRET` من البيئة: `createSession`/`getSessionUser`/`destroySession`.
- خريطة `ROLE_PERMISSIONS`:
  | الدور | الصلاحيات |
  |---|---|
  | `admin` | الكل `*` |
  | `manager` | orders/checkout/payments/refunds/customers/categories/products/inventory/purchases/expenses/employees/attendance/shifts/reports/settings/daily-shifts/audit/users.read/sync |
  | `cashier` | orders/checkout/payments/customers/categories.read/products.read/inventory.read/sync |
  | `kitchen` | orders/products/categories.read/sync |
  | `device` | sync/checkout/orders/customers/tables/categories.read/products.read/inventory.read/payments/settings.read/daily-shifts.read |
- `ADMIN_ONLY_STORES = {users, settings, audit_logs, daily_shifts, shifts}`.
- `resolveIdentity` (جلسة Bearer > مفتاح جهاز x-api-key) و `authRequired`/`requireRole`/`requirePermission` (بما فيه بوابة `mustChangePassword` للصلاحيات المميزة) و `getCurrentUser` و `AuthRequest`.

**`backend/src/routes/auth.ts` (جديد)** — نقاط التطبيق:
- `POST /api/auth/login` (معدّل 10/دقيقة، يتحقق + يهاجر + يحفظ + يعيد token/mustChangePassword/مستخدم آمن).
- `POST /api/auth/logout`، `GET /api/auth/me`، `PUT /api/auth/password` (تغيير ذاتي، يرفع mustChangePassword)، `GET /api/auth/verify`.

**`backend/src/db.ts`**:
- `ALTER TABLE users ADD COLUMN mustChangePassword` **قبل** البذر.
- البذر: admin `mustChangePassword=1`، و `UPDATE … SET mustChangePassword=1 WHERE username='admin' AND password='123456'` (أمان للقواعد القائمة).

**`backend/src/index.ts`**:
- تركيب `/api/auth` قبل `apiKeyCheck`.
- `apiKeyCheck` يمرّر `/auth/*` ويحلّ الهوية.
- `GET /api/public-key` لم يعد يسرّب المفتاح → `{configured:true, secure:true}` (العملاء الذين يستخدمون المفتاح الافتراضي يبقون يعملون).
- `requirePermission('checkout')` على `/api/orders/:id/checkout`، و `requirePermission('sync')` + تخطّي مخازن admin (بـ conflictDetail) على `/api/sync`، و `requirePermission('reports.read')` على تقارير الإنفاق.

**`backend/src/routes/crud.ts`**:
- `router.use(authRequired)` على مستوى الموجه.
- `readDenied`/`writeDenied`/`deleteDenied` تُطبَّق على GET/GET:id/POST/PUT/DELETE: الكتابة/الحذف على مخازن admin = admin/manager؛ الحذف = admin/manager.

**`backend/src/routes/special.ts`**:
- authRequired على مستوى الموجه؛ كتابة daily-shifts/settings → adminish (403)؛ قراءة settings → `requireSettingsRead` (admin/manager/device).

**`backend/src/routes/analytics.ts`**:
- إصلاح خطأ: كانت `requirePermission('reports.read')` على مستوى الموجه تُعيق **كل** `/api` لأن الموجه مركّب عند `/api`. أصبحت مُقيّدة بمسار `/dashboard` فقط.

### العميل (إرفاق جلسة حد أدنى لتجنّب قفل واجهة المدير)
**`admin/database.js`**:
- `ServerAPI` أضاف `setToken` و `authHeaders()` (Bearer token إن وُجد، وإلا `x-api-key`).
- `add/put/remove/checkout` صارت ترسل الـ token عبر `authHeaders()`.
- `Users.login` بعد التحقق المحلي يستدعي `/api/auth/login` للحصول على جلسة خادم (غير قاتلة إن تعذّر الوصول → يقع على مفتاح الجهاز للمزامنة فقط).
- `Users.logout` يبطل جلسة الخادم ويمسح الـ token.
- `pushAll`/`pullAll` (المزامنة) ترسل الـ token عبر `authHeaders()`.

**`admin/index.html` و `admin/_script.html`**:
- `apiFetch` (لوحة التقارير/الداشبورد) يرسل الـ token عبر `authHeaders()` إن وُجد (وإلا `x-api-key`)، مع حفاظ على `localDashboardFallback`.

> ملاحظة: `H2-SECURITY-AUDIT.md` وُثّق قبل التعديل (لم يُلمس).

---

## 4) اختبارات (قواعد/مخازن مؤقتة فقط)
`C:\Users\Acer\AppData\Local\Temp\opencode\h2-security.cjs` (40 اختباراً، تولّد الخادم على قاعدة مؤقتة):
- T1 بلا مصادقة → 401.
- T2 تسجيل دخول admin/123456 + هجرة + فرض تغيير؛ T-FC تغيير الكلمة يُفرض قبل العمليات المميزة.
- T7 كلمة المرور مخزّنة `pbkdf2:` لا نصاً؛ T8 الدخول بعد الهجرة؛ T8c mustChangePassword=0 بعد التغيير.
- roles: admin يقرأ التقارير/users؛ cashier/kitchen/device محجوبون عن التقارير/users/settings/الحذف؛ device يبقى يقرأ orders ويومّن checkout (POS لا يُقفل)؛ device لا يضيف admin عبر sync.
- T5 الخادم يقرأ الدور من جلسة معتمدة؛ T5b تعديل العميل لا يمنح صلاحيات.
- T10 logout يبطل الجلسة (401)؛ T-PK public-key لا يسرّب.
- T6d/checkout: معدّل الكتابة (10/دقيقة) قد يعيد 429 — حارس denial‑of‑service لا فشل مصادقة.

`h2-expiry.cjs`: جلسة حيّة 200 → بعد انتهاء TTL 401 (PASS).

**إعادة اختبارات عدم الانحدار (كلها خضراء):**
- C2 `c2-audit2.cjs`: **26/26** PASS.
- C2 `c2-server-smoke.cjs`: **6/6** PASS.
- C2 `c2-tests/run-tests.js` (Safe Sync): **15/15** PASS.
- Build/TypeScript: `tsc --noEmit` خلفية = exit 0.

| المجموعة | النتيجة |
|---|---|
| H2-SECURITY | 40/40 PASS |
| H2-EXPIRY | PASS |
| C2-AUDIT2 | 26/26 PASS |
| C2-SERVER-SMOKE | 6/6 PASS |
| C2-SAFE-SYNC | 15/15 PASS |
| tsc (backend) | exit 0 |

---

## 5) المخاطر المتبقية / الملاحظات
- **الجلسات في الذاكرة:** تُصفّر عند إعادة تشغيل الخادم (يُسجَّل الدخول مجدداً). مقبولة لهذا التطبيق أُحادي العقدة؛ W3 الترحيل إلى Supabase يمكن أن ينقلها إلى مخزن جلسات مستمر/رمز JWT موقّع.
- **المفتاح الافتراضي** `lucca-secret-key` ما زال مرجعاً احتياطياً للعميل وتشغيلاً افتراضياً للخادم في غياب `.env`. النطاق محدود الآن بالجهاز (POS) بفضل التفويض، لكن يُنصح بتعيين `API_KEY` قوي في البيئة (ضمن W1/W4 لاحقاً).
- **الترحيل عبر الجهاز فقط:** إن لم يصل العميل إلى جلسة خادم (سيرفر غير متاح / مستخدم غير مرمّز بعد في سيرفر DB) يعمل نطاق الجهاز للمزامنة فقط ويفشل 403 للعمليات الإدارية محلياً — تحوّل آمن لا قفل.
- فحص `mustChangePassword` يُطبَّق عند الطلب للصلاحيات المميزة؛ صياغة المستخدم الافتراضي `admin/123456` تُجبَر على تغيير الكلمة لرفعها.

---

## 6) ملاحظات الترحيل/النشر
- أي قاعدة موجودة سابقاً ستحصل على عمود `mustChangePassword` تلقائياً مع البذر/الترحيل، وتُعلَّم `admin/123456` على أنها تتطلب تغييراً.
- كلمات مرور legacy تُهاجَر تلقائياً عند أول دخول ناجح لكل مستخدم.
- لا تغيير على منطق الضرائب.

---

## الخطوة التالية
أوقفت العمل عند اكتمال H2 انتظاراً لموافقتك قبل بدء H1. لم أبدأ H1/H3/H5/H6 ولا أي تعديل على منطق الضرائب.
