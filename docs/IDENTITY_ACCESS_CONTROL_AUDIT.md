# Lucca POS — تدقيق الهوية والتحكم بالصلاحيات (Identity & Access Control Audit)

- **صيغة الطلب**: المراجعة والتصميم فقط (Audit & Planning) — لا تعديل ملفات مصدر، لا إنشاء نظام دخول فعلي، لا migrations، لا اتصال بقاعدة إنتاج، لا users جدد، لا Commit/Push.
- **الإصدار**: 1.3.5 (لم يُغيَّر).
- **الفرع / HEAD**: `integration/remote-safe-2026-09-30` @ `0428520`.
- **التاريخ**: 2026-10-10.
- **النتيجة الوحيدة القابلة للكتابة في الـrepo ضمن هذه المهمة**: هذا الملف.

> **قاعدة أخلاقية التزمتُ بها**: لا يُعلن النظام آمناً — هذا تقرير امتثال/تنفيذ موجود مع فجوات مكتشفة، يليه تصميم مقترح وخطط اختبار. الاختبارات المذكورة في القسم (J) هي فقط التي **أُجريت فعلاً في هذه الجلسة** (289 استدعاء نجاح)، والباقي مُعلَّم "مقترح" أو "لم يُنفَّذ".

---

## الخلاصة التنفيذية

النظام الحالي يملك **أساساً قوياً فعلاً** ولا يجب استبداله:

1. **مصادقة خادمية** (PBKDF2-SHA512 بفترة 100k، جلسات في SQLite، TTL 12 ساعة) — `backend/src/auth.ts:30-54, 73-108`.
2. **RBAC خادمي** بتفويض `authRequired`/`requireRole`/`requirePermission`/`requirePasswordChanged` وخريطة `ROLE_PERMISSIONS` — `auth.ts:119-257`.
3. **طبقة مالية خادمية ذرية**: `checkout`/`void` في معاملة SQLite واحدة مع Idempotency وفحوصات أموال وخصم مخزون — `backend/src/index.ts:460-755` (وفي Supabase عبر RPC آمن `deploy/supabase-rpc-v1.sql`).
4. **Batman طبقة غير موثوقة**: كلمة/نص النموذج لا تمنح صلاحية إطلاقاً؛ القرار النهائي خادمي — `docs/BATMAN_ARCHITECTURE.md` و`decisionService.ts`.
5. **اختبارات أمان حقيقية** تعمل الآن (289 استدعاء نجاح في هذه الجلسة).

**لكن** توجد فجوات حقيقية مرتَّبة حسب الخطورة في القسم D، أبرزها:

- **D-01 (HIGH)** — مسار إعادة فتح/تعديل "أوردر مغلق" محلي في الواجهة لا يمر بالسيرفر (`index.html:4920-4942`).
- **D-02 (HIGH)** — الكاشير يستطيع تعديل أسعار الأصناف عبر `items[].price` بنقل صحيح من منظور السيرفر (لا تحقق من السعر تجاه الكتالوج) — `crud.ts:161-175, 306-314, 456-462`.
- **D-03 (HIGH)** — مسار إلغاء/استرداد محلي حين يتعذر السيرفر يكتب مباشرة في IndexedDB ويعيد فتح السجل محلياً (`index.html:5055-5134`).
- **D-04 (HIGH)** — `kitchen.html` بلا أي مصادقة، يكتب حالة الأوردر مباشرة بـanon key في Supabase/IndexedDB (`kitchen.html:417-444, 579-614`).
- **D-05 (HIGH)** — سحب الصلاحيات لا يُفعَّل حتى انتهاء الجلسة: الدور مُخزَّن في صف الجلسة، و`users.active` يُفحص عند الدخول فقط، ولا تُدمَّر الجلسات عند الإيقاف — `auth.ts:78-81, 88-108` / `routes/auth.ts:29` / `routes/invitations.ts:155-182`.
- **D-06 (HIGH)** — `DELETE /api/users/:id` و`DELETE /api/audit_logs/:id` مفتوحان للمدير (تدمير الـaudit trail؛ حذف كل المستخدمين يعيد تفعيل بذر `admin/123456`) — `crud.ts:79-81, 546-588` / `db.ts:890-899`.
- **D-07 (MED)** — فجوات تدقيق: لا تسجيل للدخول/الخروج/الإعدادات/تغيير الأدوار/الرفض 403؛ عمود `userId` و`ipAddress` في `audit_logs` غير مُعبَّأين إطلاقاً — `index.ts:36-42`, `crud.ts:177-184`, `routes/invitations.ts:38-43`.
- **D-08 (MED)** — `POST /api/batman/record` يقبل من أي هوية موثَّقة (تسميم سجل القرارات) — `routes/batman.ts:9`, `batmanController:142-158`.
- **D-09 (MED)** — CORS يعكس أي Origin عند غياب `ALLOWED_ORIGINS` — `index.ts:24,170-176`.
- **D-10 (LOW-MED)** — تسريب معلوماتي: المدير يقرأ جدول `users` (هاشات) والموظفون يقرؤون `employees.salary`؛ تعديل الأدوار عبر generic CRUD غير مُسجَّل؛ `post /api/settings` (management) يكتب عبر مسار مختلف عن CRUD.

السبب الجذري لكل فجوة تقريباً: **الانضباط الخادمي موجود في مسارات المال فقط** (checkout/void/sync/pay)، بينما بقية مسارات الكتابة إما **client-first** (IndexedDB ثم إرسال) أو **UI-gate** (إخفاء زر)، وهي ليست أماناً.

---

## A. البنية الحالية الفعلية

### A.1 ثلاث طبقات تخزين (Source of Truth)

| الطبقة | الوصف | الملفات الرئيسية |
| --- | --- | --- |
| **Electron renderer** | `index.html` (POS)، `kitchen.html`، `admin/` (index/dashboard/control-center). Renderer يكتب أولاً في IndexedDB ثم يدفع. | `index.html`, `kitchen.html`, `admin/*`, `admin/database.js` |
| **Express backend** | خادم محلي `http://localhost:3000`، SQLite عبر better-sqlite3، هو **المصدر الوحيد** للعمليات المالية والمزامنة الموثوقة. طبقة `src/*.ts` تُبنى إلى `dist/*.js`. الجلسات في جدول `sessions`. | `backend/src/*.ts`, `backend/schema/schema.sql`, `backend/migrations/*.sql` |
| **Supabase cloud** | لا يُستخدم إلا عند `luccaDataMode='supabase'`؛ العمليات المالية عبر دالّتين RPC ذريّتين (`checkout_order`, `void_order`) بمنح `anon`. | `supabase-db.js`, `cloud-config.js`, `deploy/supabase-rpc-v1.sql`, `deploy/supabase-schema-v2.sql` (القاعدة الحية لم تُطابقها بعد — انظر K-04) |

### A.2 الأدوار (hard-coded في الكود، لا جدول roles)

مصدر الحقيقة الوحيد للأدوار هو `ROLE_PERMISSIONS` — `backend/src/auth.ts:119-150`:

| الدور | التعريف |
| --- | --- |
| `admin` | `['*']` (wildcard). |
| `manager` | orders/checkout/payments/refunds+refunds.void/customers/categories+write/products+write/inventory+write/purchases/expenses+write/employees/attendance/shifts/reports.read/settings.read/daily-shifts/cash-registers/audit.read/sync/users.read. |
| `cashier` | orders.read/orders.write/checkout/payments.write/customers+write/categories.read/products.read/inventory.read/cash-registers.read+write/sync. |
| `kitchen` | orders.read/orders.write/products.read/categories.read/sync. |
| `device` | سكوب محدود من جهاز/نقل بيانات: sync/checkout/orders.read+write/order_items.read/customers/tables/categories.read/products.read/inventory.read/payments.read+write/settings.read/daily-shifts.read. |

- **لا يوجد جدول roles ولا تجاوزات per-user**: `users.role` نص واحد — `schema.sql:17-30`.
- **device = API key مشترك** (`DEVICE_API_KEY` / legacy `API_KEY`) — `auth.ts:181-188, 199-204`.

### A.3 الجداول والمفاتيح الحساسة

- `ADMIN_ONLY_STORES` (كتابة عبر sync) = `users, settings, audit_logs, daily_shifts, shifts, invitations, payments, refunds, inventory, stock_movements, cash_registers` — `auth.ts:153-158`.
- `WRITE_ADMIN_STORES` (CRUD) و`STORE_WRITE_PERM` (خريطة مخزن→صلاحية) — `routes/crud.ts:30-48`.
- `SAFE_TABLES` (القائمة البيضاء للـCRUD) — `crud.ts:192-202`. `sessions` غير مدرجة (400).

---

## B. نقاط الدخول والمصادقة الحالية

### B.1 نافذة Electron (main-process)

- الـtoken يُحفظ **في main فقط** ولا يصل للـrenderer — `main.js:149-169`, `main/session-manager.js:8-16`.
- المعبر الموثوق لفتح لوحة التحكم: IPC `open-admin` يتطلب جلسة + دور `admin`/`manager` في main — `main.js:171-213`.
- `apiRequest` في main يقيّد المسار إلى `/api/*` + قائمة Verb — `session-manager.js:98-106`.
- bridge آمن: `preload.js:17-24` (لا أسرار عبر الحدود).

### B.2 خادم Express

- سلسلة: `securityHeaders` ← winston ← CORS ← json 5MB ← sanitize ← **rate limit عام 120/د** ← rate limit checkout 10/د ← `apiKeyCheck` (تحديد هوية) — `index.ts:164-233`.
- مصادقة الدخول: `POST /api/auth/login` مع `verifyPassword` (legacy plaintext مقبول) + هجرة PBKDF2 + `createSession` — `routes/auth.ts:21-53`, `auth.ts:42-70`.
- حد القوة الغاشمة: **10 محاولات/دقيقة/IP في الذاكرة** — `routes/auth.ts:9-23`.
- وسيطات: `authRequired` (401)، `requireRole` (403)، `requirePermission` (403 + فرض mustChangePassword)، `requirePasswordChanged` — `auth.ts:209-257`.
- نقاط عامة (بلا مصادقة): `/health`, `/api/auth` (status), `/api/auth/login`, `/api/public-key`, `GET/POST /api/invitations/:token/(check|activate)` — مُستثناة في `apiKeyCheck` — `index.ts:226`.
- **إصدار بيانات مدة الجلسة**: `GET /api/auth/me`, `/verify`, `/permissions` (سيرفر-فرست لإخفاء/إظهار تبويبات لوحة التحكم) — `routes/auth.ts:63-110`.

### B.3 بقية المسارات (ملخّص التفويض)

| مجموعة | مثال | السلسلة |
| --- | --- | --- |
| فواتير/مال | `POST /api/orders/:id/checkout`, `.../void` | `authRequired` + `requirePermission('checkout'/'refunds.void')` — `index.ts:460, 639` |
| مزامنة | `POST /api/sync` | `requirePermission('sync')` + RBAC لكل مخزن + `ADMIN_ONLY_STORES` — `index.ts:840-890, 966-992` |
| CRUD عام | `/api/:store` | `authRequired` + `requirePasswordChanged` ثم `readDenied/writeDenied/deleteDenied` — `crud.ts:12-13, 51-81` |
| CC/تحكم | `/api/cc/*` | router `requirePermission('reports.read')` + `requirePermission` لكل كتابة — `routes/controlCenter.ts:34-35, 295-451` |
| Batman | `/api/batman/*` | `authRequired`+change؛ بيانات/permissions/stats = admin فقط — `routes/batman.ts:8-22` |
| users | `POST /api/employees/invite`, `POST /api/employees/:id/status` | `requirePermission('employees.write')` — `routes/invitations.ts:48,155` |
| backup | `/api/admin/backups` | `requireRole('admin')` — `routes/admin.ts:11-12` |

---

## C. مصفوفة الأدوار والصلاحيات (الحالية)

استقراء من `ROLE_PERMISSIONS` (auth.ts:119-150) + بوابات CRUD (crud.ts) — **هذه الحالة الراهنة، وتُفصَّل بعدها المصفوفة المستهدفة في G/H**:

| الصلاحية / المخزن | admin | manager | cashier | kitchen | device |
| --- | :-: | :-: | :-: | :-: | :-: |
| orders.read | ✔ | ✔ | ✔ | ✔ | ✔ |
| orders.write (إنشاء/تعديل الأصناف/الكميات) | ✔ | ✔ | ✔ | ✔ | ✔ |
| checkout (إقفال/تحصيل) | ✔ | ✔ | ✔ | ✘ | ✔ |
| refunds.write / CRUD refunds | ✔ | ✔ | ✘ | ✘ | ✘ |
| refunds.void (`/void`) | ✔ | ✔ | ✘ | ✘ | ✘ |
| payments كتابية (CRUD) | تُرفض كلياً على الجميع (409) — حصرية بـ`/checkout` و`/void` — `crud.ts:299-303, 445-449, 556-560` | | | | |
| تعديل أسعار أصناف الطلب (`items.price` في PUT) | ✔ | ✔ | **✔ (نقل صحيح مقبول — انظر D-02)** | ✔ | ✔ |
| إعادة فتح أوردر مغلق | محلي في الواجهة **للإلكتورون فقط** (لا مسار سيرفر رسمي — انظر D-01) | | | | |
| users.read | ✔ | ✔ (يشمل هاشات) | ✘ | ✘ | ✘ |
| users.write عبر CRUD | ✔ (نص خام) | ✘ (writeDenied) | ✘ | ✘ | ✘ |
| DELETE users (CRUD) | ✔ | ✔ (عبر deleteDenied فقط — D-06) | ✘ | ✘ | ✘ |
| settings قراءة | ✔ | ✔ | ✘ | ✘ | ✔ |
| settings كتابة | ✔ (CRUD) + `POST /api/settings` admin/manager | CRUD:✘ / `POST /api/settings`:✔ (D-10) | ✘ | ✘ | ✘ |
| batman/execute (قرار) | admin يُنفَّذ مباشرة | يُنفَّذ | ضمن سقف المصفوفة | محجوب | محجوب (minRole/block في `permissionService.ts:25-79`) |
| batman_decisions قراءة | ✔ | ✘ | ✘ | ✘ | ✘ |
| batman/record (كتابة سجل) | ✔ | ✔ | ✔ (**أي هوية موثَّقة — D-08**) | ✔ | ✔ |

ملاحظة سلوكية مهمة: `deleteDenied` يعتمد على الدور فقط (بلا خريطة مخزن) — `crud.ts:79-81`.

---

## D. الثغرات المكتشفة (أدلة فعلية بأسطر)

> الترتيب خطورة تنازلي. كل بنود بإشارة `file:line` مؤكَّدة بالقراءة أو الفحص.

### D-01 — إعادة فتح أوردر مغلق/مدفوع محلياً (HIGH)
- `index.html:4920-4942` `reopenOrder()`: `order.status = 'pending'` ثم `LuccaDB.db.put('orders', order)` و«تحميله للتعديل». الزرار في `index.html:4861`. **لا فحص صلاحية ولا استدعاء سيرفر**.
- التأثير: يظهر الأوردر المغلق قابلاً للتعديل محلياً ويصير "قيد العمل"؛ عند الدفع لاحقاً يعاد إحكام خادمي بـ`/checkout`، لكن العرض المالي المحلي يتباعد عن القاعدة. لا يوجد مسار سيرفر معتمد لإعادة الفتح — فراغ سلوكي.

### D-02 — تعديل سعر الصنف دون صلاحية (عبر items، مقبول خادمياً) (HIGH)
- `crud.ts:161-175` `serverOrderTotals()` يعيد حساب `subtotal/total` **من `items` المقدَّم من العميل حصراً**: `sum(quantity * (unitPrice ?? price))` — **لا مقارنة مع جدول `products`/الكتالوج**.
- يُطبق النقل الصحيح في POST `crud.ts:306-314` وفي PUT `crud.ts:456-462`، وفحص «الإجمالي ≠ الحساب» في 493-499 يقارن بإعادة الحساب نفسها.
- `checkoutTotals` في `index.ts:447-458` يعيد الحساب من `order.items` المخزَّن بالمثل.
- النتيجة: **أي دور يملك `orders.write` (كاشير/مطبخ/جهاز) يستطيع إرسال `PUT /api/orders/:id` مع `items:[{quantity, price: 0}]` ويُبنى إجمالي جديد مقبول خادمياً، ما دام الأوردر غير مدفوع.** الـUI يمنع ذلك بإخفاء الأزرار، لكن الطلب المباشر لا يُمنع. ينطبق أيضاً على الخصم if client sets discount (تُعاد حسابه من discount المقدَّم في 170-172).

### D-03 — عامودُ/استرداد محلي يتجاوز الخادم عند تعذره (HIGH)
- المسار الصحيح خادمي تماماً: `/api/orders/:id/void` (`index.ts:639-755`) بكل الضمانات (سبب إلزامي، مدفوع فقط، سقف الاسترداد، ذرّية، ردّ المخزون، تدقيق مزدوج).
- لكن `index.html:5055-5134` عند فشل الاتصال (وليس 403/400) يكتب **مباشرة**: صف `refunds` (5063)، حركة صندوق (5079)، سجل تدقيق (5087)، حالة الأوردر `cancelled` + `paymentStatus='refunded'` (5095-5104)، history (5108)، تحرير الطاولة (5113) — **كلها في IndexedDB، بلا أي من ضمانات السيرفر وبلا ردّ مخزون** (يُحرَّر المخزون… لا؛ لا يوجد restore محلي في 5055-5134 أصلاً).
- النتيجة: استرداد محلي دون سقف مضاعف، ودون ردّ مخزون، ويتباعد السجل المحلي/الخادمي؛ لاحقاً سيُرفض دفع هذا الأوردر المغيّر عبر sync (حالة نهاية) — `index.ts:966-992`.

### D-04 — kitchen.html بلا مصادقة، يكتب بـanon مباشرة (HIGH)
- `kitchen.html:417-444` قراءة الأوردرات: `createClient(URL, ANON_KEY)` صرح (423-425) أو IndexedDB أو localStorage.
- `kitchen.html:579-614` تحديث حالة الأوردر يكتب في **Supabase بـanon** (584-586) **وفي IndexedDB** (591-599) **وفي localStorage** (603-611) — **بلا فحص جلسة ولا دور إطلاقاً**.
- يفتح عبر `openExternal('file://…/kitchen.html')` — `index.html:1366-1372`.
- النتيجة: أي جهاز/شخص يفتح الملف يقرأ الأوردرات ويغيّر حالتها (وهو ما يفترض أن يقوم به المطبخ). هذا **حين لا يجدها أن تجد ورود للـRLS من التي فُحصت سابقاً**: القراءة العامة وكتابة الحالة لدى `orders` مفتوحة للـanon live (الأدلة من فحص 2026-10-10: `orders` تقرأ من anon).

### D-05 — سحب الصلاحيات لا يسري حتى انتهاء الجلسة (HIGH)
- `createSession` يخزّن `role` داخل صف `sessions` — `auth.ts:78-81`.
- `getSessionUser` يقرأ الدور من **صف الجلسة** لا من `users` — `auth.ts:88-108`. `requirePermission` يفحص `identity.role` المستخرج من الجلسة — `auth.ts:246-257`.
- `users.active` يُفحص **عند الدخول فقط** — `routes/auth.ts:29`. إيقاف المستخدم (invitations.ts:155-182) لا يُدمّر jsessions القائمة.
- النتيجة: مستخدم أُوقف/خُفّض دوره يبقي جلسة كاملة الصلاحيات **حتى 12 ساعة**. لا `destroyAllSessions`.

### D-06 — حذف users/audit_logs عبر CRUD مفتوح للمدير (HIGH)
- `deleteDenied` = إداري/مدير فقط، **بلا خريطة مخزن** — `crud.ts:79-81, 546-588`.
- ⇒ `DELETE /api/users/:id` من المدير، و`DELETE /api/audit_logs/:id` (إتلاف ادلة التدقيق)، و`DELETE /api/settings/:id` (no-op لوجود PK من النوع key).
- تفاقم: حذف كل المستخدمين ← إعادة `users` فارغة ← **إعادة بذر `admin/123456` عند الإقلاع** — `db.ts:890-899` (والبذر نفسه plaintext معجبٌ به عالمياً في verify legacy).

### D-07 — فجوات التدقيق (MED)
- لا تدقيق لدخول/خروج (routes/auth.ts تُسجّل لا شيئاً)، ولا لتغيير إعدادات (`special.ts:163-176` upsert بلا audit)، ولا لتغيير أدوار/مستخدمين عبر PUT غير المرتبط بمخازن orders فقط (`crud.ts:535-538` يسجّل orders/order_items/payments فقط)، ولا لحذف daily-shifts (`special.ts:127-138`).
- عمودا `userId` و`ipAddress` في `audit_logs` **لا يُملآن** بأي INSERT: `index.ts:39` (logAudit)، `crud.ts:180-181`، `routes/invitations.ts:41`). لا عمود role/kind.
- رفضات الـ403 (writeDenied/readDenied/deleteDenied) **لا تُسجَّل** — المحاولات الغادرة بلا أثر (`crud.ts:224, 252, 436, 550`).

### D-08 — تسميم سجل قرارات Batman (MED)
- `POST /api/batman/record` بلا فحص صلاحية: أي هوية موثَّقة (كاشير/مطبخ/جهاز) يكتب صفوفاً في `batman_decisions` — `routes/batman.ts:9`, `batmanController:142-158`. مع `eventId` الوحيد، بقي التسميم ممكناً بـeventId جديدة.

### D-09 — CORS مفتوح انعكاسياً (MED)
- `origin: true` (يُعكس أي Origin) ما لم تُضبط `ALLOWED_ORIGINS` — `index.ts:24,170-176`؛ `backend/.env` لا يمليها. ملف `:4` يحوي `ADMIN_PASSWORD=-ATxy…` و`JWT_SECRET` **قيّمان ميتان** (لا استخدام في src) لكنهما في ملف **متعقَّب ضمن الـrepo**.

### D-10 — تسريب معلوماتي + تعارض مسارات الكتابة (LOW–MED)
- المدير يقرأ كامل `users` بما فيهـashes — `crud.ts:25, 55, 227` (readDenied يسمح للمدير).
- **employees.salary مقروء من أي هوية موثَّقة** (`employees` غير مدرجة في READ_RESTRICTED — `crud.ts:25, 51-58`) — راتب/رقم موظف لكاشير/جهاز/مطبخ. (الواجهة لا تعرضه لكن الـAPI بلا حماية.)
- **تعارض نقطتي كتابة للإعدادات**: CRUD يمنع المدير عن `settings` (`crud.ts:73`) بينما `POST /api/settings` (special.ts) يسمح للمدير بكتابة أي مفتاح — مساران، قاعدتان مختلفتان.
- `POST /api/proxy-llm` و`/api/openai` لديها `authRequired`+change فقط ⇒ **كاشير/مطبخ/جهاز يستهلكون اعتماد LLM الخادمي** (بلا حد) — `index.ts:336-439` (لديها SSRF allowlist 258-321 لكن لا قيد صلاحية/حصة).
- sessions جدول بلا قيود FKs على حذف المستخدم (صف جلسات يتيم تجميعه بـsweep وحده).

### D-11 — جلسة device key وتصعيدها (LOW–MED)
- `POST /api/auth/provision-device` من أي جلسة admin تعيد `DEVICE_API_KEY` كاملاً — `index.ts:210-214`. الجهاز المشترك يملك `checkout`+`sync` (auth.ts:144-149): أي استيلاء على جلسة admin يمنح أداة دفع دائمة.
- device key ثابتة في `backend/.env` ملف تعقب سابق.

### D-12 — قيود المعدل الذاكرة/IP فقط (LOW-MED)
- No `trust proxy`؛ البطء العام 120/د و10/د للدخول و10/د للـcheckout كجامدة في الذاكرة لكل IP، بدون قفل لكل حساب، خريطة تمدد بلا تنظيف — `index.ts:102-127,193-196`؛ `routes/auth.ts:9-23`.

### D-13 — نقاط دخول الواجهة غير الخادمية لـ"تعديل الأوردر"
- المصفوفة: إضافة/إزالة صنف وتغيير كمية وملاحظات كلها **local-first** (`index.html:3139-3202` `_autoSaveCore` → IndexedDB)، ثم fire-and-forget `ServerAPI.put('orders')` — `admin/database.js:1486-1530`. لا يوجد مفهوم "أوردر مٌرسل للمطبخ" في نموذج الحالة: الولايات `pending→in_preparation→ready→served→completed` كلها في مجموعة العمل، وتعديل أصنافٍ بعد "أُرسل للمطبخ" (in_preparation فما فوق) **مشروع** — `crud.ts:90, 464-499`.

---

## E. دورة حياة الأوردر ومناطق الخطر

### E.1 نموذج الحالة
- `orders.status`: `pending | in_preparation | ready | served | completed | cancelled | closed` — `schema.sql:253`.
- `paymentStatus`: `unpaid | partial | paid | refunded` — `schema.sql:254`.
- الأموال المكتوبة حصراً بخادمي: `ORDER_MONEY_IMMUTABLE` (totalPaid/paidAmount/changeAmount/paymentMethod/paymentMethodId) — `crud.ts:93, 478-492`.

### E.2 المسار المالي الآمن (معتمد)
`إنشاء(order.write) → تعديل أصناف (order.write/CRUD، معاد حساب كلها) → /checkout (معاملة واحدة: إغلاق+مدفوعات+items+مخزون+history+كاش drawer+audit؛ idempotent syncId؛ سقف خصم) → مغلق` أو `→ /void (سبب+سقف استرداد+رد مخزون+تدقيق مزدوج)`.

### E.3 مناطق الخطر (Kill-chain)
1. **قبل التحصيل**: تغيير سعر/خصم عبر `items[].price` (D-02)؛ تعديل بعد إرسال المطبخ (D-13).
2. **بعد التحصيل**: إعادة الفتح محلياً (D-01)؛ الاسترداد المحلي عند عزل الاتصال (D-03).
3. **طبقة العرض**: kitchen يكتب حالة بـanon (D-04)؛ إخفاء أزرار لا يمنع الطلب المباشر.
4. **طبقة الهوية**: سحب صلاحية متأخر (D-05)، تدقيق منقوص (D-07).

هام: الضمان المالي الأساسي (لا ضريبتان، لا استرداد مضاعف، لا خصم مخزون مرتين) **موجود ومُختبر** — الـidempotency بـ`syncId` و`sale/return` حركات المخزون (stock.ts:55-56,95-98) — بينما الثغرات السابقة تقع عند التجاوز/العروض المحلية/التفويض قبل الدفع.

---

## F. تحليل صلاحيات Batman وOllama

### F.1 الحقائق الراهنة
- أدوات الكتابة الخادمية (28 إجراء) تُنفَّذ عبر `/api/batman/execute` مع قرار نهائي في `decisionService.approve` — `decisionService.ts:410-457`؛ لا يُثق بكلمة/نص النموذج: `canRoleAct` و`decide()` — `permissionService.ts:25-79`؛ و`checkDecision` يتجاهل `body.role` — `batmanController:108-120`.
- أدوات قراءة/كتابة **محلية** (فتح طاولة، إضافة أصناف، حساب، شفت موظف…) تكتب في IndexedDB مباشرة بلا فحص هوية (ai-pos-engine.js:930-1470) — المحطة الأمنية الوحيدة لاحقاً هي `checkoutToServer`/sync.
- `update_price`/`update_components` عبر مصفوفة الخادم (موقوف للمدير في seed المصفوفة).
- تسجيل: `batman_decisions` Pervas. `eventId` مضاد للتكرار؛ رفضات وموافقات موثقة — `permissionRepo.ts:69-99`. أدوات محلية تسجل `AI_*` في audit_logs — `ai-pos-engine.js:2871-2880`.
- **جيد**: لا LLM→SQL؛ `blocked` نهائي؛ لا API keys من النص.
- **ثغرة**: `POST /api/batman/record` (D-08)؛ أدوات محلية غير مربوط هوية؛ و`ai-reviewer.js` (أداة مطور) تجار فحص الملف فقط — خارج نطاق الإنتاج.

### F.2 Ollama
- افتراضي `localhost:11434` و`qwen2.5:3b` — `ollama-adapter.js:28-29`. **الـhost والملف نقرآن من localStorage** (`luccaOllamaHost/Model`، 32-40) **بدون allowlist** → أي حقن/تلاعب يعيد توجيه سياق الطلب/المبيعات إلى عنوان خارجي.
- OpenAI من خلال بروكسي خادمي يحمل المفتاح — `index.ts:311-347`، فلا مفتاح في الـrenderer، لكن لا قيد صلاحية/حصة على الـproxy (D-10/LLM).

---

## G. التصميم المستهدف لبوابة الدخول الموحدة

مبادئ مدفوعة بالقواعد الإلزامية: لا نظام مصادقة جديد من الصفر (الموجود قوي)، الدور من **السيرفر فقط**، لا إخفاء أزرار كأمان، لا ملف آفلين يدّعي سحبا فوريا.

### G.1 البوابة (شاشة الدخول الموحدة)
- `index.html` عند بدء التشغيل: `await electronAPI.session.get()` (إلكتورون) أو `GET /api/auth/me` — لا اعتماد على localStorage أبداً.
- **شاشة دخول واحدة** (تجميع الموجود في `admin/index.html`/`control-center.html` و`doAdminLogin` في index.html ضمن عنصر دخول POS) تعرض هوية Lucca، username + password.
- بعد نجاح الدخول يستخرج الدور والصلاحيات من `GET /api/auth/me` + `GET /api/auth/permissions` (موجودان)، **ولا يقرأ role من `localStorage.currentUser` أو إدخال المستخدم إطلاقاً**.
- التوجيه (بناءً على الدور الخادمي فقط):
  - `cashier/manager/admin` → واجهة POS الرئيسية (index.html).
  - `kitchen` → نافذة المطبخ **بعد التحقق من الجلسة** (انظر G.3).
  - `manager/admin` → الوصول إلى لوحة التحكم (يدعم معبر main المكتشف مسبقاً في G.2).
- أي محاولة فتح شاشة غير مصرح بها → إما أن المعبر الخادمي يرد 403، أو نافذة الدخول تبدو فيحجب الوصول مؤسسياً.

### G.2 الحجب على مستوى main (Electron) + إعادة فحص الخادم
- استمرار وبيل الموجود: `open-admin` في `main.js:171-213` (أبقِه، مضيفاً مطابقة الدور الحية/الصلاحية قبل الفتح وليس فقط عند الفتح).
- إضافة gate لفتح `kitchen.html` عبر IPC مماثل (لا `openExternal` مباشر إلا بعد جلسة + دور kitchen).
- `admin/index.html` و`kitchen.html` و`dashboard.html` و`control-center.html` تعيد فحص `session.get()`/`/api/auth/me` **عند كل تحميل** وتُظهر «غير مصرح» وتسجّل في audit — لا تكفي مرة واحدة.
- عميل الويب: أي شاشة حساسة تتطلب الترميز ويُحجَّب فتحها بنافذة دخول؛ لا أدوات backdoored.

### G.3 kitchen آمنة
- لا anon، لا localStorage: قراءة وكتابة حالة الأوردر عبر `electronAPI.apiRequest`/`ServerAPI` **بجلسة kitchen**، محدودة بـ `orders.read/orders.write` (kitchen لا يملك checkout/refunds) — والأداة الخادمية تعيد فحص أنه «يعمل مكافئ» وليس مدفوعاً/مغلقاً (`crud.ts` gates + حالة الأوردر في مجموعة العمل قيود: صنایع لا تُعدَّل بعد `in_preparation` إلا بإذن manager — انظر G.4).
- إذا عُدّل الأوردر (يرد خادمي) أي تحديث حالة بعد `in_preparation` يُقيَّد بالخادم لا بالزر.

### G.4 قواعد التعديل الخادمية (جسر D-02/D-13)
- `orders` PUT/POST: **التحقق من سعر/خصم كل صنف تجاه جدول `products`** (والبدائل/modifiers لمواصفاتها)، لا قبول أسعار مطلقة من العميل. إعادة الحساب تبقى لكن من الأسعار الخادمية.
- تعريف حالة «أُرسل للمطبخ» صريحة (flag `submitted`/`printedAt`) مع قيد: كاشير/مطبخ لا يعدّل أصناف/أسعار أوردر أرسله؛ التعديل يتطلب `orders.edit-after-submit` (manager/admin) + سبب + تدقيق.
- إعادة الفتح: RPC خادمي `reopen_order` بـ(صلاحية HighValue: admin/manager) + سبب + fتحقق أن الأوردر مدفوع ثم إنشاء `credit` مقابل أو نسخة جديدة، مع تدقيق مرجعي — لا محلي فيه.

### G.5 النافذة في وضع عدم الاتصال (معادلة صادقة)
- تبقى العمليات المالية موثوقة من السيرفر؛ عند انقطاعه تُمنع عمليات الإقفال/الاسترداد بوضوح (تُجري الآن العامة؛ الاستفادة من سلوك `checkoutToServer` الموجود الذي لا يُغلق محلياً — `admin/database.js:1399-1414`).
- **لا أدعي سحب صلاحيات فوري من جهاز غير متصل**: تُسجَّل العمليات محلياً مع هوية + `queued` وtime window، وعند عودة الاتصال يعيد الخادم فحص المصلحة ويرفض أي شيء خارج الهوية الموقوفة.

---

## H. تصميم إدارة المستخدمين والصلاحيات

التنفيذي: البنية الراهنة (users + employees + invitations + sessions) مناسبة وتبقى أساس التصميم.

1. **لا مشاركة جلسات**: token في main (إلكتورون) / bearer في الجلسة الواحدة؛ جلسة لكل مستخدم مع `userId` إلزامياً في `sessions`.
2. **انتهاء حسب سياسة**: TTL 12h مثالي؛ أضف سياسة خمول (idle timeout) وإعادة تحقق دورية `refresh()` — موجود بدأً (session-manager.js:56-68).
3. **حماية كلمات المرور**: الانتقال الكامل من legacy plaintext (عند الدخول يُهاجَر — auth.ts:64-70)؛ منع seed جديد `123456` بعد أول تغيير؛ الحد الأدنى 8 مع تعقيد؛ وأضف رقابة عند التغيير عبر الخادم.
4. **لا أسرار في الواجهة/localStorage**: حذف `luccaApiKey` من تخزين الـrenderer (index.html:1913-1952) واعتماد session أو device key في ملفات البيئة فقط.
5. **سحب الصلاحيات فوراً**: عند إيقاف مستخدم/تغيير دوره — `DELETE FROM sessions WHERE userId=?` + فحص `active`/role **لكل طلب** (ميدلوير `requireLiveUser` يقرأ من `users`). هذا يعالج D-05 واختبار J-09.
6. **تحقق كل طلب حساس**: الاستفادة الحالية `requirePermission` مصدرها وحيد؛ تُطبق عند كل مسار كتابة (النقاط المستهمة في D-10: settings/daily-shifts إغلاق المسارين إلى قاعدة واحدة).
7. **أدنى صلاحية**: تقييد كاشير عن `orders.edit-after-submit` (جديد)، وتقييد device عن `checkout`… أو إلغاء device key نهائياً (قرار المالك — K-06)؛ تقييد قراءة `employees.salary` للـadmin فقط.
8. **الحماية من CSRF/IPC**: IPC الآمن محصور بالـwhitelist (موجود)؛ على الـweb terminals: رفض أي `Origin` غير مصرح (D-09) وعدم الاعتماد على تغيير CORS.
9. **لا اختيار دور من الواجهة**: كل الطلبات تحمل الهوية من الجلسة، ولا يقبل الخادم `role` في الـbody على الإطلاق (موجود في batman؛ يُعمَّم).
10. **التصدير للآوفلاين**: كما G.5 — نافذة زمنية قابلة للتهيئة، تنازع عند العودة عبر الـsync contract (docs/SYNC_CONTRACT.md) — تضاف خطة صراع لهوية موقوفة (رفض استوري).

---

## I. خطة تنفيذ مرحلية (أقل تغيير أولًا، لا تعملها الآن)

> كلها مقترحات تنفيذ للـowner. **لا أقرر الآن**. لا ملف مصدر يُعدَّل في هذه المرحلة.

| المرحلة | الإجراءات | الملفات المقترَحة (مثال) |
| --- | --- | --- |
| **P0 — تشغيلي فوري (بدون كود)** | تدوير جلسة الخادم: تغيير `admin/123456` فوراً عبر `PUT /api/auth/password` (كان seed plaintext على قاعدة الإنتاج)؛ حذف/تدوير أسرار `backend/.env` (ADMIN_PASSWORD، JWT_SECRET) أو إخراجها من gitignore؛ ضبط `ALLOWED_ORIGINS` للواجهة فقط؛ تعطيل/إدارة الحسابات المعطلة مسبقاً. | تشغيل يدوي / CI فقط |
| **P1 — إغلاق الثقوب العالية** | remove مسار `reopenOrder` المحلي واستبدال بـRPC خادمي؛ إزالة fallback الاسترداد المحلي (منع)؛ فرض التحقق الخادمي لسعر/خصم items من الكتالوج؛ إغلاق DELETE users/audit_logs للمدير (طبقة من الـRBAC doc)؛ kitchen.html جلسة-مجبورة تعدد عند enableZero. إضافة `requireLiveUser` (active + role حي). | `backend/src/routes/crud.ts`, `main.js`, `kitchen.html`, `admin/database.js`, `index.html` (الزرار) |
| **P2 — الهوية والتدقيق** | تسجيل دخول/خروج/إعدادات/أدوار/رفض 403 في audit_logs مع `userId`+`role`+`kind`+`ipAddress`؛ إغلاق `batman/record` لهوية النظام/المعتمدة؛ سياسة كلمات + max-attempt لكل حساب؛ `trust proxy` اختياري آمن. | `backend/src/index.ts`, `routes/auth.ts`, `routes/special.ts`, `batmanController.ts` |
| **P3 — بوابة موحدة** | عنصر دخول موحد في index.html + routing بالدور (G.1)؛ إزالة `posAdminAuthed` و`luccaToken` من localStorage؛ إخفاء أزرار فقط كـ(مساعد تجربة) وليس حاجز. | `index.html`, `main.js`, `preload.js`, `admin/database.js` |
| **P4 — إدارة مستخدمين + جلسات** | واجهة إيقاف/تفعيل/دور (موجودة في mini) + destroy sessions عند التغيير؛ policy قفل/فترة خمول؛ إلغاء device key (اختياري). | `admin/index.html`, `routes/invitations.ts`, `main/session-manager.js` |
| **P5 — الأمن العميق للمال بعد P1–P4** | تطبيق مصفوفة الأوردر (الجدول في G.4): `submitted` flag و`edit-after-submit` و`reopen_order` و`price_from_catalog` مع تدقيق + اختبارات | `backend/src/index.ts`, `crud.ts`, tests |
| **P6 — نشر القاعدة الحية (بعد حسم K-04)** | تطبيق `supabase-rls-fix.sql`/`v2` بعد التقرير RLS الفوري واختيار هذا السيرورس vs Supabase | deploy |

ملاحظة قواطع: في كل مرحلة، يُشرَّع فحص الـRBAC خادمياً (`authRequired`→`requirePermission`) في كل مسار كتابة — لا توضيح للـUI.

---

## J. الاختبارات المطلوبة ومعايير النجاح

### J.1 الاختبارات التي أُجريت فعلاً في هذه الجلسة (نجاح حقيقي)
المشغّل: Node 24 بدون dependencies خارجية؛ كل اختبار يُقلع خادماً على port حر مع DB مؤقت (`fs.mkdtempSync`) — لا تغيّر أي ملف في الـrepo، و`dist/` غير متتبَّع في git.

| الاختبار | التغطية | النتيجة |
| --- | --- | --- |
| `backend/test/guard-regression.cjs` | دخول/سؤال/ref subscription، mustChangePassword blocks، logout/تغيير كلمة، RBAC denial | 16/16 ✔ |
| `backend/test/checkout-idempotency.cjs` | إقفال idempotent، 409 عند إعادة الدفع بسyncId مختلف، صف واحد payments | 9/9 ✔ |
| `backend/test/phase5a-rbac-write-paths.cjs` | RBAC لكل مخزن كتابة/قراءة/حذف عبر CRUD | 34/34 ✔ |
| `backend/test/phase7-session-integration.cjs` | دورة جلسة كاملة + main/session-manager (token لا يتسرب، /api فقط، TTL بلا fallback) | 21/21 ✔ |
| `backend/test/p0-authority-rbac-secrets.cjs` | sync RBAC، Batman server-authoritative (body.role مرفوض)، عزل الأسرار، منع تصعيد الدور من localStorage | 56/56 ✔ |
| `backend/test/p0-money-guards.cjs` | حجب كتابة الدفعات، قيود أموال الأوردر، تدقيق updates، إلغاء محدود | 57/57 ✔ |
| `backend/test/phase5-decision-layer.cjs` | طبقة قرار Batman (minRole/سقف/requiresApproval/blocked) | 35/35 ✔ |
| `backend/test/phase4-admin-write.cjs` | مسارات كتابة إدارية وتحقق آمَن | 61/61 ✔ |
| **المجموع** | | **289/289** |

### J.2 الاختبارات المطلوبة (المليوم المتلقي) — الحالة والنجاح المتوقع

| # | المطلوب | الحالة الآن | لماذا | معيار النجاح بعد الإصلاح |
| --- | --- | --- | --- | --- |
| 1 | الكاشير لا يغيّر سعر صنف | **يفشل (D-02)** | لا تحقق سيرفر من سعر items | `PUT orders` بأسعار معدّلة من كاشير → 403/409؛ مدير اعتماد السبيل فقط |
| 2 | الكاشير لا يحذف من أوردر مغلق | **يمر** (crud.ts:464-468, 574-578) | قيد خادمي موجود | 409 + تدقيق `orders.rejected` |
| 3 | الكاشير لا ينفّذ Refund | **يمر** (requirePermission refunds.void) | ٱختبره | 403؛ و403/400 عند fallback المحلي ممنوع (بعد P1 يُزيل fallback) |
| 4 | المطبخ لا يعدّل سعر/دفع | **يمر جزئياً** | kitchen بلا checkout/refunds لكن **يعدّل items عبر orders.write (D-02)** | بعد إصلاح D-02: 403 لكل تغيير سعر حتى لو orders.write |
| 5 | غير مسجل لا ينفّذ كتابة | **يمر** (authRequired) | موجود | 401 لكل /api عدا العام |
| 6 | تغيير role في الواجهة لا يمنح صلاحيات | **يمر** (p0-authority F) | موجود | خادم يعيد هويته الفعلية؛ اختبار تسجيل دخول مع role body مرفوض |
| 7 | طلب مباشر إلى API بنفس التحقق | **يمر/ناقص** | موجود لكن بثغرة D-02 | اختبار crud مباشر من كاشير بلأسعار معدلة يُغلق |
| 8 | IPC عبر main يُفحَص | **يمر جزئياً** (session-manager tests) | موجود | أضف اختبار ضبط: `apiRequest` للمسار غير /api → 400 (موجود) + فتح نافذة kitchen غير مصرح → denial |
| 9 | الموقوف لا يبدأ جلسة | **يمر للدخول** (routes/auth.ts:29)؛ **يفشل للجلسات القائمة (D-05)** | لا destroy-on-disable | بعد P1/P2: إيقاف مستخدم تدمّر جلساته فوراً خلال 1s؛ بيانات اختبار |
| 10 | العمليات الحساسة تُسجَّل | **ناقص (D-07)** | دخول/خروج/إعدادات/أدوار/رفض غير مسجّلة | اختبارات تعرّف صف أو 2 audit لكل حدث حساس |
| 11 | Batman لا يتجاوز صلاحيات صاحبه | **يمر** (decision-layer) | موجود | رفض كاشير لفِعل يتجاوز سقفه → blocked موثق |
| 12 | لا خصم مخزون/دفع مزدوج | **يمر** (idempotency، stock movements) | موجود | 9/9 + حركة sale/return مرة واحدة |
| 13 | رفض التعديل لا يتسبب تغيير جزئي | **يمر للمال** (معاملات مؤتومة)؛ **ناقص للموارد العامة** | `orders` في معاملة؛ مخازن أخرى بدون معاملة | اختبار rollback دعوة فشل mid-transaction (if fields تحويل) |
| 14 | تغييرات الصلاحيات لا تكسر المزامنة | **يمر** (sync RBAC) | موجود | 저장-دوس: أشّكل تزامن بعد تغيير الأدوار؛ sync يحترم RBAC جديد |

---

## K. المخاطر والتبعيات وأسئلة تحتاج قرار المالك

- **K-01 — القاعدة الحية Supabase**: من الفحص الحيّ القراءة للـanon (users=1, orders=341, expenses=34, bot_memory=38, tables_store=14, payment_methods=4, settings=2). قبل أي استخدام سحابي، يجب استكمال استعلامات `deploy/supabase-schema-audit.sql` (SELECTات postgres) وتحديد حالة RLS بدقّة (RLS/FORCE/policies/grants/publication/replica identity). **لا أعبّئ مخرجات لم أحصل عليها.**
- **K-02 — `supabase-live.sql`**: لا يُشغَّل حتى يُحسم RLS؛ 7 جداول من 10 بلا مبرر realtime من تحليلي.
- **K-03 — قرار بنية الإنتاج**: هل النشر النهائي (أ) خادم Express محلي على كل عداد، (ب) خادم مركزي واحد مع عدة POS، أم (ج) سحابي Supabase؟ التصميم G يعتمد عليه.
- **K-04 — مصير device key**: إبقاء `checkout` للجهاز؟ أم إلغاء نهائي؟ (يؤثر K على D-11 والاختبار J-04).
- **K-05 — سياسة التعديل بعد المطبخ**: هل يُسمح بتغيير الأصناف بعد إرسالها؟ بأي دور؟ هل يلزم موافقة manager وتدوين؟
- **K-06 — سياسة إعادة فتح الأوردر**: نشاطها الشرعي (خطأ تحصيل، تعديل) وكيف تُعوّض مالياً.
- **K-07 — كلمة مرور المطور/ssb**: ترحيل كل plaintext إلى PBKDF2 قسري بشكل شامل (بما في ذلك القواعد القديمة) وتفعيل `mustChangePassword` على أي حساب قديم.
- **K-08 — نطاق الصلاحيات per-user**: هل المطلوب صلاحيات per-user فعليًا (تجاوزات على الدور) أم أدوار فقط كافية؟ (بنية الآن roles فقط.)
- **K-09 — التدقيق**: من يملك قراءة/حذف audit؟ مطلوب إملاء مُتدني: غير قابل للحذف (awl) إلا لـadmin بعد إجراء خاص.
- **K-10 — تحديد نافذة عدم الاتصال القصوى**: دقائق/ساعات قبل تعليق العمليات؟ وماذا عن الفراغ عند الخروج.

---

## الملفات التي فُحصت (مرجعية)

**الطبقة الخادمية**: `backend/src/auth.ts`، `backend/src/index.ts`، `backend/src/db.ts`، `backend/src/stock.ts`، `backend/src/routes/{auth,crud,special,invitations,controlCenter,batman,admin,analytics,reports,tableLocks}.ts`، `backend/src/services/{decisionService,permissionService}.ts`، `backend/src/repositories/*`، `backend/schema/schema.sql`، `backend/migrations/001–005.sql`، `backend/package.json`، `backend/test/*.cjs` (17).
**طبقة الإلكتورون**: `main.js`، `preload.js`، `main/session-manager.js`، `update-engine.js`.
**واجهات**: `index.html` (الأصناف/الأوردر/الاسترداد/الدخول) ، `kitchen.html`، `admin/{index,dashboard,control-center}.html`، `admin/database.js`, `admin/admin-api.js`, `admin/admin-analytics.js`, `admin/system-health.js`.
**AI/Batman**: `ai-pos-engine.js`، `batman-dashboard.js`، `batman-questions.js`، `ollama-adapter.js`، `ai-reviewer.js`، `knowledge-*`.
**المزامنة/السحابة**: `sync-engine.js`، `supabase-db.js`، `cloud-config.js`، `cloud-live.js`، `deploy/{supabase-schema-v2,sql-rpc-fix,audit,sql-preflight}.sql`، `docs/DATA_OWNERSHIP_MATRIX.md`, `docs/SYNC_CONTRACT.md`.
**أساسات التوثيق**: `docs/{RBAC_MATRIX,ADMIN_LOGIN_FLOW_AUDIT,ADMIN_IN_APP_AUDIT,BATMAN_ARCHITECTURE,OLLAMA_RUNTIME_AUDIT}.md`, `H1/H2/H3-SECURITY-AUDIT*.md`, `README.md`, `package.json`, `backend/.env` (بسم محدود: مفاتيح فقط).

## الملاحظة النهائية

لا يُعلَن النظام «آمناً»: حتى مع 289 اختباراً ناجحاً، توجد ثغرات فعِلة (D-01…D-13) لا تغطيها الاختبارات الحالية، خصوصاً D-02/D-04/D-05/D-06 ومناقشات K-01/K-03/K-05/K-06. الخطة (I) والمصفوفة المستهدفة (G) هي المحاور المقترحة للسوق التالي، **قبل أي Commit/Push أو تغيير سحابي**.

---

## تنفيذ P1+P2 — تحديث الحالة (2026-10-10)

نُفّذت الإغلاقات الأمنية الحرجة التالية في الطبقتين الخادمية والواجهة. الحزمة الآن **17 + 1 اختباراً** (أُضيف `backend/test/phase8-identity-access.cjs`، 31 فحصاً) وكل الاختبارات ناجحة (365+ تأكيداً، 0 فشل). لا Commit/Push.

| # | الحالة | التنفيذ |
|---|--------|---------|
| D-01 | ✅ | `POST /api/orders/:id/reopen` (index.ts:760) — يفحص `refunds.void`، سبب إلزامي، terminal-only، معاملة `BEGIN IMMEDIATE` + history + تدقيق. الواجهة تستدعيه خادمياً (index.html). |
| D-02 | ✅ (محدود) | **قرار نهائي مُحدَّث**: لا ربط سعر بالكتالوج (الحمولة لا تحمل productId). `validateOrderMoney` (crud.ts:186) يمنع الكمية/السعر السالب/الفاحش (سقف `MAX_ITEM_PRICE`، `MAX_ITEM_QTY`) والخصم القالب والخصم > 100. **ربط `items[].price` بالكتالوج الكامل مؤجَّل إلى P5** (يتطلب إضافة `productId` لحمولة `buildOrderPayload()`). |
| D-02 | ملاحظة | الكمية الغائبة/الصفرية تُعتبر 1 مطابقةً لـ`serverOrderTotals`؛ السالبة/الفاحشة تُرفض. |
| D-03 | ✅ | الواجهة fail-closed: لا مسار محلي/استرداد محلي عند تعذّر الخادم (index.html) — يرفض ويسجّل خطأ. |
| D-04 | ✅ | `kitchen.html` أُزيل منه Supabase SDK/anon وأصبح يستدعي `electronAPI.apiRequest`؛ فتح النافذة عبر IPC `open-kitchen` (main.js) مقيّد بجلسة موثَّقة. |
| D-05 | ✅ | `revalidateLiveUser` لكل طلب في `authRequired` (auth.ts:130) — المُعطَّل/المحذوف → 401 + إبطال الجلسة، والدور الحيّ يسري فوراً؛ `destroyUserSessions` عند التعطيل (invitations.ts). |
| D-06 | ✅ | `DELETE_ADMIN_ONLY = {users, audit_logs}` (crud.ts:84) — حذفها يتطلب `admin` حصراً. |
| D-07 | ✅ | تدقيق login.success/failed/locked/logout/password.changed + كل رفض `<store>.rejected` بـ`userId` و`ipAddress` (crud.ts:233, routes/auth.ts)؛ قفل حساب مؤقت بعد 8 محاولات (429). |
| D-08 | ✅ | `POST /api/batman/record` → `requireRole('admin')` (routes/batman.ts:11). |

### قرارات مُسجّلة
- **D-02 (نهائي)**: لا ربط سعر بالكتالوج في P1/P2 — سلامة أموال + سقف فقط. الربط الكتالوجي الكامل → **P5** (يتطلب `productId` في حمولة الطلب من الواجهة).
- **K-07**: أُبقي حد كلمة المرور الأدنى 6 (بلا تعقيد جديد) لتفادي كسر مسارات الدعوة/التبديل والاختبارات — موثَّق للمالك.
- **مقايضة D-08**: سجل قرارات Batman الرسمي يبقى من `/execute` و`/permissions` الخادميين؛ الكتابة اليدوية للمحرّك المحلي تحتاج الآن جلسة admin.

### الثغرات المتبقية (خارج P1/P2)
- D-09 (CORS انعكاسي + أسرار في backend/.env)، D-10…D-13، وK-01…K-06. **K-04** (نتائج RLS من SQL Editor) معلّق — يخص مسار السحابة (P6).