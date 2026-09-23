# خريطة هجرة الحسابات المالية — Accounting Migration Map (Phase 4)

> المستند: `docs/ACCOUNTING_MIGRATION_MAP.md`
> الحالة: **مكتمل** — لكل سطح مالي: المصدر القديم ← الصيغة القائمة قبل ← الصيغة المتقاربة (المصدر المرجعي) ← حالة الهجرة ← اختبار الحماية.
> التاريخ: 2026-09 — المرحلة: **Phase 4 (Accounting & Reporting Convergence)**.
> المراجع: `ACCOUNTING_CALCULATION_AUDIT.md`, `CANONICAL_REPORTING_CONTRACT.md`, `PHASE_4_FINAL_REPORT.md`.

---

## 1) دليل القيم

| العمود | المعنى |
|---|---|
| **S#** | رقم السطح (مطابق لتدقيق `ACCOUNTING_CALCULATION_AUDIT.md`) |
| **Surface** | السطح الحسابي، الموقع (`file:line`) |
| **Old Source** | من أين كانت الصيغة القائمة تقرأ أرقامها قبل Phase 4 |
| **Old Formula (قبل)** | الصيغة القائمة قبل Phase 4 (والانحراف عن العقد إن وجد) |
| **Canonical Source (بعد)** | المصدر المرجعي الحالي بعد Phase 4 — دائمًا `backend reportService` أو مهايئ فوقه |
| **Migration Status** | `MIGRATED` (نُفِّذ في Phase 4) / `ALREADY-COMPLIANT` (مطابق أصلًا — تدقيق) / `DEFERRED` (متباين مؤجل موثق) / `KEEP` (ساخن لا يُلمس) |
| **Regression Test** | اختبار الحماية |
| **Notes** | ملاحظات + رابط القرار |

---

## 2) المصفوفة

| S# | Surface (مرجع) | Old Source | Old Formula (قبل) | Canonical Source (بعد) | Migration Status | Regression Test | Notes |
|---|---|---|---|---|---|---|---|
| §1 | `reportService.getSalesReport` (`reportService.ts:55,67`) | `paidOrdersSummary` + `Σ refunds` | `netSales = Σtotal − discounts − refunds` — **خصم مزدوج** (انحراف D1: العقد `Σtotal − refunds`) | `NetSales = Σtotal − Σrefunds` | **MIGRATED** | `phase2-services`, `phase6` | الهدف `800→815`؛ `discounts=ΣdiscountAmount` مجموعة مستقلة |
| §2 | `reportService.getFinancialReport` (`reportService.ts:332,366-380`) | مكونات مجزأة محليًا | تقرير ناقص الوصفات + `completeness` جزئي | `getNetSales/getDiscounts/getRefunds/getOrdersCount/getAOV/getCancelledCount/getCOGS/getGrossProfit/getExpenses/getCashExpected` — 12 مفتاحًا لكل منها `completeness` | **MIGRATED** | `phase6` (completeness 12/12) | صفر/`null` متسق مع العقد |
| §3 | COGS `reportService.getCOGS` (`:252-267`) + `inventoryService.getProductUnitCost` (`:81-98`) | `ordersRepo.cogsFor` (وصفة/منتج) | `Σ qty×cost` مع `hasCostData` يخفي النقص | recipe-first → `inventory.costPrice` → `products.cost` → `null`؛ `complete/partial/unavailable` | **MIGRATED** | `phase6` (4 حالات + متعدد العناصر 107) | قاعدة «لا اختراع تكلفة مفقودة» |
| §4 | Cash `reportService.getCashExpected` (`:297-300`) | `openingBalance + cashSales − refunds − expenses` | مطابق أصلًا | نفسه | **ALREADY-COMPLIANT** | `phase6` (3000 / مصروف كارت لا يدخل) | لا تعديل في Phase 4 |
| §5 | `accountingService.getSalesSummary` (`:12-23`) | مشتق من `getSalesReport` بصيغ غير مباشرة | صحيح القيمة، غير مباشر المصدر | مباشر: `getDiscounts`/`getOrdersCount`/`getNetSales`/`getGrossSales`/`getRefunds` | **MIGRATED** | `phase2-services`, `phase6` | قيم قبل/بعد متطابقة (dis=15, orders=6) |
| §6 | `accountingService.getFinancialReportForPeriod` (`:76-79`) | — | — | يمرر إلى `reportService.getFinancialReport` (قناة واحدة) | **MIGRATED** | `phase6` | لا منطق مستقل |
| §7 | `analytics /dashboard/kpis` (`analytics.ts:29`) | حساب محلي موازٍ داخل الراوتر | KPI موازية `hasCostData` خاطئ للفارغ | مهايئ فوق `reportService` (شكل استجابة محفوظ) | **MIGRATED** | `phase6` (متقارب 3 نقاط + فارغ صفري) | تغيير سلوكي موثق: فارغ الآن `{0,null}/hasCostData=true` |
| §8 | `analytics /dashboard/top-products` (`analytics.ts:99,110`) | `products.cost` فقط | تكلفة من كتالوج المنتج مهما كانت (قد تكون 0) | `getProductUnitCost` (وصفة أولًا) + `cost/profit=null` عند الجهل | **MIGRATED** | `phase6` (top-products-A cost=40/profit=895) | المستهلكون null-safe (dashboard.html:413، index.html renderTopProducts) |
| §9 | `AdminAnalytics.compute` KPI (`admin-analytics.js:26,87-91`) | IndexedDB (orders/refunds) | `discounts = Σ o.discount` (**نسبة**)؛ `avgOrder = net÷count` (بعد الاسترداد) | `discounts = Σ discountAmount` (مساعد `discountAmountOf:26`)، `avgOrder = gross÷completed.length` | **MIGRATED** | `test-admin-analytics` **32/32** | avgOrder 700→750، discounts 50→400 |
| §10 | `AdminAnalytics` profit (`admin-analytics.js:226-232`) | IndexedDB | المصاريف تُطرح من الربح الإجمالي + تغطية تكلفة صادقة | سليم وفق العقد (لا تعديل عددي لازم) | **ALREADY-COMPLIANT** | `test-admin-analytics` | نتيجة تدقيق |
| §11 | RBAC ربح — `controlCenter.ts:131` + `control-center.html:364` | `scope` سيرفري | ربحيّة `null` لغير المدير | نفس السلوك (متطابق) | **ALREADY-COMPLIANT** | `phase6` (manager A) | لا إضعاف |
| §12 | شريط POS (`index.html` ~1499/2131/2432) | عدّادات محلية لحظية | عرض يشمل `pending` | — (لا يُلمس POS) | **DEFERRED** | `runtime-smoke`, `p1-followup` | عرض فقط لا سجل؛ توحيد مؤجل |
| §13 | `ai-pos-engine._salesStats`/`getDailySummary` (`ai-pos-engine.js:2119,2131`) | IndexedDB مباشرة للبيان | `net=gross−refunds`؛ يشمل `completed/closed` بلا شرط `paid` | — (أداة قراءة عرض [بيان]) | **DEFERRED** | `phase5-decision-layer` (26 أداة read-only) | توسيع `paid` مؤجل (عقد §31) |
| §14 | `batman-dashboard` (`L330/486/651/773/864-865/1329`) | كائنات تراكم المدخلات | صيغ ربح متعددة (المشتريات تُطرح في بعضها) | — | **DEFERRED** | `phase5-decision-layer` | عرض تفسيري؛ القرار في مرحلة الواجهات (العقد: purchases لا تُطرح) |
| §15 | `admin/database.js` local (expected `1927-1931`, `netCash:2058`, `netRevenue:2083`) | عدّادات IndexedDB محلية | expected من عدّادات محلية موازي للسيرفر | — | **DEFERRED** | `run-tests` (17) | مسار معروف في عقد §58؛ توحيد الاشتقاق مؤجل |
| §16 | عرض التقارير `dashboard.html:377-387` / `index.html:4121-4163,4971-4976` | `/api/reports` سيرفر أو محلي متقارب | الإجماليات من الرقم الموحد/المتقارب + الربح بشرط `!=null` | المصدر السيرفري الموحد + null-safe | **MIGRATED** (قراءة) / عرض محلي متقارب | `phase6`, `test-admin-analytics` | لا يُلمس شكل الواجهة |
| §17 | المسار المالي الساخن (checkout/void/refund/stock/sync/`crud.ts:159`) | backend SQLite حصري | — (لا يُلمس) | — | **KEEP** | `guard 16`, `ce-idem 9`, `smoke 13`, `p0 57`, `p1 67` | صفر تغيير — المسار المحمي |

---

## 3) خلاصة الحالة

| الحالة | العدد |
|---|---|
| **MIGRATED** (نُفِّذ في Phase 4) | 7 surfaces (§1، §2، §3، §5، §6، §7، §8، §9، §16-read) — عدًّا: 8 [§1,2,3,5,6,7,8,9] + §16-read |
| **ALREADY-COMPLIANT** (تدقيق) | 3 (§4، §10، §11) |
| **DEFERRED** (مؤجل موثق) | 4 (§12، §13، §14، §15) |
| **KEEP** (ساخن لا يُلمس) | 1 (§17) |

## 4) قواعد الانتقال (Gates)

1. كل انتقال رقمي تم بعد **parity** (مبدأ D8/D9): الرقم الجديد مثبت أولًا في `reportService` ثم حُمّل عليه المستهلكون (kpis adapter يحافظ على شكل الاستجابة، admin-analytics بإعادة تعريف متوافقة مقفولة باختبار).
2. `DEFERRED` لا يعني «اختلاف جائز للأبد» — كل صف له مرجع قرار في `ACCOUNTING_CALCULATION_AUDIT.md §4` و`PHASE_4_FINAL_REPORT.md §24`.
3. المسار المالي الحار (§17) صفر تغيير — أي ملاحظة عليه تُعالج كمشروع مستقل (مثل RPC/Supabase parity).
4. أي تغيير مستقبلي على صندوق رقمي يجب أن يُحدِّث هذا الجدول قبل/مع الكود.