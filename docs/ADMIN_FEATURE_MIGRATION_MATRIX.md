# مصفوفة هجرة ميزات الإدارة (Admin Feature Migration Matrix)

> المستند: `docs/ADMIN_FEATURE_MIGRATION_MATRIX.md` — مخرج Phase 3.5 (Admin Convergence).
> الحالة: **عقد توجيه** — يوثّق كل ميزة في منطقة الإدارة: أين تعيش اليوم، من أين تقرأ/تكتب، وإلى أين تتقارب، وما حالتها.
> المصدر: تدقيق فعلي للكود (Phase 3.5) + عقود Phase 1 (`docs/` الثمانية).
> المنهج: كل صف مستمد من سلوك الكود الحالي (`file:line`) — لا تخمين.

---

## 1) دليل الأعمدة

| العمود | المعنى |
|---|---|
| **Feature** | الميزة / الشاشة |
| **Current Page** | أين تُستخدم اليوم |
| **Current Data Source** | مصدر البيانات الحالي (IndexedDB via `LuccaDB` / backend `/api/*` / `/api/cc/*` / `/api/reports/*`) |
| **Current API** | نقاط الاتصال المستخدمة (قراءةً وكتابةً) |
| **Current Permission** | الصلاحية السيرفرية المطلوبة (من `ROLE_PERMISSIONS`/`crud.ts`/`controlCenter.ts`) |
| **Current Write Path** | مسار الكتابة الفعلي (سيرفر أم IndexedDB محلي أم هجين) |
| **Target Page** | الصفحة الهدف (مركز التحكم الموحّد غالباً) |
| **Target API** | نقاط الاتصال الهدف |
| **Target Service** | خدمة backend المسؤولة (المرجع الوحيد للرقم) |
| **Migration Status** | `KEEP` يبقى كما هو | `DUPLICATED` مكرَّر بين طبقتين | `READY_TO_MIGRATE` جاهز للنقل | `MIGRATED` مُهاجَر فعلاً في Phase 3.5 أو قبلها | `BLOCKED` محجوب (يتطلب قرار/مرحلة لاحقة) | `LEGACY` تراثي يُستبدل تدريجياً |
| **Risk** | مخاطر النقل (´متوسط/عالٍ` = نقص رقمي أو كتابة) |
| **Regression Test** | اختبار حماية مطلوب/قائم |
| **Notes** | ملاحظات + `file:line` مفتاحي |

قيم `Migration Status` المستخدمة أدناه (إنجليزية للإشارة إلى الحالة الدقيقة): `KEEP`, `DUPLICATED`, `READY_TO_MIGRATE`, `MIGRATED`, `BLOCKED`, `LEGACY`.

---

## 2) المصفوفة

### 2.1 لوحة المؤشرات (Dashboard)

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| لوحة المؤشرات (KPIs/رسوم/تنبيهات) | `admin/index.html` dashboard | IndexedDB — `AdminAnalytics.compute` (`admin-analytics.js:46`) + `localDashboardFallback` (`index.html:2452`) | `GET /api/dashboard` (إن توفر) + قراءة محلية كاملة | `reports.read` | قراءة (لا كتابة) | `control-center.html` dashboard | `GET /api/cc/dashboard` | `accountingService` + `reportService` | DUPLICATED | متوسط (تطابق رقمي) | `phase4-admin-write` + `test-admin-analytics` | 3 صيغ مالية متوازية (انظر العقد) — التقارب نحو CC؛ إعادة تسمية `gross` في Phase 4 |
| لوحة رقمية سيرفرية | `admin/dashboard.html` (وحدة كاملة) | backend مباشر | `/api/reports/sales` `.../expenses` `.../inventory` `.../employees` `.../suppliers` + `/api/batman/decisions` | `reports.read` (batman: إدارة) | قراءة | دمج في `control-center.html` | `/api/cc/reports/:type` | `reportService` | DUPLICATED | متوسط | `accounting-tools` | لوحة ثانية لنفس الغاية (`ADMIN_REENGINEERING_PLAN.md:56-57`)؛ تُندمج كـ tabs في CC |
| مركز التحكم (الغلاف المستقبلي) | `admin/control-center.html` | backend عبر `api()` (`:216`) | `/api/cc/*` | `reports.read` + نطاق server-side (`scope`) | كتابات Tier1/Tier2 عبر `writeApi` (`:920`) | نفسه | `/api/cc/*` | الخدمات الثمانية | MIGRATED | — | `phase4-admin-write` | الصفحة الهدف؛ لا تُدمَج فيها وحدات index.html بعد |

### 2.2 المبيعات والطلبات

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| قائمة الطلبات/التفاصيل | `admin/index.html` orders-page | IndexedDB `Orders.getByDateRange` (`database.js:1470`) | `/api/orders`, `/api/cc/orders` | `orders.read` | قراءة | `control-center.html` orders (مقسم صفحات) | `/api/cc/orders?page&pageSize` + `/api/cc/orders/:id` | `salesService.getOrdersPage` | READY_TO_MIGRATE | منخفض | `phase4-admin-write` | إدخال الترقيم السيرفري هو سطح جديد (legacy يقطّع `.slice` فقط) |
| تحصيل/دفع طلب (checkout) | POS `index.html` + backend | backend SQLite | `POST /api/orders/:id/checkout` | `checkout` | سيرفر حصراً | بدون تغيير | نفسه | `salesService` + `stock.ts` | KEEP | — | `p0-money-guards`, `checkout-idempotency`, `p1-followup` | المسار المالي الساخن لا يُلمس (`ADMIN_REENGINEERING_PLAN.md §14`) |
| إلغاء/استرداد | backend only | backend SQLite | `POST /api/orders/:id/void` + refunds | `refunds.void` / `refunds.write` | سيرفر حصراً | بدون تغيير | نفسه | `salesService` + `stock.restoreStockAfterVoid` | KEEP | — | `p1-refund`, `p0-money-guards` | لا كتابة استرداد أمامية مطلقاً |
| الفواتير اليدوية (record invoice) | POS chat / `database.js:1343` | backend | `ServerAPI.add('orders')` + `/checkout` | `checkout` | سيرفر أولاً (noQueue) | بدون تغيير | نفسه | `salesService` | KEEP | — | `p1-invoice` | ghost-order يُحذف عند الفشل |

### 2.3 الكتالوج (Tier 1)

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| الأقسام | `admin/index.html` categories-page | IndexedDB `Categories` (`database.js:2831`) | `/api/cc/categories` | `categories.write` | محلي + سيرفر | `control-center.html` categories | `/api/cc/categories` | `catalogService.createCategory` | MIGRATED (سيرفر) / index.html DUPLICATED | منخفض | `phase4-admin-write` | وحدة CC مكتملة (`control-center.html:942`) |
| المنتجات + الوصفات | `admin/index.html` products-page | IndexedDB `Products` (`database.js:2878`) + `ProductRecipes` | `/api/cc/products`, `/api/cc/products/:id/recipes` | `products.write` | محلي + سيرفر | `control-center.html` products | `/api/cc/products` + recipes | `catalogService` | MIGRATED (سيرفر) / DUPLICATED | متوسط | `phase4-admin-write` | حفظ على مرحلتين (product ثم recipes) في CC (`control-center.html:1090`) |
| الطاولات | `admin/index.html` tables-page | IndexedDB `Tables` (`database.js:1025`) | `/api/cc/tables` | `tables.write` | محلي + سيرفر | `control-center.html` tables | `/api/cc/tables` | `catalogService.createTable` | MIGRATED (سيرفر) / DUPLICATED | منخفض | `phase4-admin-write` | ملاحظة RBAC: `manager` لا يملك `tables.write` (مختبَر في phase5) |
| طرق الدفع | `admin/index.html` paymethods-page | IndexedDB `PaymentMethods` (`database.js:2790`) | `/api/cc/payment-methods` | `payments.write` | محلي + سيرفر | `control-center.html` payment-methods | `/api/cc/payment-methods` | `catalogService` | MIGRATED (سيرفر) / DUPLICATED | منخفض | `phase4-admin-write` | `payments.write` تُستخدم هنا فقط للكتالوج (لا للدفعات) |

### 2.4 العمليات والماليات (Tier 2)

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| المصروفات | `admin/index.html` expenses-page | IndexedDB `Expenses` (سيرفر أولاً) | `/api/cc/expenses` | `expenses.write` | سيرفر أولاً + درج محلي + تدقيق | `control-center.html` expenses | `/api/cc/expenses` | `expenseService` | MIGRATED (سيرفر) / DUPLICATED | منخفض | `phase4-admin-write`, `p0-money-guards` | الحماية الوحيدة في legacy هي إخفاء زر الحذف للكاشير (`index.html:4063`) |
| المشتريات | `admin/index.html` purchases-page | IndexedDB `Purchases` (`database.js:1626`) | `/api/cc/purchases` | `purchases.write` | محلي + سيرفر | `control-center.html` purchases | `/api/cc/purchases` | `purchaseService` | MIGRATED (سيرفر) / DUPLICATED | منخفض | `phase4-admin-write` | CC ملخّص + صفحات (`control-center.html:582`) |
| المخزون + الحركات + الهالك | `admin/index.html` inventory-page | IndexedDB `Inventory` (`database.js:1555`) + `StockMovements` | `/api/cc/stock`, `/api/cc/stock/:id/adjust`, `/api/cc/stock/waste` | `inventory.write` | محلي (POS side) + سيرفر (CC) | `control-center.html` stock/movements | `/api/cc/stock` + movements | `inventoryService` | MIGRATED (سيرفر) / DUPLICATED | متوسط | `phase4-admin-write` | خصم المخزون الفعلي للبيع يبقى سيرفراً عبر `stock.ts` (لا يُحرَّك) |
| الحضور | `admin/index.html` attendance-page | IndexedDB `Attendance` (`database.js:2370`) | `/api/cc/attendance/check-in`, `.../check-out` | `attendance.write` | محلي + سيرفر | `control-center.html` employees | `/api/cc/attendance/*` | `attendanceService` | MIGRATED (سيرفر) / DUPLICATED | منخفض | `phase4-admin-write` | حساب ساعات العمل كامل في CC (`attendanceService.ts:16`) — يزيل تولف `database.js:2407` |
| الشيفتات/التسوية اليومية | `admin/index.html` shifts-page | IndexedDB `DailyShifts` (`database.js:2585`) | `/api/daily-shifts` + `/api/cc/cash/daily` + `/api/cc/shifts/open|close` | `daily-shifts.write` / `shifts.write` | سيرفر | `control-center.html` cash | `/api/cc/shifts/open|close` + `/api/cc/cash/daily` | `shiftService.closeDailyShift` | MIGRATED (سيرفر) / DUPLICATED | متوسط | `phase4-admin-write` | `expectedCash` مشتق سيرفراً (عقد §1.3)؛ legacy يحسب محلياً (`database.js:2653`) — يُستبدل |
| الموظفون + الدعوات | `admin/index.html` employees-page | IndexedDB `Employees` (`database.js:2267`) + `ServerAPI` | `/api/cc/employees` (قراءة)، `/api/employees/invite`, `/api/employees/:id/status` | `employees.write` | محلي + سيرفر (دعوة) | `control-center.html` employees | `/api/cc/employees` | `allEmployees` (repo) | PARTIAL — قراءة MIGRATED / كتابة LEGACY | متوسط | `phase4-admin-write`, `test-employee-invite` | قسم الموظفين في CC قراءة فقط اليوم؛ الدعوات تبقى في legacy حتى Phase 6 |

### 2.5 المستخدمون والأدوار

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| تسجيل الدخول/الجلسة/كلمة المرور | `admin/index.html` + `control-center.html` | LuccaDB محلي + backend | `/api/auth/login`, `/api/auth/password`, `/api/auth/me`, `/api/auth/logout` | auth (جلسات SQLite) | سيرفر (جلسات) | كلا الواجهتين | `/api/auth/*` | `auth.ts` | MIGRATED | منخفض | `guard-regression`, `runtime-smoke`, `p1-ttl` | جلسات خارج الذاكرة (P1 verified)؛ `mustChangePassword` إجباري قبل العمليات المميزة |
| إدارة المستخدمين/الأدوار | `admin/index.html` roles-page | IndexedDB `Users` | `/api/users` (قراءة إدارية فقط) | `users.manage` (admin) | **كتابة الأدوار محلياً فقط** — `db.put('users', …)` (`index.html:4309`) بلا نداء سيرفر | مستقبلاً system (مؤجل) | `/api/users` | users (خلف auth) | BLOCKED | عالٍ (فجوة RBAC — P4) | لا يوجد | تغيير الدور يكتب IndexedDB مباشرة ويتجاوز الحارس السيرفري؛ يُحسم في Phase 6 (جداول roles/perms) — لا يُلمس في Phase 3.5 |
| إعادة تعيين الأدمن الافتراضي | `admin/index.html` (`Users.resetDefaultAdmin`, `database.js:996`) | محلي + جلسات | — | — | محلي + server reset | يبقى في legacy فقط | — | `auth.ts` reset | KEEP | — | `guard-regression` (admin/123456 → must change) | مرجع للطوارئ (روابط منها داخل CC) |

### 2.6 التقارير والتدقيق وباتمان

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| التقارير (مبيعات/مصروفات/مخزون/موظفون/موردون) | `admin/index.html` reports-page + `admin/dashboard.html` | AdminAnalytics (عميل) + `/api/reports/*` (سيرفر) | `/api/cc/reports/:type` | `reports.read` (+ أرباح: admin فقط عبر `isAdmin`) | قراءة | `control-center.html` reports | `/api/cc/reports/:type` | `reportService` (موصد الأرقام الوحيد) | MIGRATED (سيرفر) / legacy DUPLICATED | متوسط (تطابق رقمي) | `accounting-tools`, `live-parity` | الأرباح/COGS تُعرض فقط بطول `null` لغير المدير (`controlCenter.ts:131`) |
| سجل التدقيق | `admin/index.html` audit-page | IndexedDB `AuditLogs` (`database.js:3048`) | `/api/audit_logs` (قراءة إدارية) | `audit.read` | قراءة | مستقبلاً system (مؤجل) | `/api/audit_logs` | audit repo | READY_TO_MIGRATE | منخفض | لا يوجد | `/api/audit_logs` restricted إدارياً (`crud.ts:51`) |
| سجل قرارات باتمان | `admin/dashboard.html` batman-log | backend | `/api/batman/decisions?limit=` | admin | قراءة | `dashboard.html` (أو CC مستقبلاً) | `/api/batman/decisions` | `decisionService`/`permissionRepo` | MIGRATED | منخفض | `phase5-decision-layer` | لا تُنسخ مصفوفة الصلاحيات في الواجهة (`dashboard.html:562` يقرأها سيرفراً) |
| مصفوفة الصلاحيات (batman) | `admin/dashboard.html` | backend (جدول `batman_permissions`) | `GET/PUT /api/batman/permissions` | admin (تحديث المصفوفة) / public subset للقراءة | سيرفر | يبقى في `dashboard.html` | نفسه | `permissionService` | MIGRATED | منخفض | `phase5-decision-layer` | `decide()` تُنفَّذ سيرفراً دائماً؛ الواجهة تعرض فقط |
| أداة إدارة باتمان (widget) | `admin/index.html` batman-ask | `BatmanQueries.mountAdminWidget` | `GET /api/batman/decisions` | admin | قراءة + confirm كتابية عبر `/api/batman/execute` | يبقى في legacy | `/api/batman/execute` | `decisionService.ACTIONS` | READY_TO_MIGRATE | منخفض | `phase5-decision-layer` | لا تعديل: executor مبني ومعتمد |

### 2.7 النظام والتشغيل

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| فحص صحة النظام | `admin/index.html` system-page + `admin/system-health.js` | LuccaDB + `/health` + `/api/auth/me` | `/health`, `/api/auth/me` | — | قراءة | `control-center.html` system | `/api/cc/system/health` | inline (CC) | MIGRATED (CC inline) / LEGACY (`system-health.js`) | منخفض | لا يوجد | `renderSystem` في CC مكتمل (`control-center.html:1266`) — لا تُنشأ وحدة ثانية؛ `system-health.js` يبقى مستخدماً في باتمان LLM tool (`batman-questions.js:745`) |
| النسخ الاحتياطي | `admin/index.html` backup-page | `DataSync.exportAll` محلي + `backup.ts` سيرفري | `/api/admin/backups` | admin | محلي + سيرفر (VACUUM INTO) | بدون تغيير مؤقتاً | `/api/admin/backups` | `backupService` | LEGACY / READY_TO_MIGRATE | منخفض | لا يوجد | واجهة legacy تبقى؛ CC لا تمنح صفحة نسخ احتياطي بعد |
| إعدادات الخادم/الوضع | `admin/index.html` server-page | localStorage `luccaDataMode` | `/api/settings` | `settings.manage` (admin) | محلي + سيرفر (special) | يبقى في legacy | `/api/settings` | special router | LEGACY | منخفض | لا يوجد | توثيق D6: بوابة الوضع السحابي إلزامية لبقاء الماليات (`index.html:5346`) |
| الطابعة | `admin/index.html` printer-page | WebSerial/WebUSB محلي | — | — | محلي | بدون تغيير | — | — | LEGACY | منخفض | لا يوجد | لا توجد نظير سيرفري بعد |
| قاعدة المعرفة | `admin/index.html` kb-page | `KnowledgeBase` (IndexedDB) | — | — | محلي | `control-center.html` knowledge (مطبق) | — | knowledge | LEGACY (CC تبقى محلية صراحةً — `control-center.html:1249`) | منخفض | `knowledge-unit` | CC تقرأ `luccaKbList` ولا ترفع للخادم — سلوك مقصود |

### 2.8 مسارات POS المتلاصقة — KEEP (لا تُلمس)

| Feature | Current Page | Current Data Source | Current API | Current Permission | Current Write Path | Target Page | Target API | Target Service | Migration Status | Risk | Regression Test | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| إنشاء/تعديل طلب مفتوح (POS) | `index.html` POS | IndexedDB + backend | `ServerAPI.add('orders')` + `/api/orders` | `orders.write` | سيرفر أولاً ثم مرآة محلية | بدون تغيير | نفسه | crud + `salesService.calculateOrderFinancials` | KEEP | — | `p0-money-guards`, `phase4-admin-write` | إجماليات الطلب تُحسب سيرفراً دائماً (`crud.ts:159`) |
| المزامنة (ServerSync / SyncQueue / sync-engine) | `database.js` + `index.html` + `sync-engine.js` | `lucca_sync_queue` (صيغتان) | `POST /api/sync` + per-store GET/POST | `sync` | هجين | بدون تغيير | `POST /api/sync` | sync router (newestWins) | KEEP | — | `c2-tests/run-tests` (17), `live-parity` | تعارض الصيغ موثق (PHASE1 D7) — توحيد في Phase 10، لا الآن |
| أدوات باتمان التنفيذية | `ai-pos-engine.js` + `decisionService` | backend services | `POST /api/batman/execute` | RBAC + matrix (طبقتان) | سيرفر (idempotent eventId) | بدون تغيير | نفسه | `decisionService.ACTIONS` | KEEP | — | `phase5-decision-layer` | باتمان يبقى طبقة قراءة/تفسير فقط في هذه المرحلة (`BATMAN_ARCHITECTURE.md §2`) |

---

## 3) الخلاصة الإحصائية (Phase 3.5)

| الحالة | العدد | الميزات |
|---|---|---|
| **MIGRATED** (سيرفر/CC جاهز) | 12 | لوحة CC، طلبات backend، أقسام، منتجات، طاولات، طرق دفع، مصروفات، مشتريات، مخزون، حضور، شيفتات، تقارير، تدقيق باتمان، مصفوفة، auth، صحة النظام (CC) |
| **DUPLICATED** (متوازٍ عميل/سيرفر — يُقارب) | 10 | لوحة KPIs، لوحات dashboard الثانية، قوائم الكتالوج/العمليات في legacy، تقارير legacy |
| **READY_TO_MIGRATE** | 3 | قائمة طلبات مقسمة، سجل التدقيق، أداة باتمان |
| **BLOCKED** | 1 | إدارة المستخدمين/الأدوار (فجوة RBAC — Phase 6) |
| **LEGACY** (يستمر مؤقتاً) | 5 | نسخ احتياطي، إعدادات خادم، طابعة، KB، system-health.js |
| **KEEP** (مسارات ساخنة لا تُلمس) | 6 | checkout/void/refund، فاتورة يدوية، طلبات POS، مزامنة، أدوات باتمان، reset admin |

---

## 4) قواعد الاستخدام

1. أي ميزة مصنّفة `MIGRATED` (سيرفر) تُقرأ/تُكتب عبر `/api/cc/*` أو `/api/*` المدرج في `Target API` — لا تفتح مساراً موازياً.
2. أي ميزة `DUPLICATED` تُشغَّل **بلا تغيير رقمي** حتى Phase 4 (تطابق live-parity إلزامي قبل النقل).
3. أي ميزة `BLOCKED` تُهمَل في الواجهة الجديدة حتى تُحسم (هنا: إدارة الأدوار ← Phase 6 RBAC).
4. أي ميزة `KEEP` ليست فقط محظورة من التعديل، بل جزء من "لا تلمس" (`ADMIN_REENGINEERING_PLAN.md §14`).
5. كل نقل في المراحل اللاحقة يُدخل هنا صفاً جديداً بحالة `MIGRATED` + اختبار regression محدد قبل/بعد.

---

*نهاية المستند — يبقى مرجعاً حياً يُحدَّث مع كل مرحلة هجرة.*