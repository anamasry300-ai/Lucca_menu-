# LuccaPOS — Admin & Batman Re-Engineering Plan (Phase 0 deliverable)

> المستند: `docs/ADMIN_REENGINEERING_PLAN.md`
> الحالة: **Phase 0 اكتملت (Audit) — Phase 1 اكتملت (Contracts + safety patch)**. التالي:Phase 2 عند تأكيدك.
> التاريخ: 2026-09 — البناء الحالي: Electron **1.3.5** (`dist/LuccaPOS-Setup-1.3.5.exe`، latest.yml 2026-09-15).

## Phase 1 Deliverables (مخرجات — عقود مُلزمة)

| المستند | قرارات/محتوى |
|---|---|
| `CANONICAL_REPORTING_CONTRACT.md` | الصيغ المرجعية النهائية (net/gross/refunds/AOV/COGS/profit/drawer)، خريطة كل طبقة حاليّة → العقد، تسمية D1-D2 |
| `BATMAN_ARCHITECTURE.md` | سلسلة التنفيذ + الممنوعات + عقد الأداة + سجل الأدوات الحالي + قرارات الأمان (XSS/injection/key/SSRF/idempotency) |
| `RBAC_MATRIX.md` | الأدوار الخمسة الفعلية المحددة (auth.ts:119) → الأدوار الهدف الثمانية+DEVICE + مصفوفة دور×صلاحية مبنية على أدلة سلوك + مصفوفة batman |
| `DATA_OWNERSHIP_MATRIX.md` | كاتب/مرجع لكل كيان في كل وضع (local/cloud) — الماليات كاتب واحد |
| `SYNC_CONTRACT.md` | الصيغ الثلاث الحالية، قاعدة الكاتب الواحد، الغطاء D6، الهدف الموحد الثماني حقول |
| `DATA_MODEL.md` | مخططات ER موجودة + حقول الهوية + المحمي + جداول ترحيل مقترحة (لا تُنشأ) |
| `PHASE1_DECISIONS.md` | D1-D12 بصيغة Decision/Evidence/Options/Chosen/Reason/Risk/Migration/Rollback + موثق إصلاح D6 |

**إصلاح أمان واحد نُفِّذ (الاستثناء المالي للإثبات):** `index.html` في `_enqueueOrderSync()` — سطر مبكر يمنع كتابة REST محلية للماليات في وضع `supabase` (توثيق كامل: `docs/PHASE1_DECISIONS.md` §D6، برهان قبل/بعد عبر `phase1-dualwrite-probe.cjs`). Baseline كامل أخضر (136/136): run-tests 17، rpc-v1-checkout-model 16، accounting-tools 17، p1-followup 67، runtime-smoke 13، server-smoke 6.

---

## 1) Current Architecture

### 1.1 Two runtimes coexist

| | **LOCAL / Desktop (default)** | **CLOUD / Supabase (opt-in)** |
|---|---|---|
| Nuance | `luccaDataMode` default `'local'` | فقط عند `luccaDataMode === 'supabase'` |
| Data layer | IndexedDB `lucca_caffe_db` v9 (`admin/database.js`) | `supabase-db.js` (يستبدل `window.LuccaDB` مباشرة عند التفعيل) — PostgREST + RPC |
| Server | Express محلي SQLite `backend/data/lucca.db` على `:3000` مترافق عبر `luccaServerUrl` | لا backend على Vercel — Vercel static-only (`vercel.json`) |
| POS | `index.html` | نفس `index.html` لكن LuccaDB = المحول السحابي |
| Kitchen | `kitchen.html` (سحب كل 10s، لا WebSocket) | نفسه + قراءة Supabase مباشرة بأنون كي |
| Admin | `admin/index.html` (IndexedDB) + `admin/dashboard.html` (سيرفر) | نفس الملفّان لكن LuccaDB = المحول |

**مفاتيح الحسم:** `supabase-db.js:16` (mode gate) — يخرج مبكرًا في الوضع المحلي ويترك `window.LuccaDB` = `admin/database.js`؛ و`admin/index.html:4337-4350` لعبة مفتاح الوضع + تأكيد RPC-v1. كلاهما يُحمَّل في نفس الصفحة (`index.html:11-13`).

### 1.2 Datastores / entities

- **Frontend IndexedDB**: `SYNC_STORES` = 28 مخزنًا (`admin/database.js:14-20`) — settings, tables, categories, products, product_modifiers, product_variations, employees, users, attendance, shifts, daily_shifts, cash_registers, orders, order_items, order_status_history, payments, refunds, customers, discounts, inventory, purchases, suppliers, expenses, waste_log, stock_movements, product_recipes, invoices, sync_log (+audit_logs, invitations, bot_memory…).
- **Backend SQLite** (`backend/schema/schema.sql`، 601 سطر): `users, employees, invitations, attendance, shifts, daily_shifts(date PK), cash_registers(+version optimistic), categories, products, product_modifiers, product_variations, payment_methods, taxes, orders, order_items, order_status_history, payments, refunds, customers, discounts, settings, audit_logs, expenses, inventory, purchases, suppliers, stock_movements, product_recipes, waste_log, inventory_alerts, invoices, sync_log, tables_store` + view `tables`.
  - منشأة كوديًا/مigrations وليست في schema.sql: `sessions, table_locks, schema_migrations, batman_permissions (001), batman_decisions (002), backup_log (003)`، `eventId` فريد (004)، `stock_movements.orderId` (005).
  - **غير موجودة إطلاقًا** (أسماء متوقعة فقط): `inventory_items, expense_categories, purchase_items, roles, permissions, role_permissions, ai_actions, ai_conversations, invites`.
- **Supabase (حي)**: مخطط v1 snake_case — مطابق أساسًا لـ `deploy/supabase-schema.sql` (موسوم DEPRECATED). مؤكد بالفحص الحي: `orders/order_items/payments/refunds/expenses/purchases/inventory(product lacks updated_at)/settings/stock_movements/product_recipes` موجودة؛ **`suppliers, expense_categories, sync_log` مفقودة (PGRST205)**؛ `users` بلا `display_name/must_change_password`؛ دوال RPC الخمس **غير موجودة**؛ OpenAPI يتطلب service_role.
- **Repository**: `dist/` (بناء مكتوب في المستودع) + `backend/dist` — تكرارات.

### 1.3 APIs (backend)
`src/index.ts` + routers: `auth (login/logout/me/password/verify/provision-device/device-status)`, `sync (POST /api/sync — دمج آمن، لا DELETE، remap orderSyncId)`, `crud /api/:store` عام (33 مخزنًا SAFE_TABLES)، `analytics /dashboard/*` (20 مسارًا)، `reports/*` (reportService)، `special (daily-shifts, settings)`، `batman (check/record/matrix/permissions/decisions/stats)`، `admin (backups)`، `invitations`، `tableLocks`، `orders/:id/checkout`، `orders/:id/void`، `proxy-llm/openai`، `health/public-key`.

### 1.4 Auth & Permissions
- Sessions SQLite (TTL 12h، placeholder ذكية)، PBKDF2-SHA512 (100k)، admin افتراضي `admin/123456` + mustChangePassword. Device role عبر API-key.
- RBAC **مكتوب في الكود** (`auth.ts:119 ROLE_PERMISSIONS`: admin `['*']`، manager، cashier، kitchen، device) — **لا جداول roles/permissions**.
- حواجز متوازية: `requirePermission`/`requireRole` + `STORE_WRITE_PERM` + `ADMIN_ONLY_STORES` + `read/write/deleteDenied` + `requireAdminish` + مصفوفة Batman `batman_permissions` (محدودية 500/1000/مدير — تُنفَّذ في `permissionService.decide()` ونسخة fail-closed محلية).

### 1.5 Admin
- `admin/index.html`: ~18 صفحة/تبويب كلها تقرأ **IndexedDB عبر `AdminAnalytics.compute(window.LuccaDB,…)`** — dashboard، orders، tables، categories، products، payment methods، employees، attendance، shifts، inventory، purchases، expenses، roles، audit، batman-ask، system، kb، reports، backup، printer، server. تسجيل الدخول محلي (`LuccaDB.Users.login`)، توكن `sessionStorage['luccaToken']`.
- `admin/dashboard.html`: لوحة ثانية **مقرؤها السيرفر** `/api/reports/*` + `/api/batman/decisions`. ← **لوحتان منفصلتان لنفس الغاية.**
- `admin-system-health.js`: فحوصات حقيقية (mode, auth/me, sync_log, schema version).

### 1.6 Batman / Ollama
- `ollama-adapter.js`: أوضاع auto/ollama/openai؛ محلي `localhost:11434` (qwen2.5:3b)، OpenAI عبر `POST /api/proxy-llm` (حارس SSRF) ثم مباشرة؛ `llmReady()` يخفض إلى قواعد محلية عند غياب النموذج.
- قواعد أولًا + LLM كطبقة أخيرة: `accountingCommand` (Regex)، `localAnswer`، `REPORTS` (11 تقريرًا حقيقيًا من بيانات مباشرة)، `BMRuntimeTools` (~25 دالة قراءة فقط)؛ `ai-pos-engine.js` أدوات تنفيذ موثّقة بالصلاحيات + قفل الطاولة + confirmation + auditoفبوكس بـ `eventId` idempotent.
- Knowledge: `knowledge/data.js` (8 مستندات ثابتة) + `knowledge-base.js` (RAG IndexedDB + mirror Supabase).

### 1.7 Sync
ثلاث آليات:
1. **ServerSync المحلي** (`admin/database.js`): pushAll/pullAll عبر `POST /api/sync` (دمج آمن، newestWins بفترة غموض 5s، لا DELETE).
2. **POS SyncQueue** (`index.html:5258`): طابور REST لكل بند → `localhost:3000/api/:collection`، مفتاح `lucca_sync_queue` بصيغة `{action, collection, data}`.
3. **Supabase queue** (`sync-engine.js`): طابور بنفس المفتاح `lucca_sync_queue` لكن بصيغة `{id, table, op, recordId, data, deviceId, timestamp, retries, status}` + أعمدة `_synced/_device_id/_synced_at`.

---

## 2) Problems (أهم ما كشفه التدقيق)

| # | المشكلة | الدليل | الشدة |
|---|---|---|---|
| P1 | **تعريفات متناقضة لـ net sales / profit / revenue** عبر 4-5 طبقات: `admin-analytics.js` (خصم لا يُطرح من net)، `reportService.ts:73` (نعم يُطرح)، `ai-pos-engine._salesStats:2119` (net = gross − refunds)، `batman-dashboard` (3 صيغ ربح مختلفة)، POS bar (يشمل pending). | P1 مرتفع
| P2 | **طابور مزامنة مزدوج (Dual-writer) على `lucca_sync_queue`** في الوضع المحلي: `sync-engine.js` (عبر `wrapDBOperations` في `database.js:3764`) يكتب صيغةً، وPOS SyncQueue يقرأ صيغة أخرى `{action}` → `POST /api/undefined` + شريط أحمر كاذب بعد 15 محاولة. | sync-engine:9,262؛ index.html:5260,5270; database.js:3761-3797 | مرتفع |
| P3 | **في الوضع السحابي**، `SyncQueue.start()` (index.html:5427) و`_enqueueOrderSync()` (5346, المستدعاة من 2402/3257) تعملان بلا بدّ شرطي → الطلب يكتب في **Supabase AND localhost:3000** (dual-write لبيانات أموال). | index.html:2400-2402,5366 | مرتفع |
| P4 | **RBAC 4 حواجز متوازية + لا تطبيق في واجهة Admin المحلية** (indexedDB لا يمر بالـ backend) + لا جداول roles/permissions. | auth.ts, crud.ts, special.ts | مرتفع |
| P5 | **حساب إجمالي الطلب مكرر 4 مرات** (index.html:592, database.js:1386, backend:434, RPC _lucca_compute_totals). | — | متوسط |
| P6 | **عدم تناسق مالي**: استرداد CRUD (`crud.ts`) لا ينقص `daily_shifts` خلافًا لـ `/void` (index.ts:707-718)؛ و`prevNetSales` يحسب بلا خصومات (reportService.ts:74). | — | مرتفع |
| P7 | **Batman XSS**: `innerHTML` لنصوص LLM/RAG في `batman-dashboard.js:1085,1100` و`batman-questions.js:596` بلا `escHtml`. وإدخال prompt عبر إغراق سياق ببيانات DB غير معقّمة (buildContext/buildLiveContext). | — | مرتفع |
| P8 | **مفتاح OpenAI** نص-واضح في `localStorage['luccaOpenAIKey']` وقابل للضبط من الشات (`index.html:7250`). | ollama-adapter:59 | متوسط |
| P9 | **Supabase incomplete live**: RPC مفقود، `suppliers/expense_categories/sync_log` مفقودة، `inventory.updated_at` غير موجود (أُصلح في 2B)، v2 (camelCase + RLS) غير مطبق. | فحوصات حية | مرتفع لللترحيل |
| P10 | **كود ميت/مكرر**: `saveDb()` no-op يُستدعى ~17 مرة؛ `deploy/supabase-db.js` نسخة منتهية بلا `toCamel` في getAll؛ `apiFetch`/`localDashboardFallback` في admin بلا مستدعى؛ صفحات server/printer فارغة؛ عدّة دوال repos غير مستدعاة؛ `dist/` مشوّب. | db.ts:119, crud… | متوسط |
| P11 | **COGS هش**: يعتمد على `products.cost` (قد يكون 0) — `hasCostData` يخفي المؤشرات؛ المخزون والإهلاك لا يمرران بالتكلفة دائمًا؛ `restoreStockAfterVoid` يستخرج الاسم من نص `notes` (`split_part(' :: ',2)`). | backend/ordersRepo:50, stock.ts:101 | متوسط |
| P12 | **لا جدولة/ترقيم صفحات**: لوحات admin تجمع كل IndexedDB في الذاكرة (`AdminAnalytics.compute`) — أداء ومخاطر ذاكرة مع نمو البيانات. | — | متوسط |
| P13 | **لا WebSocket**: kitchen يسحب كل 10s؛ لا push حي. | kitchen.html:642 | منخفض |
| P14 | **Fallback من** `menu-data.js` (كتالوج ثابت 16 فئة) كمصدر عرض — صحيح كمخزون بديل، لكنه قد يجعل الصفحة تُظهر أسعارًا غير واقعية عند غياب المنتجات. | index.html:563,4170 | منخفض |

---

## 3) Target Architecture

```
LuccaPOS (Single Source of Truth)
   ├── Data Layer: ONE truth = Local-first (IndexedDB + SQLite server) مع Sync
   │              إلى Supabase (v1 snake_case فقط حتى تجهيز v2) — مصدران فقط:
   │              Local (offline primary)  و  Cloud (replica محمي بـ RPC/RLS).
   ├── Business Layer: services موحّدة (نفس المنطق لكل المتصلين):
   │      AccountingService · SalesService · InventoryService · ExpenseService
   │      PurchaseService · EmployeeShiftService · CashService · ReportingService
   ├── API layer: backend كمنفّذ موحّد للعمليات الحسابية المالية (checkout/void/refund/
   │      stock/COGS/تسوية) — Admin وBatman وPOS يستدعونه (أو RPC السحابي المطابق).
   └── AI layer: Batman = طبقة تحليل فوق الخدمات فقط (لا تخزين مستقل، لا SQL حر).
```

قرارات أساسية:
1. **المنطق المالي والآلي يُفرض في الخدمات الخلفية** (backend أو RPC) — لا حساب في الواجهات إلا للعرض.
2. **ReportingService هو موصّد الأرقام الوحيد**؛ Admin وBatchman يقرءون نفس الـ service.
3. **RBAC موحّد**: أدوار + صلاحيات granular في DB، حارس واحد، يُفرض في متصف (backend/RPC) **وتشغيليًا** في الواجهة.
4. إيقاف توظيف `lucca_sync_queue` المزدوجة وتوحيد طابور واحد (أو قفل كل آلية بوضعها).
5. إغلاق dual-write السحابي (تعطيل SyncQueue/`_enqueueOrderSync` في الوضع `supabase`).

---

## 4) Database Model (الهدف)

- **Local-first سؤال/مؤقت**: إبقاء الجداول الحالية + استكمال المفقود عبر.
- **Supabase target**: تطبيق v2 (camelCase + RLS) **بعد** استقرار مصفوفة النسخ والمطابقة، ورفع `suppliers`, `expense_categories`, `sync_log`, أعمدة RPC (مطبقة في rpc-v1)، ثم إنشاء RPC functions live.
- **إضافات مقترحة (عبر migrations لاحقًا، بعد موافقة)**:
  - `expense_categories(id, name, sort)` + `expenses.categoryId` FK اختياري.
  - `purchase_items(id, purchaseId FK, productRef, quantity, unitCost, total)` مع إبقاء `purchases` موصّفًا للإجماليات.
  - `roles(id, code, name)` و`permissions(id, code, module)` و`role_permissions(roleId, permissionId)` — جدولة الـ ROLE_PERMISSIONS الحالية.
  - `inventory_movements` ببيانات غزيرة (prev/new qty, unit, cost, user, ref) = تخصيص `stock_movements` الحالية (أعمدة إضافة).
  - `waste_log` → حركات نوع `WASTAGE` داخل `stock_movements`.
  - `ai_actions(id, eventId UNIQUE, actor, requestedBy, tool, params, status, createdAt)` — رفع طابور audit الحالي من localStorage إلى DB.
  - `invoice_number_seq` و`table_seq` احتياطي.
- **قواعد الثبات**: `syncId` لكل جدول، قيود فريدة `(order_id, sync_id)`؛ update-by-`syncId`; conflict = `newestWins` (فترة غموض 5s)؛ لا DELETE مباشر للماليات.

---

## 5) Business Services (طبقة منطقية موحّدة — ملفات مستهدفة)

الهدف: نقل المنطق المكرر إلى وحدات، دون نقل بيانات مالية خارج الحارس:

| Service | المسؤوليات | الاستهلاك الحالي (ليُوحَّد على الخدمة) |
|---|---|---|
| `AccountingService` | netSales = revenue − discounts − refunds؛ COGS = Σ(qty×cost)؛ grossProfit؛ margin | reportService + analytics + admin-analytics + batman + index.html computeNetSales |
| `SalesService` | checkout/void/refund، split، idempotency (syncId) | RPC checkout_order/void_order ↔ backend checkout/void — يجب التزامن التام |
| `InventoryService` | Buy/Sale/Recipe/Refund/Wastage/Adjustment/Count/Transfer كحركات موثّقة | stock.ts + RPC _lucca_* + Inventory adapter |
| `ExpenseService` | Validation، Categories، approvals، daily_shifts linkage | crud + special + saveExpenseFromText |
| `PurchaseService` | Purchase + items + supplier + StockCost + payment status | crud purchases + batman add_purchase |
| `EmployeeShiftService` | shifts/attendance/daily_shifts/cash_registers مع consistency (الاسترداد ينقص cash/card) | special.ts + CashRegister.local + reportService |
| `ReportingService` | all get*() المذكورة — **المصدر الوحيد للأرقام** | backend reportService; Admin & Batman عليهما الانتقال | 
| `AnalyticsService` | بينات مقلوبة مبسطة أعلى Reporting (cache/aggregation) | analytics.ts حاليًا (يُحتفظ كطبقة تجميع أعلى reportService لا منافسة) |

نفطة إلزامية: لإلغاء تعدد الحسابات، طُور `backend/src/services/reportService` و`analytics.ts` كطبقتين (بعد التحقق من تطابق النتائج محليًا {live-parity})، ثم وُجّهت `admin-analytics.js` و`ai-pos-engine._salesStats` وbatman-dashboard إليهما.

---

## 6) Admin Structure (الهدف)

`admin/index.html` يُنمّذج إلى **центр تحكم واحد** (يدمج قطب `admin/dashboard.html`) بأقسام:

- **Dashboard**: KPIs (بيانات حقيقية عبر ReportingService) — Sales (gross/discounts/refunds/net/avg/cash/card/other)، Operations (tables/orders/shifts/employees)، Inventory (value/low/out/movements/purchases), Financial (revenue/expenses/purchases/GP/COGS/margin/cash diff/reconciliation)، AI Insights (بطاقة Batman).
- **Sales**: overview، orders، invoices، refunds، discounts، reconciliation.
- **Tables & Orders**: tables، open orders، transfers، split، merged، history.
- **Products**: products، categories، modifiers، recipes، pricing، costing، performance.
- **Inventory**: stock/حركات/جرد/تعديل/استهلاك/منخفض/تقييم (مع أرقام تكلفة حقيقية).
- **Purchases / Expenses / Employees (مع att/shifts/perf) / Accounting / Reports / AI-Batman / System (users, roles, permissions, devices, health, sync, audit, settings)**.
- كل صفحة: KPI cards، charts، tables، filters/date-range، search، sort، pagination، drill-down، modal، export/print، loading/empty/error states، RTL.

---

## 7) Batman Architecture (الهدف)

- **Tool Registry** موحّد لكل المتصلين (POS chat، dashboard، admin widget) بأقشرة: `name, description, inputSchema, permission, validation, execute через Business Service, auditOutbox(eventId), result`.
- **Read tools** → ReportingService؛ **Write tools** → خدمة وخلفها حارس (backend أو RPC) — لا LLM SQL.
- **Knowledge**: `knowledge/data.js` ثابت (وثائق إجرائية فقط) + RAG على بيانات حية عند الحاجة؛ إصلاح `innerHTML` (escHtml دائم) وإزالة إغراق DB خام من النظام.
- **Actions**: permission + confirmation (dangerous: refund/price/delete/adjust) + auditoفبوكس idempotent.
- **memory**: مخطط دقيق (طاولات حقيقية، لا تخزين نسخة إحصائية خاصة).

---

## 8) Permission Model (الهدف)

- جدولة `roles`/`permissions`/`role_permissions` وترحيل `ROLE_PERMISSIONS` إليها (seed idempotent).
- أدوار: `ADMIN, MANAGER, SUPERVISOR, CASHIER, KITCHEN, ACCOUNTANT, DEVICE, AI_ASSISTANT`.
- صلاحيات granular (`sales.view/create/refund/discount`؛ `inventory.view/adjust/count`؛ `expenses.*`؛ `purchases.*`؛ `employees.*`؛ `reports.financial`؛ `settings.manage`؛ `ai.read/analyze/action`).
- حارس واحد `requirePermission(perm)` في backend/RPC **+ نتائج الحارس تُوجَّه للواجهة** (admin local يمر عبر API أو عبر service محلي يتحقق من دور الجلسة).
- مصفوفة Batman تبقى كطبقة قرار إضافية (حدود/موافقات) فوق RBAC.

---

## 9) Sync Architecture (الهدف/الإصلاح المسبق)

1. **إزالة الـ dual-writer**: في الوضع `local` يُمنع `sync-engine.js` من الكتابة في `lucca_sync_queue` (وضع قفل بحكم الوضع)، أو نقل POS SyncQueue إلى مفتاح مستقل `lucca_pos_rest_queue` مع إزالة الخلط من `_localQueuePendingCount`.
2. **إزالة dual-write السحابي**: `_enqueueOrderSync()` و`SyncQueue.start()` تصبحان بلا أثر في الوضع `supabase`.
3. **بقاء ServerSync المحلي** (المصدر الموثوق للـ local-first) كما هو؛ **Supabase** = مرآة تُدار بـ upsert-by-syncId وبدون REMOVE؛ **RPC** فقط للماليات في الوضع السحابي.
4. إضافة كشف تعارض صريح (conflict UI) وتسجيله في `sync_log`، وإنذار عند `_synced` غير مأخوذة.

---

## 10) Migration Plan (حسب المراحل)

- **Phase 1 (Architecture + Data Model)**: ✔ مكتملة (عقود الـ docs أعلاه + غطاء D6). لا كود إضافي.
- **Phase 2 (Core Business Services)**: نقل لهيكلة services موحدة **+ regression كامل** (الاختبارات القائمة تبقى خضراء أولًا).
- **Phase 3 (Admin Dashboard)**: توحيد اللوحات على ReportingService.
- **Phase 4 (Accounting + Reports)**: الإصلاح الفوري `prevNetSales` + تناسق `daily_shifts` في الاسترداد؛ توحيد netSales.
- **Phase 5 (Inventory + Purchases + Expenses)**: حركات موثّقة، `expense_categories`، `purchase_items`، تكلفة حقيقية للمنتجات.
- **Phase 6 (RBAC + Employees + Audit)**: جداول الأدوار/الصلاحيات + الحارس الموحد.
- **Phase 7 (Batman Tools)**: tool registry موحّد + إصلاح XSS + فصل سياق LLM.
- **Phase 8 (Batman Knowledge + Ollama)**: شحن KB بالمعرفة التشغيلية الحية؛ مفاتيح عبر env/backend فقط.
- **Phase 9 (Batman Actions)**: confirmation+audit كامل عبر خدمات.
- **Phase 10 (System Health + Data Integrity)**: صفحة الشيك + صفحة الفحوص المفتوحة (Data Integrity center).
- **Phase 11 (Full Integration Testing)** و**Phase 12 (Production Build + UAT)**.
- كل مرحلة تنتهي بـ commit واحد صريح عند الطلب فقط، وبدون bump version إلا عند source change حقيقي.

---

## 11) Testing Plan

- **مسارات موجودة يجب أن تبقى خضراء**: `c2-tests/run-tests.js` (17)، `rpc-v1-checkout-model` (16)، `accounting-tools` (13)، `knowledge-unit`، `live-parity` (4)، `server-smoke` (6)، backend: `p0-money-guards, p1-followup (67), checkout-idempotency, guard-regression, runtime-smoke`.
- **مصفوفة مستهدفة** لكل مرحلة: POS (create/add/remove/payment/split/refund/transfer/close)، Inventory (purchase/sale/recipe/refund/wastage/adjustment)، Accounting (sales/expenses/purchases/COGS/profit)، Employees (login/perms/shift/audit)، Batman (read/insight/report/create/permission-denied/confirmation/audit)، Sync (offline/online/retry/duplicate/conflict)، Data-integrity (orphans/dup/negative stock)، Security (RBAC endpoints، XSS، تنقيح الإدخال، secrets).
- تكامل حي إلزامي (فعلى DB/serber loc او temp DB) قبل كل إصدار — بلا dependence على Supabase لـ unit.

---

## 12) Risk Assessment

| Phase | Risk | Mitigation |
|---|---|---|
| 2 (services) | كسر checkout/void | الاختبارات idempotency تُشغَّل قبل/بعد؛ freeze POS hot path |
| 3-4 (dashboard/reporting) | أرقام مغايرة للواقع | موازنة AdminAnalytics vs reportService على نفس الـ rng قبل الانتقال؛ مرجعية live-parity |
| 5 (inventory/costing) | تغيّر تكلفة المنتجات الماضية | noop على البيانات التاريخية؛ حساب الفرق يُطبَّق على الحركات الجديدة فقط |
| 6 (RBAC) | قفل غير مقصود على موظف نشط | ترحيل seeds idempotent + خروج فعلي بلوحة تحكم عند التعليق |
| 7-9 (Batman) | LLM بتصرف خاطئ | confirmation + fail-closed + whitelist tools + escHtml إلزامي |
| 10 (sync cleanup) | فقدان صفوف في الطابور | نسخة مفتاح منفصلة + مراجع انتقائية؛ لا حذف دون backup |
| Cloud (RPC/v2) | تطبيق v2 على قاعدة حية | تعطيل حتى تأكيد preflight (sync_id فريد) + اختبار على قاعدة مؤقتة ثم تبديل |

---

## 13) Rollback Plan

- git: نقاط تستعيد آمنة قبل كل مرحلة (branch/tag)، وكل تعديل **في مراحله الخاصة** وحده.
- DB: النسخ الاحتياطية القائمة `backup.ts` + `scripts/backup-github.cmd`؛ ترحيلات SQLite → schema_migrations تعيد التراجع (migration per phase؛ inverted ops data‑safe).
- Frontend: كل تغيير في صفحة يوضع خلف فلاغ feature (localStorage) مع عودة تلقائية للسلوك القديم عند الفشل.
- Supabase/RPC: لا تنفيذ دون نسخة من مخطط حي + قائمة تحقق (preflight sync-ids، DDL فقط للمفقود، GRANTs المطلوبة).
- نظام اختبار سريع واحد يُشغَّل قبل كل merge: `node backend/test/runtime-smoke.cjs && node c2-tests/run-tests.js && node c2-tests/rpc-v1-checkout-model.cjs`.

---

## 14) لا تلمس (hot paths حتى إثبات غير ذلك)

`index.html` مسارات autosave/checkout/split/void؛ `ai-pos-engine.js` (process/_executeSplitDetails/acquireTableLock)؛ `sync-engine.js` (آلية الطابور)؛ `admin/database.js` أوامر LUCCA local Currency؛ RPC `checkout_order/void_order`؛ منطق idempotency والأقفال الفريدة. أي تعديل عليها يسبقه اختبار regression كامل ويعتمد إثبات استخدام/عدم استخدام.

---

*انتهاء Phase 0 — التنفيذ (Phase 1+) لا يبدأ إلا بتأكيد المستخدم بعد مراجعة هذا المخطط.*