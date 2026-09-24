# تدقيق المرحلة الخامسة — Phase 5 Audit (Inventory / Purchases / Expenses / Suppliers / Accounting)

> المستند: `docs/PHASE_5_AUDIT.md`
> الحالة: **AUDIT ONLY — تقرير قراءة فقط.** لا تغييرات على أي source code. لا commit/push/version bump/migration/dependency.
> آخر checkpoint ثابت: **`ade80af` — fix(auth): stabilize admin login and Ollama runtime**
> حالة العمل قبل إنشاء هذا الملف: `git status --short` نظيف (لا تعديلات).
> التاريخ: 2026-09-24 — المرحلة: **Phase 5 (Audit)**
> المرجعيات: `CANONICAL_REPORTING_CONTRACT.md`, `DATA_OWNERSHIP_MATRIX.md`, `RBAC_MATRIX.md`, `BATMAN_ARCHITECTURE.md`, `ACCOUNTING_MIGRATION_MAP.md`, `ACCOUNTING_CALCULATION_AUDIT.md`, `ADMIN_TARGET_ARCHITECTURE.md`, `DATA_MODEL.md`, `PHASE_4_FINAL_REPORT.md`, `PHASE_4_5_FINAL_REPORT.md`.

---

## 0) حدود هذا التقرير

- هذا تدقيق قراءة فقط للمسارات: **Inventory, Purchases, Expenses, Suppliers, Stock Movements, Recipes, Cost/COGS, Cash Expenses, Accounting integration, Admin Control Center, RBAC, Batman tools, Ollama/Batman integration, Local/Backend/Supabase ownership, idempotency, audit logging, offline/online, legacy financial formulas.**
- كل بند يحمل: `severity` (P0/P1/P2/P3/INFO)، `evidence` (file:line)، `impact`، `recommended direction` (اتجاه مقترح فقط — **ليس** تعليمة تنفيذ كود).
- لا يُنفَّذ أي جزء من التوصيات داخل هذا التقرير؛ التنفيذ يبدأ بعد موافقة منفصلة.
- الملفات المفحوصة: موثقة في `§2`.

---

## 1. Executive Summary

### 1.1 الخلاصة

- الممر المالي الساخن (checkout/void/refund/stock deduction/sync) **سليم بنيوياً وقائم على الحساب السيرفري** (`index.ts` معاملة ذرّية + `applyStockDeduction` + `paymentSyncId` idempotent + منع المخزون السالب `stock.ts:57-87`) — لم يوجد فيه انعكاس عكسي حرج.
- المنع Phase‑1 محفوظ: **وضع Supabase لا يحمل أي طابور مزامنة مالية محلي** (`supabase-db.js:1162` `enableSync` no-op؛ `index.html:5348` `_enqueueOrderSync` مبكر العودة) ✅.
- `reportService` هو الموصّد المرجعي على السيرفر (Phase 4: تهجير 8 أسطح) ✅.
- **الموجودات الحرجة** تُركّز في 5 محاور:
  1. **فجوة RBAC في `/api/sync`**: مخازن `purchases/expenses/suppliers/product_recipes/waste_log` قابلة للكتابة من أي هوية تملك `sync` (كاشير/مطبخ/جهاز) بدون `purchases.write`/`expenses.write` وبدون مصفوفة batman — **SYNC-1** (P1).
  2. **ثنائية عوالم الوصفات**: مخطط `product_recipes` مختلف بين السيرفر (اسم المكوّن) والعميل (`ingredientId`) — **INV-1** (P1)؛ وتبعاً لذلك COGS/الربح يحسب بـ 4 طرق على 4 أسطح فقط واحد منها وصفاتي (**INV-2/14**).
  3. **Purchases/Expenses ليس لهما وجود خدمي متكامل**: لا `status`/دفع (PUR-2)، لا stock‑in سيرفري (INV-6/PUR-3)، لا idempotency (PUR-5/EXP-7)، لا تدقيق سيرفري (PUR-11/12)، المشتريات تُطرح من «الربح» في أسطح عرض (PUR-6).
  4. **تباين صيغة Expected Cash**: العدّادات المحلية تطرح مصروفات/استردادات كل الطرق، والعملاء يكتبون أرقام الإقفال في `/api/daily-shifts` — **EXP-1/2, EXP-3, EXP-11, EXP-21** (P1).
  5. **بوابات Batman ملتفّة في 3 نقاط إدخال دردشة**: `saveExpenseFromText` تُكتب بلا `_decide` — **BM-1/2** (P1).

### 1.2 الإحصاء الموجز (النتائج المعروضة في هذا التقرير)

| Severity | العدد التقريبي | أمثلة |
|---|:-:|---|
| **P0** Critical | 0 | الوجّد عنصر P0 — الممر الحار سليم |
| **P1** High | ~14 | SYNC-1, INV-1, INV-2/14, INV-6, PUR-1..PUR-6, EXP-1/2, EXP-3, EXP-11, EXP-21, BM-1/2 |
| **P2** Medium | ~22 | EXP-5/6/9/12/17, SUP-2/3/4, BM-4/5, INV-3/5, PF-1/2/3, SY-2/7, SE-2/3 |
| **P3** Low | ~10 | INV-8/9/10/11/15, SUP-?, EXP-20, PUR-13, dead code |
| **INFO** | ~8 | PUR-8/15, SUP-5/6, INV-16, BM-8/9/10 |

> ملاحظة: الأرقام «تقريبية» لأن بعض البنود مركّبة (جدول «مصفوفة الحدة» في §16 يعتمد على البنود المعروضة فعلاً).

### 1.3 الحالة النهائية

- **AUDIT COMPLETE — لا تغيير على الكود.** الوحيد المتغير: هذا الملف.
- أُخِذ checkpoint المرجعي `ade80af` وسيبقى دون مساس.

---

## 2. Current Architecture

### 2.1 الوضع المحلي (Local mode)

- **السلطة المالية الحصرية**: backend SQLite على `localhost:3000`.
  - الإقفال/الإلغاء/الاسترداد/خصم المخزون: `index.ts` (معاملة `beginImmediateTransaction` → `applyStockDeduction` → rollback عند النقص → HttpError 409) — ذرّي.
  - حساب إجماليات الطلب سيرفراً دائماً: `crud.ts:159` `serverOrderTotals`.
- **IndexedDB (`lucca_caffe_db` v9)**: الطلبات المفتوحة + مرآة الكتالوج + الإعدادات؛ المزامنة عبر `/api/sync` (newestWins، غموض 5s) + POS SyncQueue + ServerSync.
- **لا دفع محلي** — كتابة الدفعات سيرفر حصرياً (مثبّت `p1-split`).

### 2.2 الوضع السحابي (Supabase mode)

- السلطة الوحيدة: Supabase (PostgREST + RPC `checkout_order`/`void_order`).
- `enableSync` no-op؛ لا طابور مزامنة مالية محلي؛ `_enqueueOrderSync` مبكر العودة. — **مطابق لقرار D6**.
- `deploy/supabase-db.js` نسخة نشر **قديمة** (تحمل `enableSync` القديم — **SY-7**).

### 2.3 منطقة الإدارة

- **الهدف**: `admin/control-center.html` (16 قسماً) → `AdminApi` → `/api/cc/*` (خدمات + ترقيم `pageResult` + أخطاء سيرفرية `errors.ts`).
- **التراث**: `admin/index.html` (لوحة قديمة، كتابة IndexedDB مباشرة) لا يزال فاعلاً في عدة مجالات (انظر §8).
- `reportService` = موصّد الأرقام؛ الواجهات تقرأ منه أو تطابق بدقة parity.

### 2.4 Batman / Ollama

- سلسلة إلزامية: User → Batman (نية) → Permission (`decide()`) → Tool Registry → Business Service → Repository → DB → result مؤكَّد → Batman.
- Ollama = طبقة NI/NLU فقط؛ لا SQL من LLM، لا كتابة مباشرة من أداة، لا تخزين مستقل. مصفوفة batman تُنفَّذ سيرفراً `migrations/001_batman_permissions.sql` via `permissionService.decide()`.

---

## 3. Inventory Findings

المرجع (عقد): `CANONICAL_REPORTING_CONTRACT.md §1.2` — COGS = recipe-first → `products.cost` → `null` (لا اختراع 0).

| ID | Sev | الموقع (file:function:line) | الوصف | الأثر | اتجاه مقترح |
|---|---|---|---|---|---|
| **INV-1** | P1 | `admin/database.js:328-332,1830-1848`؛ `admin/index.html:3931-3935` (عميل) مقابل `backend/schema/schema.sql:465-475`؛ `backend/src/index.ts:886-900` (سيرفر) | **تعارض مخطط الوصفات**: السيرفر `product_recipes(ingredient=اسم)` بينما العميل `product_recipes(ingredientId, quantityNeeded)`. وصفات العميل لا تصل للسيرفر كأعمدة معروفة (تُسقط أثناء المزامنة)، وصفات السيرفر غير مرئية للعميل (`ingredientId` غائب → cost=0). `stockDeductionPlan` السيرفرية (حسب الاسم) تتجاوز وصفات العميل صامتةً | تكلفة البيع والخصم من المخزون يتجاهلان وصفات معظم المستخدمين؛ أرقام تختلف بين الأجهزة | توحيد الوصفات على معادّل واحد (السيرفر هو مصدر التأليف) + ترجمة أعمدة أثناء push/pull + توسيع القراءات العميلة لتقرأ صفوف السيرفر |
| **INV-2** | P1 | `admin/admin-analytics.js:206-237` (يستهلكه `admin/index.html:2756,3654,4117,4966+`) | **الربح/تكلفة الطعام على الواجهة محسوب من `products.cost` فقط** (`costedCost += num(p.cost)*qty`)، والغذاء ذو وصفة لكن `p.cost<=0` يُحسب `missingCost` | GP/هامش لوحة الإدارة ≠ GP السيرفر (الوصفاتي) لنفس الفترة | إعادة التوجيه إلى دالة وحدة تكلفة واحدة على العميل تطابق `getProductUnitCost` |
| **INV-3** | P2 | `ai-pos-engine.js:2303-2315,2322-2359` | **COGS فترة في أدوات الدردشة = مجموع المشتريات** (`cogs = p.total`) يشمل أصنافاً غير مكوّنات | إجابات الدردشة تتعارض مع تقارير السيرفر | استبدال تقريب المشتريات بدالة الوحدة المشتركة |
| **INV-4** | P2 | `index.html:7095` (مراقبة تكلفة) و`index.html:6224` (بطاقة المنتج) | `fc=(p.cost||0)*st.sold` — لا يأخذ الوصفات | نسبة تكلفة الطعام مضللة | مشاركة دالة وحدة التكلفة الوصفاتية |
| **INV-5** | P2 | `admin/database.js:1644` | `Inventory.adjustStock` يثبّت سالباً بـ `Math.max(0, oldQty+qty)` صامتاً بينما سجل الحركة يحفظ الفرق الكامل — تباعد بين دفتر الحركات والكمية الحقيقية | خسائر إسناد مخزون صامتة | رفض السالب سيرفراً وعميلاً بصورة موحّدة |
| **INV-6** | P1 | `purchaseService.ts:47-60`؛ `admin/database.js:1709-1711` | **المشتريات لا تُدخل تزويداً للمخزون سيرفراً** — الزيادة تحدث عميلاً فقط وعند وجود `inventoryItemId`؛ مشتريات `/api/cc/purchases` و`/api/sync` لا ترفع المخزون | انجراف مخزون متعدد الأجهزة | إما stock‑in سيرفري مرتبط بعنصر مخزون (اسم/معرف) أو إزالة الزيادة العميلة التلقائية |
| **INV-7** | P3 | `admin/database.js:1669-1693`؛ `supabase-db.js:857`؛ `deploy/supabase-db.js:485` | **`deductForCheckout` كود ميّت** (بدون أي موضع استدعاء حي؛ يفترض مخطط IDB قديم وكسر السالب) | خطر في حال إعادة تفعيله | إزالة/تمييز صريح كميّت |
| **INV-8** | P3 | `stock.ts:65-79`؛ `inventoryRepo.ts:137-145` | **`stock_movements.productId` غامض**: أسطر البيع تحمل معرف المنتج والحركات اليدوية معرف المخزون — `COALESCE`-join قد يخلط | تسمية خاطئة في واجهة الحركات | توحيد دلالة الأعمدة (معرف مخزون + productId اختياري) |
| **INV-9** | P3 | `admin/database.js:1648,1734`؛ `index.ts:886-900` | حركات العميل بمفتاح `ingredientId` والسيرفر بـ `productId`؛ المزامنة تسقط `ingredientId` | حركات السيرفر غير مقروءة في لوحات العميل | alias/خريطة بعمودان في المزامنة |
| **INV-10** | P3 | `crud.ts:401-415` مقابل `index.ts:686-688`؛ `ordersRepo.ts:136-141` | استرداد جزئي عبر CRUD لا يقلب `paymentStatus`؛ `paidOrderItemsBetween` يشترط `paid` → طلب مسترد جزئياً يبقى في COGS بينما استرداده خُصم من صافي المبيعات | GP الناتج مُحقق على الاسترداد الجزئي | استبعاد كميات المسترد عبر `refunds` أو قلب `paymentStatus` في CRUD |
| **INV-11** | P3 | `ordersRepo.ts:178-184` | `cogsFor` القديمة (Σ `p.cost`×qty) باقية بلا مراجع | انجراف كود ميّت | إزالة |
| **INV-12** | INFO | `ordersRepo.ts:164-169`؛ `analytics.ts:104-114` | `topProducts` يعرض alias `costPrice=COALESCE(p.cost,0)` رغم أن الربح يُعاد حسابه بـ `getProductUnitCost` | مخاطر سوء استعمال مستقبلية للمستهلكين الذين يقرأون `costPrice` | عدم تصدير alias خام |
| **INV-13** | INFO | `admin/database.js:3016-3023` | مساعدا `getFoodCost/getGrossProfit` على العميل مبنيان على `p.cost` | متسق مع تحيز INV-2 | توحيد |
| **INV-14** | P1 | `reportService.ts:252-291` و`analytics.ts:45-69` مقابل `admin-analytics.js:206-237` مقابل `ai-pos-engine.js:2306-2346` مقابل `index.html:7095` | **4 تنفيذات مستقلة لـ COGS/GP؛ 3 منها غير وصفاتية** — أرقام نفس الفترة تختلف بين الأسطح بالتصميم | أخطر خاصية ارتباك محاسبية | قناة واحدة وصفاتية + اختبار parity |
| **INV-15** | P3 | `schema.sql:422` (`costPrice`) مقابل `database.js:1845` (`cost/costPerUnit`) مقابل `admin-analytics.js:200,204` مقابل `ai-pos-engine.js:2228-2241` | ترجمة اسم حقل تكلفة المخزون عبر المزامنة جزئية (فقط `price→unitPrice` مُعرَّف) | تكلفة معدّلة على جهة قد لا تقرأ على الأخرى | ترجمة أعمدة كاملة |
| **INV-16** | INFO | `stock.ts:53-88`؛ `index.ts:534-619` | إيجابي: الخصم السيرفري ذرّي، idempotent (تفريغ سطر مبيعات مكرر)، و409+rollback عند النقص | — | إبقاءه |

**إجابات مقررة (Audit A):**
- أين يُخزَّن المخزون/الحركات: `inventory` + `stock_movements` (سيرفر) / IndexedDB (مرآة عرض). من مصدر الحقيقة: **السيرفر للكتابة المالية**، العميل مرآة عرض.
- من يحسب current stock / inventory value: سيرفراً `inventoryRepo.qty×costPrice` + `inventoryService.getStockValue`؛ عميلاً `AdminAnalytics` + عدّادات محلية — **حساب مكرر**.
- purchase stock-in: عميل فقط (INV-6). recipe deduction: سيرفرا عبر `stockDeductionPlan` اسم المكوّن (ويرث ثغرة INV-1).
- `allowNegativeStock` gate سيرفري (409 + rollback) — لكن العميل يثبّت سالباً صامتاً (INV-5).

---

## 4. Purchases Findings

نظرة سريعة للمخطط: `db.ts:440-452` purchases(id, name, item, quantity, costPrice, total, supplier, notes, date, createdAt, createdBy) — **لا status/paymentMethod/paid**.

| ID | Sev | الموقع | الوصف | الأثر | اتجاه مقترح |
|---|---|---|---|---|---|
| **PUR-1** | P1 | `purchaseService.ts:55`؛ `controlCenter.ts:395-398` | **السيرفر يثق في `total` القادم من العميل** بلا موافقة `quantity×costPrice` (حارس فقط: سالبيات و regex تاريخ) | أي حامل `purchases.write` يقيد أي إجمالي | إعادة حساب الإجمالي سيرفراً (limitـي/مقسّم) |
| **PUR-2** | P1 | `db.ts:440-452`؛ `db.ts:738` | **لا حالة دفع/شحن للمشتريات**؛ أعمدة `suppliers.balance/paid` ميتة | لا تتبع ذمم/آجل للموردين | إضافة `status`/`paymentMethod` ضمن عقد مخطط معتمد (تغيير schema — مؤجل للموافقة) |
| **PUR-3** | P1 | `supplierRepo.ts:103-112`؛ `admin/database.js:1709-1711` | نفس **INV-6**: إنشاء المشتريات سيرفراً لا يكتب `stock_movements` ولا يزيد المخزون | انجراف مخزون | stock‑in سيرفري (مع INV-6) |
| **PUR-4** | P1 | `database.js:1714`؛ `admin/index.html:4044-4046` | **حذف مشتريات العميل لا يعكس حركة التزويد** (`Inventory.adjustStock('purchase')`) الصادرة عند الإضافة | مخزون متضخم بلا حركة مقابلة (معزول) | حذف = عكس الحركة أو void |
| **PUR-5** | P1 | `db.ts:797-817`؛ `supplierRepo.ts:105`؛ `database.js:1699-1713` | **لا idempotency/حماية تكرار للمشتريات**: لا `syncId` فريد، إدخالات السيرفر بلا `syncId`، مسار الـ Admin UI لا يختم `syncId` | إعادة محاولة/نقر مزدوج → صفوف مكررة | مفتاح idempotency + index فريد على `syncId` |
| **PUR-6** | P1 | `ai-pos-engine.js:2432`؛ `batman-dashboard.js:772-773,864-865,1329`؛ `index.html:7173` | **المشتريات تُطرح من «الربح/صافي الربح» في 4 أسطح عرض** (بجانب المصروفات) — مخالفة صريحة للعقد «المشتريات تحويل أصول لا مصروف» | «الربح» في الدردشة/اللوحة يختلف جوهرياً عن P&L الرسمي | إزالة طرح المشتريات من معادلات الربح العرضية + وسم «قبل تكلفة البضاعة» عند الحاجة |
| **PUR-9** | P1 | `index.ts:814,824-843`؛ `crud.ts:46,69`؛ `auth.ts:153-158` | **أي هوية بصلاحية `sync` تكتب المشتريات والموردين عبر `/api/sync`** متجاوزة `purchases.write` وقاعدة الموردين الإدارية ومصفوفة batman (عتبة 1000) | مسار كتابة غير حارس للالتزام يحدد مبالغ ويهرّب الموافقة | إغلاق التحقق في مسار المزامنة حسب المخزن (نفس **SYNC-1**) |
| **PUR-10** | P2 | `batmanController.ts:110-115` | `/api/batman/check` يقبل `role` من body لهويات الـ device — قابل للتزييف (`role:'admin'`) | الطبقة الاستشارية قابلة للتزوير | اشتقاق الدور سيرفراً من الهوية فقط |
| **PUR-11** | P2 | `controlCenter.ts:392-403`؛ `index.ts:849+` (مزامنة) | كتابات المشتريات عبر CC والمزامنة **غير مسجلة في `audit_logs`** (الاستثناء: مسار الذكاء الصناعي `_recordBatmanDecision`) | لا أثر تدقيق لكتابات CC/mizza | تسجيل تدقيق عند كل كتابة مميزة |
| **PUR-12** | P2 | `database.js:1699-1714`؛ مقابل `Expenses.add` (`2539/2522`) | إضافة/حذف مشتريات في Admin UI المحلي **بلا تدقيق ولا دفع سيرفري** (على عكس المصروفات) | غياب الأثر الإداري | توحيد سلوك المصروفات |
| **PUR-13** | P3 | `reports.ts:14-19`؛ `controlCenter.ts:184-189` | لا endpoint تقارير مشتريات مستقل — فقط عبر `/api/cc/purchases` وأداة الدردشة | قصور تقارير | إضافة تقرير مشتريات |
| **PUR-14** | P2 | `admin/index.html:4030-4042`؛ `batman-dashboard.js:251-258`؛ `index.html:7165`؛ `ai-pos-engine.js:1925-1927` | **إجمالي المشتريات نفسه يُعرض بأرقام مختلفة على أسطح مختلفة** (بعضها بلا `total` → يعود 0؛ بعضها يعيد الحساب من `qty×costPrice`) | تباين إجماليات | توحيد مصدر الإجمالي + ترسيخ `total` سيرفراً |
| **PUR-15** | INFO | `database.js:2205-2255` + `onupgradeneeded` | كائن/نموذج `ExpenseCategories` موجود لكن **لا `createObjectStore('expense_categories')` في أي مكان** | لا فئات حقيقية سيرفراً/عميلاً | إنشاء المخزن ضمن عقد المخطط |

---

## 5. Expenses Findings

مخطط `db.ts:479-489` expenses(id, description, category TEXT DEFAULT 'أخرى', amount, notes, date, createdAt, createdBy, paymentMethod DEFAULT 'cash') — **لا syncId ولا supplier ولا employeeId**.

| ID | Sev | الموقع | الوصف | الأثر | اتجاه مقترح |
|---|---|---|---|---|---|
| **EXP-1** | P1 | `database.js:2070-2083`؛ `supabase-db.js:1012-1022` | **الحاسبة المحلية للدرج تطرح مصروف كل الطرق من الـ cash**: `totalExpenses += amount; currentCash -= amount` بلا فحص `method` | مصروف بطاقة/بنك يُخرج نقداً من الدرج | فلترة by method (`cash/كاش/نقدي` فقط) |
| **EXP-2** | P1 | `database.js:2074-2083`؛ `supabase-db.js:1016-1022`؛ `index.html:5037` | استرداد بطاقة يُطرح من الـ expected (الطرح `totalRefunds` غير مشروط بالطريقة بينما `currentCash` يطرح نقداً فقط) | expected ناقص لاستردادات غير نقدية | فصل refunds بطريقة نقدية فقط في معادلة الـ cash |
| **EXP-3** | P1 | `database.js:2521-2528`؛ `db.ts:488` | **العميل يُسقط `paymentMethod` من payload السيرفر** → الخادم يضع `'cash'` افتراضياً؛ مصروف بنك/كارت خارج الاتصال يصبح نقدياً سيرفراً | `cashExpensesTotal`/`getCashExpected` تقلّان | تمرير الطريقة + schema (مؤجل للموافقة) |
| **EXP-4** | P2 | `ai-pos-engine.js:2944-2948` | كل ما غير نقدي ينهار إلى `'bank'` في استخراج المصروف من النص؛ ترتيب الفحوص يجعل نصاً ممتزجاً يُصنَّف خطأ | تصنيف طريقة الدفع من الدردشة غير دقيق | توسيع مرادفات طرق الدفع + ترتيب منطقي |
| **EXP-5** | P2 | `db.ts:482`؛ `expensesRepo.ts:71`؛ `ai-pos-engine.ts:2960`؛ `control-center.html:1203` | **الفئة نص حر بثلاث قيم افتراضية متضاربة ولا يوجد جدول `expense_categories`** | تقارير الفئات تجمع نصوصاً عشوائية؛ غير قابلة للتدقيق | مخطط فئات (مؤجل للموافقة) |
| **EXP-6** | P2 | `expensesRepo.ts:74`؛ `ai-pos-engine.ts:2962`؛ `database.js:2514` | تاريخ المصروف UTC ISO — مصروف 00:30 محلياً (UTC+3) يُؤرَّخ لليوم السابق | تحوّل خارج نافذة اليوم النقدي | تخزين التاريخ المحلي أو تحويل أسبوع |
| **EXP-7** | P1 | `expenseService.ts:36-38`؛ `expensesRepo.ts:65-77`؛ `index.ts:905-916` | **لا idempotency للمصروف**: جدول بلا `syncId`، POST عادي، والبديل خارج الاتصال + طابور إعادة المحاولة → **صفان على السيرفر** (POST + مزامنة لاحقة) | تكرار مصروفات بشبكة غير مستقرة | مفتاح idempotency + index فريد |
| **EXP-8** | P1 | `database.js:2554-2562`؛ `controlCenter.ts:385-389` | **حذف المصروف لا يعكس عدّادات الدرج/الوردية** (`totalExpenses`/`currentCash`/daily_shifts)؛ حذف بعد الإقفال يكسر المتوقّع | expected ناقص دائم بعد أي حذف | void بدل حذف + عكس العدّادات |
| **EXP-9** | P2 | `expensesRepo.ts:19-25`؛ `controlCenter.ts:373-383` | فلتر `paymentMethod='cash'` حرفيّ والقيم السيرفرية غير محصورة | مجموعة «مصروفات نقدية» غير دقيقة → انجراف `getCashExpected` | قيود القيم الكنسية |
| **EXP-10** | P2 | `reportService.ts:293-309` | لمدى متعدد الأيام: `opening` من `dailyShift(from)` و`actual` من `dailyShift(to)` — أسس غير متطابقة | expected متعدد الأيام غلط (اليوم الواحد سليم) | اشتقاق per-day |
| **EXP-11** | P1 | `special.ts:49-119`؛ `database.js:2720-2734`؛ `admin/index.html:3748-3768` | **`/api/daily-shifts` تقبل أرقام الإقفال من العميل كما هي** (INSERT OR REPLACE بلا حساب سيرفري)؛ `DailyShifts.close` المحلي يحسب expected **بلا استردادات ومع `totalExpenses=0`** (`record` ليس له استدعاء) | شاشتا إدارة مخزّنتان أرقاماً متعارضة لنفس اليوم | إعادة حساب سيرفرية حصرية عند الإقفال |
| **EXP-12** | P2 | `auth.ts:153-158`؛ `index.ts:843`؛ `crud.ts:64-73`؛ `crud.ts:51-58` | المصروفات غير محصورة في `ADMIN_ONLY_STORES` → أي حامل `sync` (بوsk/mطبخ/جهاز) يكتب/يقرأ المصروفات عبر المزامنة، والقراءة عامة عبر CRUD رغم أن `expenses.read` للمدير | قراءة/كتابة غير مخوّلة على مستوى المزامنة | امتداد **SYNC-1** للمصروفات |
| **EXP-13** | P1 | `index.html:2318-2331`؛ `supabase-db.js:978-1025`؛ `auth.ts:157` | إقفال درج POS محلي فقط؛ `cash_registers` في المزامنة إدارية حصراً؛ `recordManualInvoice/checkoutToServer` لا تستدعي `recordTransaction` | تمثيلان منفصلان لنفس النقد بدون توحيد | توحيد اشتقاق الـ cash سيرفراً |
| **EXP-14** | P2 | `ai-pos-engine.js:2432,2514,2441` | أداة اليوم تُسمّي «الربح التقديري» = `net − expenses − purchases` (المشتريات تطرح) في حين P&L الرسمي لا يطرح | «الربح» في الدردشة/CSV ≠ الربح الرسمي | إعادة تسمية/إصلاح الصيغة (مع PUR-6) |
| **EXP-15** | P3 | `database.js:2122-2131,2153-2154` | `netCash = totalCash − totalExpenses − totalRefunds` بلا `opening` وكل الطرق؛ تغذّي `batman-dashboard.js:330,486` | أرقام صافٍ/ربح محلية مضللة | توحيد مع المعادلة الكنسية |
| **EXP-16** | P2 | `controlCenter.ts:373-383`؛ `expensesRepo.ts:67` | `/api/cc/expenses` يتجاهل `notes`؛ لا عمود supplier/receipt/employeeId (فقط `createdBy`) | أثر مرجعي ناقص سيرفراً | دقة الحقول (مؤجل للموافقة) |
| **EXP-17** | P2 | `index.html:2353-2354`؛ `ordersRepo.ts:111-117` | POS يرسل `name_en/name_ar/name` كطريقة دفع؛ السيرفر يفلتر `'cash'` حرفياً → مدفوعات نقدية حقيقية تُستثنى؛ `split` لا يدخل cash | Expected Cash أقل من الواقع للكرّات | قائمة طرق دفع كنسية سيرفراً |
| **EXP-18** | INFO | `reportService.ts:25-31,218,296-298` | إيجابي: `getCashExpected` يستخدم `cashRefundTotal` فقط (النقدي) — مطابق للعقد | — | إبقاء |
| **EXP-19** | P2 | `db.ts:488`؛ `crud.ts` | مسار CRUD العام يكتب أعمدة عشوائية حاضرة → قيم `paymentMethod` غير محصورة | نفس EXP-9 | قيود كنسية |
| **EXP-20** | P3 | `database.js:2070-2077` مقابل `2061-2069` | عدم تماثل: مصروف بنك يفرغ `currentCash` بينما استرداد بنك لا يعيده | عدم تماثل منطق الدرج | توحيد المنطق |
| **EXP-21** | P1 | `auth.ts:136`؛ `crud.ts:37-48`؛ `index.ts:869-883` | **الكاشير يستطيع POST سجلات `cash_registers` عبر CRUD** (لا `WRITE_ADMIN_STORES` عليها) بما فيها إقفال بأرقام مفبركة (فقط حارس «وردية واحدة مفتوحة» موجود) | اختلاق إقفالات نقدية | تقييد كتابة `cash_registers` بالأداريب/المدير |
| **EXP-22** | P2 | `db.ts:479-489`؛ `expensesRepo.ts:34-39`؛ `database.js:2517-2521` | الإسناد الموظفي للمصروفات يتم عبر نص `createdBy` حر بلا employeeId | كسر الإسناد عند تغيّر الأسماء | عمود employeeId (مؤجل) |
| **EXP-23** | P2 | `index.html:5021-5062` | إلغاء POS خارج الاتصال يكتب `refunds` المحلي وهوية محدودة لا تستطيع مزامنة `refunds` (إدارية) — بينما `paymentStatus:'refunded'` يتمزامن | سيرفر يعرض طلباً مسترداً بلا سطر استرداد | إرسال الاسترداد عبر خدمة سيرفرية |

---

## 6. Suppliers Findings

| ID | Sev | الموقع | الوصف | الأثر | اتجاه مقترح |
|---|---|---|---|---|---|
| **SUP-1** | P1 | `crud.ts:30-32,69`؛ `auth.ts:153-158`؛ `index.ts:824-843` | الموردون إداريون عبر CRUD/CC لكن **أي حامل `sync` يكتبهم عبر `/api/sync`** (مخزن غير محصور) | إنشاء موردين مخوّليه | ضمن **SYNC-1** |
| **SUP-2** | P2 | `db.ts:735-740`؛ `database.js:317-318`؛ `ai-pos-engine.js:1906-1919,1972-1978` | **لا منع تكرار الموردين**؛ مسار الذكاء ينشئ مورّداً جديداً عند تأكيد مشتريات بمطابقة ضبابية قد تفوّتها | «شركة الأمل»/«شركة الامل» مكرر | فحص فريد + توحيد المطابقة |
| **SUP-3** | P2 | `admin/index.html:3903`؛ `database.js:1727`؛ `crud.ts` (DELETE عام) | **حذف مورد بلا حراسة مرجعية ولا تدقيق** — المشتريات تستشهد به نصاً وتبقى معزولة | تاريخ يتفكك عند الحذف | حظر حذف مورّد له سجلات أو استبدال نصي بـ FK |
| **SUP-4** | P3 | `supplierRepo.ts:22-39,41-58` | تجميع الموردين عبر `LEFT JOIN ... ON suppliers.name = purchases.supplier` — إعادة تسمية المورد يفصل السجل المحفوظ | تقارير الموردين تنفصل عند أي تعديل اسم | ربط بالمعرف لا بالنص |
| **SUP-5** | INFO | `db.ts:738` | `suppliers.balance/paid` أعمدة ميتة بلا قراءة/كتابة | لا بُعد ذمم للمورد | تأجيل أو اكتمال ضمن مخطط الموردين |
| **SUP-6** | INFO | `admin/index.html:2198`؛ `database.js:2539`؛ `db.ts:479-489` | واجهة المصروف تعرض حقل مورد محلي فقط؛ السيرفر بلا عمود supplier والمصدر العميل يسقطه (EXP-3) | نسبة مصروفات للمورد لا تصل سيرفراً | ضمن EXP-16 |

---

## 7. Recipes / COGS Findings

**القاعدة المرجعية المفروضة (الموجبة):**
1. Recipe-first (`Σ ingredient.qty × inventory.costPrice`) ← 2. `products.cost` ← 3. `null` (بلا اختراع 0).

| # | الموضع | الصيغة | الحالة مقابل القاعدة |
|---|---|---|---|
| 1 | `reportService.getCOGS` :252-268 | `Σ qty×getProductUnitCost` + completeness | ✅ مطابق |
| 2 | `reportService.getGrossProfit/getOperatingProfit` :270-291 | NetSales − COGS؛ −expenses | ✅ null عند نقص |
| 3 | `analytics.ts /dashboard/top-products` :99-117 | `getProductUnitCost` | ✅ |
| 4 | `inventoryService.getProductUnitCost` :81-99 | recipe→costPrice→products.cost→null | ✅ |
| 5 | `ai-pos toolGetProductCost` :2252-2284 | recipe عبر client؛ ثم `p.cost`؛ **افتراضي 0** | ❌ يقع إلى 0 لا null |
| 6 | `ai-pos` COGS فترة :2303-2359 | `cogs = p.total` (مشتريات) | ❌ مشتريات ≠ COGS |
| 7 | `ai-pos toolGetDailySummary` :2421-2443 | `profit = s.net − ex.total − p.total` | ❌ طرح مزدوج |
| 8 | `index.html` مراقبة تكلفة :7080-7110 | `fc=(p.cost\|\|0)×sold` | ❌ تكلفة منتج فقط |
| 9 | `AdminAnalytics.compute` :207-237 | `costedCost += num(p.cost)*qty` (يستبعد `p.cost<=0`) | ❌ تكلفة منتج فقط |
| 10 | `index.html:6224` بطاقة المنتج | `Number(p.cost\|\|0)` | INFO عرض |
| 11 | `database.js:3016-3023` getFoodCost/getGrossProfit | مساعدات p.cost | INFO |
| 12 | `batman-dashboard.js:429-439` تقييم الهالك | `inventory cost` | ✅ |

**الخلاصة:** 12 موضعاً يحسب التكلفة/الربح؛ **4 متطابقة و8 منحرفة**. المسار الوحيد الوصفاتي المتصل بالسيرفر هو reportService+analytics؛ أسطح العرض (AdminAnalytics/الدردشة/POS) لا تستخدمه. المراجع مركّبة في **INV-2 / INV-14 / INV-3 / INV-4 / PUR-6**.

---

## 8. Admin Findings

### 8.1 تغطية Control Center (سيرفرية عبر `/api/cc/*`)

| المجال | القسم في CC | قراءة/كتابة | ملاحظات |
|---|---|---|---|
| Dashboard | `renderDashboard` :373 | قراءة | من `/api/cc/dashboard` |
| Orders | :411 | قراءة | + تفاصيل طلب |
| Tables | :488 | قراءة/كتابة | POST/PUT/DELETE مكتوبة |
| Categories | :960 | قراءة/كتابة | — |
| **Products** | :511 | قراءة/كتابة | **+ محرّر وصفات** `PUT /api/cc/products/:id/recipes` (:1042-1096) |
| Payment methods | :1000 | قراءة/كتابة | — |
| **Stock (Inventory)** | :536 | قراءة/كتابة | إضافة/تحديث/تسوية/هالك/حذف (`inventory.write`) |
| **Movements (Stock Movements)** | :565 | **قراءة فقط** | لا write |
| **Purchases** | :584 | قراءة/كتابة | POST/DELETE (`purchases.write`) — بلا stock‑in (INV-6) وبلا تدقيق (PUR-11) |
| **Expenses** | :609 | قراءة/كتابة | POST/DELETE (`expenses.write`) — حذف بلا عكس عدّادات (EXP-8) |
| Employees | :639 | حضور/انصراف فقط | لا إدارة موظفين |
| **Suppliers** | :670 | **قراءة فقط** | **لا write في CC** — الوحيد إداري/التراث |
| **Cash / Shifts** | :684 | قراءة/كتابة | فتح/إقفال `/api/cc/shifts/*` (سيرفري — النمط صحيح) |
| Reports | :711 | قراءة | sales/expenses/inventory/employees/suppliers |
| Knowledge / System | — | قراءة | — |

### 8.2 ما زال تراثياً/مغيباً من CC

| البند | الحالة |
|---|---|
| **Supplier الكتابة** في CC | **غائب** — لا قسم إدارة موردين كتبياً |
| **Expense Categories** | **غير موجود** كمخزن/جدول ولا قسم CC (انظر EXP-5/PUR-15) |
| **Stock Movements كتابة** | غائب تعمّداً (الحركات مشتقة السيرفرية) |
| `admin/index.html` التراث | ما زال يكتب للمخزون/الموردين/المشتريات/المصروفات IndexedDB مباشرة (`database.js` CRUD + `deleteSupplier`/`deletePurchase`/`deleteExpense`؛ أدوار المستخدمين `index.html:4309`) |
| `admin/dashboard.html` | لوحة رقمية سيرفرية + المؤقّت 10s (PF-2) |
| `admin/admin-analytics.js` | محاسب عميل IndexedDB — المرجع المحلي (توحيد مؤجل — §15) |

### 8.3 استنتاج Admin

- CC أصبح الغلاف الفاعل لكل القراءات ومعظم الكتابات عبر خدمات سيرفرية. الفجوات: **موردون (قراءة فقط)، فئات المصروفات (لا وجود)، سجل حركات (قراءة فقط)**، والاعتماد المتبقي على admin/index.html التراثي لكتابات خارج `/api/cc`.

---

## 9. RBAC Findings

### 9.1 الأدوار الحقيقية من الكود (`auth.ts:119-150`) — موثّقة لا مفترضة

| الدور | الصلاحيات (من الكود) |
|---|---|
| **admin** | `['*']` |
| **manager** | orders/write, checkout, payments.write, refunds.write/void, customers, categories, products, inventory.read/write, **purchases.write**, **expenses.read/write**, employees.read/write, attendance, shifts, reports.read, settings.read, daily-shifts.read/write, cash-registers.read/write, audit.read, sync, users.read |
| **cashier** | orders.read/write, checkout, payments.write, customers, categories.read, products.read, inventory.read, cash-registers.read/write, sync |
| **kitchen** | orders.read/write, products.read, categories.read, sync |
| **device** | sync, checkout, orders/item.read, customers, tables, categories.read, products.read, inventory.read, payments.read/write, settings.read, daily-shifts.read |

### 9.2 الحواجز الثانوية الموجودة (`crud.ts`)
- `STORE_WRITE_PERM` (:37-48) — يولّد حارس الكتابة لكل مخزن.
- `WRITE_ADMIN_STORES` (:30-32) = users, settings, audit_logs, daily_shifts, shifts, suppliers, stock_movements, inventory_alerts → إداري/مدير.
- `ADMIN_ONLY_STORES` (`auth.ts:153-158`) — لمزامنة التطبيقات فقط: users, settings, audit_logs, daily_shifts, shifts, invitations, payments, refunds, inventory, stock_movements, cash_registers.

### 9.3 النتائج (شواغل رئيسية)

| الاهتمام | الوصف | الأساس |
|---|---|---|
| **SYNC-1** | `/api/sync` يتطلب `sync` فقط؛ `purchases/expenses/suppliers/product_recipes/waste_log` خارج `ADMIN_ONLY_STORES` → كتابة غير خاضعة التحكم من كاشير/مطبخ/جهاز | `index.ts:814,824-847` |
| **EXP-12** | قراءة عامة للمصروفات عبر CRUD رغم نطاق `expenses.read` للمدير | `crud.ts:51-58` |
| **EXP-21** | cashier يكتب `cash_registers` عبر CRUD | `auth.ts:136`;`crud.ts:37-48` |
| **BM-4** | `/api/batman/check` يقبل دور client للهويات الجهازية | `batmanController.ts:110-115` |
| **RB-BLOCKED** | `editUserRole` التراثي يكتب `users.role` في IndexedDB مباشرة (`index.html:4309`) — خارج الحارس (موثّق BLOCKED حتى توحيد الأدوار) | `RBAC_MATRIX §5`; `index.html:4309` |
| شرط الأمان | السيرفر لا يثق بـ UI — CC يعلّق على `401/403/0`؛ الأرباح `null` لغير المدير | `controlCenter.ts:130-135` |

### 9.4 تحقق Nothing-Badyecker (المسار المطلوب)
- لا يوجد `LLM → SQL` (لا توليد استعلام) ✅
- لا يوجد كتابة مباشرة من أداة إلى SQL سيرفر ✅ (كتابات أدوات الذكاء تمر عبر خدمات العميل أو `/api/cc`)
- لكن: **مسارات دردشة المصروفات تتجاوز `decide()`** (BM-1/2) — فقدان لطبقة الموافقة لا للكتابة المباشرة.

---

## 10. Batman Findings

### 10.1 الجدول العام للأدوات (في نطاق Phase 5)

| الأداة | المصدر | Rule/LLM | صلاحية/decide | قراءة/كتابة | مسار الكتابة | تدقيق | Idempotency | Offline | يحتاج Ollama |
|---|---|---|---|---|---|---|---|---|---|
| view_inventory | ai-pos:595 | Rule | — | قراءة | — | — | — | نعم | لا |
| getLowStock / getTopProducts | batman-questions:722-742 | Rule (AdminAnalytics) | manager via ask | قراءة | — | — | — | نعم | لا |
| update_price | ai-pos:1510-1562 | Rule | decide('update_price') minRole manager | كتابة | `Products.update` | logAudit+decision | eventId | نعم (fail-closed) | لا |
| add_expense (مسار المحرك) | ai-pos:2849 | Rule | `_decide('add_expense', مبلغ)` | كتابة | `Expenses.add` + `/api/cc/expenses` | نعم | eventId | نعم | لا |
| add_expense (مسارات الدردشة) | batman-dashboard:1237؛ index.html:6424,7297 | Rule | **بدون decide (BM-1/2)** | كتابة | `saveExpenseFromText → Expenses.add` | نعم جزئياً | eventId غائب في مسار الدردشة | نعم | لا |
| record_invoice | ai-pos:1645 | Rule | decide('record_invoice') | كتابة (server checkout) | `/api/orders/:id/checkout` + paymentSyncId | تعديلات checkout | paymentSyncId | يتطلب السيرفر | لا |
| add_purchase | ai-pos:1790-1941 | Rule (+ LLM parse اختياري) | decide('add_purchase', draft.total) | كتابة | `Purchases.add` + إنشاء مورد | نعم | eventId (batman) | نعم بعد الموافقة | لا (fallback regex) |
| suppliers (إنشاء ضمن مشتريات) | engine :1909 | Rule | purchases.write/suppliers.add | كتابة | `Suppliers.add` | نعم (:1915) | — | نعم | لا |
| drawer_status | ai-pos:607 | Rule | — | قراءة | — | — | — | نعم | لا |
| sales/expenses_report/daily_summary | ai-pos:598-608 | Rule (DB) | — | قراءة | — | — | — | نعم | لا |
| getSystemHealth | batman-questions:745+ | Rule | manager | قراءة | — | — | — | يرصد حالة Ollama | يقرأ فقط حالة Ollama |

### 10.2 النتائج (BM)

| ID | Sev | الموقع | الوصف | اتجاه مقترح |
|---|---|---|---|---|
| **BM-1** | P1 | `batman-dashboard.js:1235-1246` | زر الدردشة (`sendChat`) يستدعي `saveExpenseFromText` مباشرة بلا `_decide('add_expense')` | تمرير كل كتابة مصروف من الدردشة عبر بوابة الموافقة |
| **BM-2** | P1 | `index.html:6416-6429,7292-7306` | مسارا دردشة POS إضافيان يستدعيان `saveExpenseFromText` مباشرة (فقط ملاحظة «⚠️» للحد) | نفس الحل أعلاه |
| **BM-3** | P2 | `invoice-scanner.js:45` → `ai-pos-engine.js:1941` | **الموضع الوحيد الذي يُدخل فيه LLM أرقاماً مالية**: `/api/...`/`extractJSON` يعطي `quantity/unitPrice/total` يُكتب لـ `Purchases.add` (مخفّف بتحقق، لكن بلا حد أعلى للسعر ولا فحص كتالوج) | حدّ أعلى للأسعار + فحص مرجعي بكتالوج |
| **BM-4** | P2 | `batmanController.ts:110-115` | دور الجهاز من body | اشتقاق الدور سيرفراً |
| **BM-5** | P2 | `ai-pos-engine.js:151-157` مقابل `permissionService.ts:32` | bذور Offline (≤500/1000 autoExecute) تخالف default السيرفر fail-closed → سياسة موافقة مختلفة offline/online | تطابق سياسة السيِّد offline |
| **BM-6** | P3 | `batman-dashboard.js:1329,651` | `profit = sales − expenses − purchases` (معظم المشتريات) | مع PUR-6 |
| **BM-7** | P3 | `ollama-adapter.js:299-313` | إرسال مفتاح OpenAI من client إلى proxie (LAN بلا TLS) | إبقاء المفتاح في env سيرفراً |

### 10.3 الإجابة على أسئلة المرحلة المقررة
- **Ollama = طبقة تفسير فقط**: لا تنتج الأرقام إلا في مسار ماسح الفاتورة (BM-3، مخفّف). كل الأرقام الحية من عمليات DB محسوبة.
- **لا SQL/DB write من مخرجات LLM** سوى مسار الإرشاد المخفف (BM-3).
- **عند Ollama غير متاح**: الدردشة fallback محلي (قواعد/بيانات)، وأدوات القرارات المالية **غير متأثرة** (`ai-pos-engine` بلا أي مرجع Ollama)، و`_decide` fails-closed مع كاش 24h.
- **SSRF gate**: قائمة مضيفين + منع private/metadata/redirect (مُثبّت p1-followup).
- **Idempotency القرارات**: `logDecision` eventId SELECT-before-INSERT + `alreadyExecuted` (مطابق paymentSyncId).

---

## 11. Local / Supabase Findings

### 11.1 مصفوفة الملكية الحالية (من الكود — وليس من الوثائق)

| الكيان | محلي (الوضع local) | سحابي (الوضع supabase) | ملاحظات |
|---|---|---|---|
| products / categories | IndexedDB + sync + `catalogService` | Supabase | — |
| inventory / stock_movements | **backend حصراً** (checkout/void/purchase) / مرآة IDB | RPC o الطرق | — |
| product_recipes | عميلاً `(ingredientId)` وسيرفراً `(ingredient)` — **عالمين متفرقين (INV-1)** | Supabase | غير متوافقين |
| purchases | عميلاً+سيرفراً (بلا stock‑in سيرفري INV-6) | Supabase | — |
| suppliers | IndexedDB (admin) + sync (مفتوح) | Supabase | — |
| expenses | سيرفر أولاً + fallback محلي (EXP-3 يسقط `paymentMethod`) | Supabase | — |
| expense_categories | **لا يوجد مخزن** (PUR-15)/جدول (EXP-5) | — | غير موجود |
| cash_registers | محلي + مزامنة إدارية فقط | Supabase (نمط SY-5) | توحيد مفقود (EXP-13) |

### 11.2 النتائج (SY)

| ID | Sev | الموقع | الوصف |
|---|---|---|---|
| **SY-1** | P0 ✅ مغلوق | `supabase-db.js:1162`؛ `index.html:5348`؛ `database.js:3894-3896` | **لا طابور مزامنة مالية محلي في وضع supabase** — القرار Phase‑1 محفوظ |
| **SY-2** | P2 | `sync-engine.js:53-69,272-306`؛ `index.html:5260-5332` | تصادم صيغتي s1/s3 على مفتاح `lucca_sync_queue` في الوضع المحلي (عناصر s3 تُقرأ كـ s1 → `POST /api/undefined` / فقدان عناصر) |
| **SY-3** | P2 | `supabase-db.js:1117-1124` | `ExpenseCategories` في وضع supabase مبينة إلى جدول `expenses` — خلط فئات مع دفتر مصاريف |
| **SY-4** | P2 | `supabase-db.js:1127-1135` | `TableReservations` مبينة إلى `tables`؛ استدعاءات جزئية |
| **SY-5** | P2 | `supabase-db.js:930-997` | دراجات النقد في وضع supabase تعيش بـ localStorage فقط — لا تشارك بين الأجهزة |
| **SY-6** | P2 | `database.js:3887-3898`؛ `index.html:5428` | بعد تحويل إلى supabase تبقى عناصر REST/offline قديمة قابلة للتصريف (bootSync غير محروسة) |
| **SY-7** | P1/P3 | `deploy/supabase-db.js:598-604` | **نسخة النشر القديمة تحمل `enableSync` السيرفي القديم** (يستدعي `startAutoSync`) — تشغيلها يعيد قلّمولات السينك القديم على RPC |

### 11.3 خلاصة
- لا كتابة مزدوجة مالية في وضع local (السيرفر هو الكاتب للمالية) ولا طابور محلي في supabase (المنع محفوظ).
- النقاط الحرجة المتبقية: فتح `purchases/expenses/suppliers/product_recipes/waste_log` في `/api/sync` (SYNC-1)، فجوة `expense_categories`، و`deploy/supabase-db.js` القديم (SY-7).

---

## 12. Data Integrity Findings

| ID | Sev | الموقع | الوصف | التكرار المحتمل |
|---|---|---|---|---|
| **DI-1** | P2 | `supplierRepo.ts:105`؛ `purchaseService.ts`؛ `expensesRepo.ts:65-77` | لا `syncId` للمشتريات/المصروفات + لا index فريد | إعادة إرسال أصل متكرر → صفوف مكررة |
| **DI-2** | P1 | `database.js:1714` مقابل `1709-1711` | **حذف مشتريات العميل لا يعكس حركة المخزون** | حذف مشتري بعد تزويد → مخزون متضخم |
| **DI-3** | P1 | `database.js:2554-2562` مقابل الدرج | **حذف مصروف لا يعكس العدّادات** | حذف بعد إقفال → expected ناقص |
| **DI-4** | P2 | `INV-8/9` (فوق) | `stock_movements.productId` دلالة مزدوجة + `ingredientId` يسقط في المزامنة | حركة تتسم خطأً/لا تظهر |
| **DI-5** | P2 | `INV-5` | `adjustStock` العميل يثبّت سالباً صامتاً | كمية حقيقية ≠ مجموع الحركات |
| **DI-6** | P2 | `EXP-11` | `/api/daily-shifts` يحفظ أرقاماً عميلة كمصدر ورديات | شاشات مختلفة لنفس اليوم |
| **DI-7** | P3 | `INV-10` | استرداد جزئي عبر CRUD لا يقلب `paymentStatus` | انفصال صافي المبيعات/COGS |
| **DI-8** | P2 | `SUP-2` | لا منع تكرار مورد | نصوص متقاربة تنتج مورّدين متعددين |
| **DI-9** | P2 | `EXP-6` | تواريخ بصيغة UTC ISO | ديارٌ شاحية ليوم خاطئ |
| **DI-10** | INFO | `EXP-17` | `split` طريقة دفع غير معترف بها في المتوقعة النقدية | جزء نقدي لا يُحسب |

---

## 13. Security Findings

| ID | Sev | الموقع | الوصف |
|---|---|---|---|
| **SE-1** | P2 | `index.ts:824-847`؛ `expenseService.ts:36-38` | **المزامنة = تجاوز RBAC+تحقق للمشتريات/المصروفات/الموردين** (لا فحص مبلغ/تحقق) — تطابق SYNC-1 |
| **SE-2** | P2 | `decisionService.ts:212-223`؛ `expenseService.ts:36-38` | `create_expense` في طبقة القرارات يستدعي `createExpense` مباشرة بلا حارس `amount>0` (المسار `/api/cc/expenses` يحارس، طبقة القرار لا) — مدير بامكان تسجيل مصروف ≤0 |
| **SE-3** | P2 | `admin/index.html:3893,4063,3853,3856-3860`؛ `admin/dashboard.html:322-327,466,506,525`؛ `admin/control-center.html:203,456,496` | **سلسلة XSS مخزنة**: أسماء موردين/مصروفات/منتجات تُرسم بلا escaping؛ `esc()` في CC هي `String()` (ليست HTML-escape) |
| **SE-4** | P3 | `crud.ts` (مسار التدقيق العام) | تدقيق update/delete عام يشمل orders/refunds فقط → تغييرات المشتريات/المصروفات/الموردين غير مسجلة عبر CRUD |
| **SE-5** | P3 | `crud.ts:37-73` | لا صلاحية كتابة مورد على الإطلاق («admin de facto») بينما `sync` مفتوح — تناقض |
| **SE-6** | P3 | `purchaseService.ts`؛ `decisionService.ts:236-247` | قبلات مبالغ غير متسقة (qty 0/NaN→0، total مستقل عن qty×costPrice) مع تجاهل جزئي في طبقة القرار |
| **SE-7** | PASS | `crud.ts:320-349`؛ `p0-money-guards.cjs:191-209` | حماية الاسترداد سليمة ومُختبَرة (مبلغ>0، paid، netPaid، 409 منع مضاعف + استعادة مخزون مرة) |

ملاحظة: لا يوجد SQL injection — كل الاستعلامات عبر `better-sqlite3` bindings Parameterized (grep سريع لم يجد concat في الاستعلامات الحساسة). لا يوجد تسريب مفاتيح في استجابات `/api/cc` (مثبت phase4).

---

## 14. Test Coverage

### 14.1 المصفوفة (إجمالية — حقيقية لا بالعدّ فقط)

| المجال | تغطية موجودة | فجوة |
|---|---|---|
| **inventory** | check-out خصم/تفريغ/سالب (p0 case6/6b)، استعادة بعد void/refund (p1) | حركات وصفاتية/تسوية عميلية بلا عكس |
| **purchases** | phase4 (create/delete/summary أساسية) | **لا idempotency، لا total-reconcile، لا stock‑in سيرفري، لا void** |
| **expenses** | phase4 (amount 0→400)، summary | لا تكرار، لا delete-counters، لا method filter |
| **suppliers** | **صفر على مستوى السيرفر** (لا create/update/delete/403) | كاملة — TC-1 |
| **recipes** | `getProductUnitCost` عبر phase6/scripts (fixtures D/F/G/H) | لا runtime assert على مسار العميل/الشراء |
| **COGS (null/fallback)** | scenario scripts (threshold) | **لا assert في backend/test** — TC-6 |
| **purchase-not-a-cost** | موثق contract-wise فقط | لا runtime assert على أي سطح عرض |
| **permissions/RBAC** | phase4 partial (بعض 403s) | **صفر على `sync` per-store** (TC-3) |
| **Batman** | phase5 layer1/layer2 + runtime-smoke gate | **لا execute-value guards** (`create_expense` ≤0) — TC-2 |
| **accounting/reports** | phase2, phase6 (canonical numbers)، admin-analytics 32/32 | expected-cash محلي (EXP-15) بلا assert |
| **sync** | p0 case3 (orders+payments admin-gated) | لا delivery للمخازن المفتوحة في SYNC-1 |
| **security/XSS** | batman eschtml pre-doc'd; refund hardening (p0/p1) | **لا رندر/متلازم XSS** في admin (TC-7) |

### 14.2 فجوات بارزة
- TC-1: supplier CRUD + 403 (manager) — صفر.
- TC-2: طبقة القرارات — صفر على guards المبالغ.
- TC-3: `sync` per-store RBAC — صفر.
- TC-4: `audit_logs` للمشتريات/المصروفات/الموردين update/delete — لا يوجد أصل ولا اختبار.
- TC-5: مصفوفة القيم غير الصحيحة على `/api/cc` — ناقصة (qty 0, total مفارق, تكرار).
- TC-6: COGS ستين path runtime — scenario only.
- TC-7: XSS sinks — بلا اختبارات.

---

## 15. Remaining Legacy Logic

كُنّية المؤجلة الموثّقة سابقاً (`ACCOUNTING_MIGRATION_MAP.md` / `ACCOUNTING_CALCULATION_AUDIT.md §4`) + مكتشفات هذا التدقيق:

| البند | الموقع | الحالة |
|---|---|---|
| شريط POS الفوري (يشمل pending) | `index.html` ~1499/2131/2432 | DOCUMENTED-DIVERGENT (مؤجل — لا يُلمس POS) |
| `ai-pos-engine._salesStats` يشمل completed/closed بلا paid | :2113-2131 | DOCUMENTED-DIVERGENT (مؤجل) |
| `batman-dashboard` صيغ ربح متعددة (المشتريات تُطرح) | :330/486/773/864/1329 | DOCUMENTED-DIVERGENT (مؤجل إلى واجهات) |
| عدّادات `expectedCash/netCash/netRevenue` المحلية | `database.js` 1927-1931/2058/2083 | DOCUMENTED-DIVERGENT (مؤجل) — موافقة EXP-1/2 |
| `deductForCheckout` ميّت | `database.js:1669`، `supabase-db.js:857`، `deploy:485` | كود ميّت مُكتشَف جديد |
| `cogsFor` القديمة | `ordersRepo.ts:178` | كود ميّت مُكتشَف |
| `suppliers.balance/paid` | `db.ts:738` | أعمدة ميتة |
| `AdminAnalytics.compute` (محلّي) | `admin-analytics.js` | المرجع المحلي فقط — التوحيد النهائي مؤجل |
| `deploy/supabase-db.js` القديم | deploy:598-604 | نسخة نشر قديمة (SY-7) |

---

## 16. Severity Matrix

> كما في §1.2 — أرقام تقريبية لمجموعة البنود المعروضة في هذا التقرير.

| P0 | P1 | P2 | P3 | INFO |
|---:|---:|---:|---:|---:|
| — | SYNC-1, INV-1, INV-2, INV-6, INV-14, PUR-1, PUR-2, PUR-3, PUR-4, PUR-5, PUR-6, PUR-9, EXP-1, EXP-2, EXP-3, EXP-7, EXP-8, EXP-11, EXP-13, EXP-21, BM-1, BM-2, SUP-1 | INV-3, INV-4, INV-5, PUR-10, PUR-11, PUR-12, PUR-14, EXP-4, EXP-5, EXP-6, EXP-9, EXP-10, EXP-12, EXP-16, EXP-17, EXP-19, EXP-22, EXP-23, SUP-2, SUP-3, BM-3, BM-4, BM-5, SY-2, SY-3, SY-4, SY-5, SY-6, DI-1, DI-4, DI-5, DI-6, DI-8, DI-9, SE-1, SE-2, SE-3, PF-1, PF-2, PF-3, TC-1, TC-2, TC-3 | INV-7, INV-8, INV-9, INV-10, INV-11, INV-15, PUR-13, EXP-15, EXP-20, SUP-4, BM-6, BM-7, DI-7, SE-4, SE-5, SE-6, TC-4, TC-5, TC-6, TC-7, PF-4 | INV-12, INV-13, INV-16, PUR-8, PUR-15, EXP-18, SUP-5, SUP-6, BM-8, BM-9, BM-10, DI-10 |

التفكيك: P1 ≈ **23 بند فردي** (عد مجموعات المركّبة كوحدة)، P2 ≈ **43**، P3 ≈ **21**، INFO ≈ **12**، P0 = **0**.
> هذه الأعداد تُعدّ من نتائج هذا التقرير نفسها ولا تُنسب لمصادر أخرى.

---

## 17. Recommended Phase 5 Execution Plan

> **توصيات فقط.** كل مرحلة تُنفَّذ بأمر منفصل، بـ test-first، ودون مساس بالمسار المالي الحار (contract KEEP) ودون تغيير version/schema دون موافقة.

### Phase 5A — إغلاق مسارات الكتابة والصلاحيات (المحدّدات)
- ترسيخ `permissionService` لكل مخزن في مسار المزامنة: `purchases→purchases.write`، `expenses→expenses.write`، `suppliers→admin-only`، `product_recipes/waste_log→inventory.write`.
- تقييد كتابة `cash_registers` إلى adminish؛ منع قراءة المصروفات العمومية؛ اشتقاق أدوار batman سيرفراً (إغلاق BM-4).
- تمرير كل إدخال مصروف من الدردشة عبر بوابة موافقة batman (إغلاق BM-1/2).

### Phase 5B — توحيد منظومة الوصفات والتكاليف
- توحيد `product_recipes` على نموذج واحد (السيرفر مصدر التأليف)، ترجمة الأعمدة أثناء المزامنة.
- قناة وحدة تكلفة واحدة (وصفاتي) يستهلكها AdminAnalytics + الدردشة + POS chat (إحلال INV-2/3/4/14).
- إزالة الكود الميّت (`deductForCheckout`, `cogsFor`) وجعل `adjustStock` العميل يرفض السالب.

### Phase 5C — نموذج Purchases / Expenses المتكامل
- إضافة الحالة/طريقة الدفع و`syncId` + فهارس فريدة (مع وفاق المخطط).
- إعادة حساب إجمالي المشتريات سيرفراً، وstock‑in سيرفري، وحذف/void يقلب الحركات والدرج.
- مخطط `expense_categories`؛ تمرير `paymentMethod/notes/supplier/employeeId` للخادم.
- توحيد معادلة Expected Cash في كل سطح + إعادة حساب سيرفرية حصرية عند إقفال الوردية.

### Phase 5D — تدقيق وتقارير وحماية
- تسجيل تدقيق لكل كتابة (CC + sync + تحديث/حذف): مشتريات/مصروفات/موردون.
- تقرير مشتريات مستقل؛ الحماية من تكرار الموردين؛ ربط تقارير الموردين بالمعرف.
- فحص XSS على صفوف admin التراثية؛ تحسين الأداء (دفعة COGS، ترقيم، تقليل تكرار لوحة 10s).

---

## 18. Explicitly Deferred Items

1. **`lucca_pending_password_change`** — تخزين نصّي لكلمة المرور الجديدة عند انقطاع الاتصال: **pre-existing، خارج نطاق Phase 5** — يعالج في Hardening مستقل (لا يُلمس هنا).
2. أي تغيير في **الممر المالي الساخن**: checkout/void/refund/stock deduction/`crud.ts:159`/sync — **KEEP**؛ أي ملاحظة عليه مشروع مستقل.
3. **Schema/migration**: `expense_categories`، حقول المشتريات/المصروفات الجديدة، فهارس `syncId` — تتطلب عقد مخطط وموافقة (مقترحة في 5C وليست منفذة).
4. **Version bump / dependency upgrade / package changes** — مؤجل دائماً بلا موافقة.
5. **الأدوار SUPERVISOR/ACCOUNTANT/AI_ASSISTANT وجداول roles/permissions** — الهدف Phase 6 (موثق في RBAC_MATRIX).
6. **توحيد طابور المزامنة (D7)** — Phase 10 (لا يطبق).
7. **دمج `dashboard.html` في CC** — Phase 7+.
8. شريط POS الفوري / `_salesStats` / `batman-dashboard` صيغ الربح التقديري — مؤجل إلى مرحلة الواجهات (موثق §15).
9. `deploy/supabase-db.js` — يُزامن مع الجذر عند أي تنفيذ سحابي (وليس الآن).
10. أي اختبار صندوق جديد يغيّر أرقاماً — يجب أن يحدّث `ACCOUNTING_MIGRATION_MAP.md` و`ACCOUNTING_CALCULATION_AUDIT.md` قبل/مع الكود، وبعد parity.

---

*نهاية المستند — Phase 5 Audit. لا التزام بموافقة التنفيذ بعد.*