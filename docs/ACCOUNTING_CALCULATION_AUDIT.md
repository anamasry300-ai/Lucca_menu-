# تدقيق الحسابات المالية — Accounting Calculation Audit (Phase 4)

> المستند: `docs/ACCOUNTING_CALCULATION_AUDIT.md`
> الحالة: **مكتمل** — جرد شامل لكل سطح يُحسب عليه رقم مالي (17 سطحاً)، لكل سطح: الموقع، الصيغة قبل/بعد، الحالة (متقارب / متباين مُوثَّق مُرجَّح)، والبرهان.
> التاريخ: 2026-09 — المرحلة: **Phase 4 (Accounting & Reporting Convergence)**.
> المرجع المقبول: `CANONICAL_REPORTING_CONTRACT.md` — صيغه ملزمة (Gross/Net/Discounts/AOV/COGS/GrossProfit/Expenses/Operating/CashExpected).

---

## 0) العقد المرجعي (باختصار)

| المقياس | الصيغة المرجعية |
|---|---|
| **GrossSales** | `Σ orders.subtotal` (طلبات مدفوعة فقط، `paymentStatus='paid'`) |
| **NetSales** | `Σ orders.total − Σ refunds.amount` — **لا تُطرح الخصومات فوق `total`** (`total` بعد الخصم أصلًا) |
| **Discounts** | `Σ orders.discountAmount` (**مبلغ** — `discount` نسبة ولا يُجمع كمال) |
| **Refunds** | `Σ refunds.amount` في فترة الاسترداد |
| **AOV (avgOrder)** | `Σ total ÷ عدد الطلبات المدفوعة` (أساس ما قبل الاسترداد) |
| **COGS** | `Σ (quantity × unitCost)` — unitCost: recipe→`inventory.costPrice` ثم `products.cost` وإلا `null` |
| **GrossProfit** | `NetSales − COGS` (`null` إذا كان COGS ناقصًا) |
| **OperatingExpenses** | `Σ expenses` |
| **OperatingProfit** | `GrossProfit − OperatingExpenses` |
| **CashExpected** | `openingBalance + cash payments − cash refunds − cash expenses` |
| **المشتريات (purchases)** | **لا تُطرح إطلاقًا من الربح** |

---

## 1) منهج التدقيق

- جرد فعلي للكود (`file:line`) في **كل** سطح يعرض/يحسب رقمًا ماليًا — POS، Admin، backend، Batman، kitchen، AI-engine.
- مقارنة كل صيغة بالعقد، وتصنيف النتيجة:
  - `CONVERGED` — متقارب مع العقد بعد التعديل (البرهان: اختبار).
  - `DOCUMENTED-DIVERGENT` — تباين مقصود/مؤجل، موثق هنا وفي `ACCOUNTING_MIGRATION_MAP.md`، لا يُلمس في Phase 4.
  - `KEEP` — سطح ساخن لا يُلمس (المسار المالي المحمي).
- لا تعديل لأي مُعرّف Schema، لا تغيير IndexedDB v9، لا تغيير checkout/void/refund، لا إضعاف RBAC.

---

## 2) جرد الأسطح (17 سطحًا)

### §1 — `reportService.getSalesReport` (backend سيرفر — موصد الأرقام)
- الموقع: `backend/src/services/reportService.ts` (`getSalesReport:55`, `netSales = revenue − refunds:67`).
- الصيغة قبل Phase 4: `netSales = revenue − discounts − refunds` (السطر 73 القديم — **خصم مزدوج**: `total` بعد الخصم ثم طرح `discounts` مرة ثانية).
- الصيغة بعد Phase 4: `revenue − refunds` فقط؛ `discounts` تُحسب من `Σ discountAmount` وتُعرض كمجموعة مستقلة؛ `prevNetSales` متسق (بلا خصومات ثانية).
- مخرجات متقاربة: `revenue, orders, avgOrder(=Σtotal÷paidCount), discounts, refunds, netSales, cancelled, previous{revenue,orders,avgOrder,refunds,netSales}, change{…}`.
- الموقف: **CONVERGED** — البرهان: `phase2-services.cjs` (815/Δ=0)، `phase6-accounting-convergence.cjs` (تناغم cc/dashboard ↔ reports/sales ↔ dashboard/kpis).
- نقطة محورية تاريخية: كنتيجة للتقارب توقّف `getSalesReport` عن إرجاع `net=800` (الرقم القديم المعوب) وصار `net=815` — موثق في `PHASE_4_FINAL_REPORT.md §20`.

### §2 — `reportService.getFinancialReport` + `completeness`
- الموقع: `backend/src/services/reportService.ts` (`getFinancialReport:332`, completeness `366-380`).
- التعديل في Phase 4: توسيع التقرير إلى المؤشرات المرجعية كاملة (netSales, discounts, refunds, orders, aov, cancelledCount, cogs, grossProfit, expenses, operatingProfit, cash, dates) مع `completeness` لكل مفتاح.
- `grossProfit` و`grossMargin` محميان بـ `null` عند نقص بيانات التكلفة (مطابق للعقد).
- الموقف: **CONVERGED** — البرهان: phase6 «financial.completeness: 12 مفتاحًا كلها complete».

### §3 — COGS: `getCOGS` + `getProductUnitCost`
- الموقع: `reportService.getCOGS:252-267`؛ `inventoryService.getProductUnitCost:81-98` (recipe→`94`, product fallback→`97`, none→`98`).
- القاعدة: `Σ(quantity × unitCost)`، unitCost عبر الوصفة أولًا (`product_recipes.ingredient` مطابقًا عبر `inventoryByTrimmedName`)، ثم `products.cost`، وإلا `null`.
- `completeness`: `complete` (بلا صفوف أو كل الصفوف حُلَّت) / `partial` (بعضها) / `unavailable` (لا شيء).
- الموقف: **CONVERGED** — البرهان: phase6 (4 حالات: وصفة كاملة 170 / product-fallback 4×7=28 / جزئي→null / غير متاح→null + متعدد العناصر 40+60+7=107).

### §4 — النقد: `reportService.getCashExpected`
- الموقع: `reportService.ts:297-300` (`openingBalance + cash payments − cash refunds − cash expenses`).
- متطابق مع العقد أصلًا (لم يُعدَّل في Phase 4 — تدقيق فقط).
- الموقف: **CONVERGED** — البرهان: phase6 (B: 1000+2500−200−300=3000؛ A: 1000+935−120−300=1515 ومصروف كارت لا يدخل).

### §5 — `accountingService.getSalesSummary`
- الموقع: `backend/src/services/accountingService.ts:12-23`.
- قبل Phase 4: حسابات صحيحة القيمة عبر صيغ غير مباشرة.
- بعد Phase 4: استخدام مباشر للميتركس المرجعية من `reportService` (`getDiscounts`/`getOrdersCount`/`getNetSales`/`getGrossSales`/`getRefunds`) — ‏`discounts` و`ordersCount` صارا مُشتقّين من نفس مصدر `getSalesReport` (قيم قبل/بعد متطابقة: discounts=15، ordersCount=6).
- الموقف: **CONVERGED** — البرهان: phase2-services + phase6.

### §6 — `accountingService.getFinancialReportForPeriod`
- الموقع: `accountingService.ts:76-79` — يمرر إلى `reportService.getFinancialReport` (قناة واحدة).
- الموقف: **CONVERGED** (لا منطق مالي مستقل بذاته).

### §7 — `analytics /dashboard/kpis`
- الموقع: `backend/src/routes/analytics.ts:29` وما بعدها.
- قبل Phase 4: KPI محسوبة داخليًا بصيغ موازية (risk of drift + قفزة `grossProfit` صفرية في فترات فارغة).
- بعد Phase 4: **مهايئ متقارب** فوق `reportService` — `net/prevNet` من `getNetSales`، `avgOrder` من `getAOV`، `refunds/discounts/orders/cancelled` من الميتركس المرجعية، `cogs` من `getCOGS`، `grossProfit` من `getGrossProfit`؛ شكل الاستجابة JSON محفوظ صراحة.
- **تغيير سلوكي موثق مقصود**: فترة فارغة الآن `hasCostData=true` مع `grossProfit {value:0, margin:null}` (متسق مع عقد «صفر كامل» — لا «unavailable» كاذب). موثق في `PHASE_4_FINAL_REPORT.md §21` ومقفل باختبار phase6.
- الموقف: **CONVERGED** — البرهان: phase6 (فترة A عبر 3 نقاط + فترة فارغة صفرية).

### §8 — `analytics /dashboard/top-products`
- الموقع: `analytics.ts:99-...`، استدعاء `getProductUnitCost` عند `:110`.
- بعد Phase 4: التكلفة من معرّف الوحدة المرجعي (وصفة أولًا) بدل الاعتماد على `products.cost` فقط؛ `cost`/`profit` = `null` عند جهل التكلفة (لا اختراع أرقام).
- المستهلكون متوافقون مع null (تحقّق ساكن): `admin/dashboard.html` (يعرض «—») و`admin/index.html` `renderTopProducts` (لا يعرض الربح أصلًا).
- الموقف: **CONVERGED** — البرهان: phase6 top-products-A (cost=40 من الوصفة، profit=895) + تحقق التحميل.

### §9 — `AdminAnalytics.compute` — KPI المبيعات (admin frontend, IndexedDB)
- الموقع: `admin/admin-analytics.js` — `discountAmountOf:26`، `gross:87`، `net:89`، `discounts:90`، `avgOrder:91`.
- قبل Phase 4: `discounts = Σ o.discount` (يَجمع **النسبة**) و`avgOrder = net ÷ count` (بعد الاسترداد) — وحدتان خاطئتان مقابل العقد (D2 + انحراف AOV).
- بعد Phase 4: `discounts = Σ discountAmount` (عبر المساعد `discountAmountOf` — يستخدم `discountAmount` وإلا `subtotal − total`)؛ `avgOrder = gross ÷ completed.length` (**قبل** الاسترداد، على أساس الإجمالي).
- الموقف: **CONVERGED** — البرهان: `scripts/test-admin-analytics.cjs` (**32/32**، avgOrder 700→750، discounts 50→400).

### §10 — `AdminAnalytics` — الربح التقديري الصادق
- الموقع: `admin-analytics.js` `grossProfit:226`، `margin:230`، `netProfit:232`، مع `coverage`/`missing` صادقين.
- بعد Phase 4: سليم بنيويًا وفق العقد (المصاريف تطرح من الربح الإجمالي؛ تغطية التكلفة تُظهِر النقص بدل اختراع رقم). لم يتطلب تعديلًا عدديًا (التدقيق أكده).
- الموقف: **CONVERGED** (تدقيقًا) — البرهان: admin-analytics 32/32 (إجمالي الربح 750 + تغطية 80%).

### §11 — RBAC على الأرباح — `control-center.html` + `controlCenter.ts`
- الموقع: `controlCenter.ts:131` (يُقنِّع `grossProfit/netSales` لغير المدير عبر `scope` — serverside) + `control-center.html:364` (`show = pl.grossProfit!=null`).
- الموقف: **CONVERGED** — البرهان: phase6 (manager A: net=815 مرئية، cogs/grossProfit/operatingProfit=null، financial=null) + gate 3.5.

### §12 — شريط المبيعات الفوري في POS (`index.html`)
- الموقع: `index.html` (`~1499`، `2131`، `2432` + عدّادات `paidOrdersSummary`).
- الطبيعة: عرض لحظي يشمل الطلبات `pending` حسب التصميم الأصلي؛ لا يدخل أي سجل إيراد ولا يُطرح من أي رقم سيرفري؛ صيغته متوافقة مع العقد في حدود عرضه.
- الموقف: **DOCUMENTED-DIVERGENT (مؤجل)** — إعادة تلقي `gross`/اشتراط `paid` في الشريط مؤجلة؛ لا يُلمس POS في Phase 4 (قاعدة اللَّمس).

### §13 — `ai-pos-engine` — `_salesStats` / `getDailySummary`
- الموقع: `ai-pos-engine.js` (`_salesStats:2119` — `net = gross − refunds`، و`2113:2131` يشمل `completed/closed` مهما كانت حالة الدفع).
- الطبيعة: أداة قراءة فقط تعرض «بيان» داخل محادثة باتمان (وسم الثقة [بيان]) — لا يُعتمد عليها كسجل إيراد رسمي.
- الموقف: **DOCUMENTED-DIVERGENT (مؤجل)** — توسيع شرط `paid` (نقطة العقد §31) مؤجل، موثق في `ACCOUNTING_MIGRATION_MAP.md` و`PHASE_4_FINAL_REPORT.md §24`.

### §14 — `batman-dashboard` — المشتريات في الربح
- الموقع: مواضع طرح `purchases` داخل الربح: `batman-dashboard.js` (L330/486/651/773/864-865/1329).
- الطبيعة: لوحة عرض بأكثر من صيغة ربح (P1 في الـ reengineering plan) — عرض تفسيري لا كاتب وليس سجلًا.
- الموقف: **DOCUMENTED-DIVERGENT (مؤجل)** — لا تُلمس أرقام عرض Batman في Phase 4؛ يُحسم في مرحلة الواجهات (المستهدف: العقد — المشتريات لا تُطرح من الربح).

### §15 — `admin/database.js` — العدّادات المحلية `expectedCash`/`netCash`/`netRevenue`
- الموقع: `admin/database.js` (`netCash:2058`، `netRevenue:2083`، عدّادات expected المحلية `1927-1931`).
- الطبيعة: حسابات عرض محلية (IndexedDB) موازية للحساب السيرفري؛ مسار معروف في عقد §58 (اتفاقية)؛ لا تُكتب للخادم.
- الموقف: **DOCUMENTED-DIVERGENT (مؤجل)** — توحيد اشتقاق expected محليًا مع السيرفر مؤجل (Phase 6/قرار منفصل)، موثق في العقد والميغراشن ماب.

### §16 — عرض التقارير/الربح: `admin/dashboard.html` + `admin/index.html`
- الموقع: `dashboard.html:377-387` (KPI صافي/متوسط/ربح — الربح فقط عندما `grossProfit != null`)، `index.html:4121-4163` (KPI عبر `/api/dashboard` أو تقرير محلي — الربح التقديري مع تغطية صادقة، `4971-4976`).
- الموقف: **CONVERGED** — القراءة من المصدر السيرفري الموحد (أو المحلي المتقارب)، العرض يحمل `null`-safe. برهان: phase6 + admin-analytics 32/32.

### §17 — المسار المالي الساخن (لا يُلمس)
- الموقع: `crud.ts:159` (`serverOrderTotals` — إجماليات الطلب تُحسب سيرفرًا دائمًا)، `orders/:id/checkout`، `orders/:id/void`، `refunds`، `stock.ts`، `salesService.calculateOrderFinancials`، `sync`.
- الموقف: **KEEP** — لم يُلمس سطر واحد في Phase 4؛ برهان عدم التغيير: `guard-regression 16`، `checkout-idempotency 9`، `runtime-smoke 13`، `p0-money-guards 57`، `p1-followup 67` أُعيدت كلها أخضر بعد البناء.

---

## 3) خلاصة الحالة

| الحالة | العدد | الأسطح |
|---|---|---|
| **CONVERGED** | 12 | §1-§11، §16، §17 (KEEP متطابق) |
| **DOCUMENTED-DIVERGENT (مؤجل)** | 4 | §12 (شريط POS)، §13 (`_salesStats`)، §14 (batman-dashboard)، §15 (local expectedCash) |

## 4) عناصر مؤجلة (Deferred Items — لا تُلمس في Phase 4)

1. `ai-pos-engine._salesStats` — توسيع شرط `paymentStatus='paid'` ليشمل `completed/closed` (مطلوب للعقد §31) → مؤجل لقرار منفصل.
2. `admin/database.js` — توحيد اشتقاق `expectedCash` المحلي مع الصيغة السيرفرية (العدّادات `1927-1931`) + `netCash/netRevenue` → مؤجل.
3. شريط POS الفوري — اشتراط `paid` وإعادة تسمية العرض → مؤجل (لا يُلمس POS).
4. `batman-dashboard` — صيغ الربح المتعددة (المشتريات في الربح) → مؤجل إلى مرحلة الواجهات.
5. `supabase-db` / RPC — صيغ cloud مطابقة (توجد RPC مفقودة + schema v1 فقط حسب `ADMIN_REENGINEERING_PLAN §1.2`) → مؤجل خارج نطاق الأرقام المحلية.

## 5) تغييرات النتائج الوثائقية (Result Changes — من الحرص لا من خطأ)

| القياس | قبل | بعد | السبب |
|---|---|---|---|
| netSales (فيxture 800) | 800 | **815** | تصحيح الخصم المزدوج (D1) |
| avgOrder (admin) | 700 | **750** | إعادة التعريف على أساس ما قبل الاسترداد (D?? AOV) |
| discounts (admin) | 50 | **400** | `Σ discountAmount` بدل `Σ o.discount` (D2) |
| فترة فارغة dashboard/kpis | `hasCostData=false` | `hasCostData=true` + `grossProfit {0,null}` | اتساق «صفر كامل» مع العقد |
| top-products بدون وصفة ولا cost | `products.cost` (قد يكون 0) | `null` (لا اختراع) | قاعدة «لا اختراع تكلفة مفقودة» |

كل تغيير مقفل باختبار (phase2/phase6/admin-analytics) وموثق في `ACCOUNTING_MIGRATION_MAP.md` و`PHASE_4_FINAL_REPORT.md`.