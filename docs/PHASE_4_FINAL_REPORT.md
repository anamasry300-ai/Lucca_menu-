# التقرير النهائي — Phase 4 (Accounting & Reporting Convergence)

> المستند: `docs/PHASE_4_FINAL_REPORT.md`
> الحالة: **منجز — PASS** (بشرط القسمين §29/§30، لا تغيير schema، صفر لمس للمسار المالي الساخن).
> التاريخ: 2026-09 — الفنّي: `LuccaPOS` — البناء: `backend/dist` (tsc exit 0).
> المستندات المقترنة: `ACCOUNTING_CALCULATION_AUDIT.md`, `ACCOUNTING_MIGRATION_MAP.md`, `CANONICAL_REPORTING_CONTRACT.md`.

---

## 1) الملخص التنفيذي

قُوربت طبقات الحساب المالي في LUCCA POS على **نموذج مالي مرجعي واحد** (`CANONICAL_REPORTING_CONTRACT.md`). صحّحنا الخطأ المرجعي الأشهر — **الخصم المزدوج** في `reportService.getSalesReport` (كان `netSales = Σtotal − discounts − refunds` وهي تحسم الخصم مرتين لأن `total` بعد الخصم أصلًا) — مع تصحيحات «الخصم كمجموعة مبلغ»، و«AOV أساس ما قبل الاسترداد»، و«COGS من معرّف التكلفة بدون اختراع أرقام». كل تغيير رقمي مقفل باختبار تطابق: backend **286/286**، admin frontend **32/32**، و8 حِزم دعم خضراء (17+17+12+21+16+32+shifts+invite). صفر تغيير في checkout/void/refund/stock/sync/schema/RBAC. البناء نظيف.

## 2) الهدف (Objective)

توحيد «الرقم المالي» عبر كل الطبقات: POS، Admin (لوحتان + legacy)، backend، Batman — على مصدر واحد `reportService` وبتتبع تام لكل تغيير (قابل للتدقيق، قابل للتراجع).

## 3) النطاق (Scope)

- **ضمن النطاق**: 17 سطحًا مُرقمًا (`ACCOUNTING_CALCULATION_AUDIT.md §2`) — صيغ net/discounts/AOV/COGS/cash، المهايئات، عدّادات admin العرض.
- **خارج النطاق (يُمنع):** POS (`index.html`), `admin/database.js` (IndexedDB v9), checkout/void/refund/transfer/stock-deduction, Supabase schema/RPC, RBAC, frontend SQL, إعادة كتابة legacy, تغيير العملة, المخزون المفقود الوهمي, التغيير التاريخي الصامت, version bump, إعادة هيكلة واسعة.

## 4) الامتثال لقواعد الأمان المطلقة (Safety Rules Compliance)

| القاعدة | الامتثال |
|---|---|
| لا إعادة كتابة POS/`index.html`/`admin/database.js` | ✅ صفر سطر في الثلاثة |
| لا تغيير checkout/payment/refund/void/transfer/stock/RPC/schema/IndexedDB | ✅ (برهان: p0 57 + p1 67 + guard 16 تُشغَّل على البناء الجديد) |
| لا إضعاف RBAC | ✅ (manager يقنَّع الأرباح سيرفرًا — phase6) |
| لا SQL أمامي | ✅ |
| لا كتابة Batman مباشرة على DB | ✅ (26 أداة read-only، phase5) |
| لا حذف تقارير/صفحات/كود قديم | ✅ (`admin/dashboard.html`, `admin/index.html`, legacy كمّلت كما هي) |
| لا اختراع تكلفة مفقودة | ✅ (`null` بدل `products.cost` الوهمي — phase6) |
| لا تغيير تاريخي صامت | ✅ (كل تغيير نتيجة موثق في §20/§21 ومقفل باختبار) |
| كل تغيير سلوكي معزول/موثق/مختبَر/مبرَّر | ✅ (`ACCOUNTING_CALCULATION_AUDIT.md`, `ACCOUNTING_MIGRATION_MAP.md`, `PHASE_4_FINAL_REPORT.md`) |

## 5) المستندات المرجعية (Reference Documents)

`CANONICAL_REPORTING_CONTRACT.md`، `ADMIN_REENGINEERING_PLAN.md`، `ADMIN_TARGET_ARCHITECTURE.md`، `ADMIN_FEATURE_MIGRATION_MATRIX.md`، `PHASE_1_DECISIONS.md` (D1/D2/…)، `PHASE_3_5_FINAL_REPORT.md`، `PHASE_3_5_VERIFICATION_GATE_REPORT.md`، `RBAC_MATRIX.md`، `DATA_OWNERSHIP_MATRIX.md`.

## 6) التدقيق المنجز (Audit)

جرد شملي **17 سطح حسابي** (`ACCOUNTING_CALCULATION_AUDIT.md`) لكل موقع/صيغة/حالة/برهان. **12 Converged + 4 Deferred (موثق) + 1 KEEP**. اكتشف التدقيق أيضًا انحرافات ثانوية موثقة (عدّادات expected المحلية، شريط POS، `_salesStats`، batman-dashboard) — كلها **مؤجلة** بقرار ولا تُلمس.

## 7) الالتزام بالعقد (Canonical Compliance)

| المقياس | الحالة بعد Phase 4 |
|---|---|
| GrossSales = Σsubtotal (paid) | ✅ (`getGrossSales`) |
| NetSales = Σtotal − Σrefunds | ✅ (`getNetSales:219`، `getSalesReport:67`) |
| Discounts = ΣdiscountAmount | ✅ (`getDiscounts:242` + `AdminAnalytics.discountAmountOf`) |
| AOV = Σtotal ÷ paidCount | ✅ (`getAOV` + `AdminAnalytics` avgOrder من gross) |
| COGS = Σqty×unitCost (وصفة→منتج→null) | ✅ (`getCOGS:252`، `getProductUnitCost:81`) |
| GrossProfit = Net − COGS (null ناقص) | ✅ |
| Operating = GP − Expenses | ✅ (`getFinancialReport`) |
| CashExpected (opening+cash−refund−expenses) | ✅ (تدقيقًا — لم يتغير) |
| purchases لا تُطرح من الربح | ✅ في المصدر المرجعي؛ batman-dashboard متبقي مؤجل (§24) |

## 8) المرحلة A1 — `reportService` (backend)

- `getSalesReport` — canonicalization كاملة (`reportService.ts:55-88`)؛ `netSales = revenue − refunds`؛ `prevNetSales` متسق؛ كتلة COGS قلّة؛ أضيفت `getDiscounts` و`getOrdersCount`.
- `getFinancialReport` — اكتمل التسلسل الكامل مع **completeness لكل مفتاح** (`:332,366-380`).
- نتائج refactor: إزالة `anyProductCost()` + اعتماد `getProductUnitCost`.

## 9) المرحلة A1 — `accountingService`

- `getSalesSummary` — استخدام مباشر للميتركس المرجعية (`:12-23`)، قيمة قبل/بعد مطابقة.
- `getFinancialReportForPeriod` — قناة واحدة عبر `reportService`.

## 10) المرحلة A1 — `routes/analytics`

- `/dashboard/kpis` — **مهايئ متقارب** فوق `reportService` (شكل JSON محفوظ — توافق أمامي). (`analytics.ts:29`)
- `/dashboard/top-products` — تكلفة عبر `getProductUnitCost` (وصفة أولًا)، `cost/profit=null` عند الجهل. (`:99,110`)

## 11) المرحلة B — تحديث انحدار legacy

- `test/phase2-services.cjs` — اعتقادات الحماية القديمة التي كانت «توتّد» الرقم المعوب (800) استُبدلت باعتقالات التقارب (815/Δ=0). التدفق صار: **convergence first**, ليس «code freeze of a bug».
- `test/phase3-admin.cjs` — غير مُلمس (فهم functional؛ fixture بلا وصفات → canonical يقع على `products.cost`، net=410 بالاسترداد 50). أخضر.

## 12) المرحلة C — حزمة انحدار جديدة `phase6-accounting-convergence`

ملف جديد `backend/test/phase6-accounting-convergence.cjs` (مُدمج في `npm test`): بيّنة HTTP حية على `dist/index.js` بمخزونات مؤقتة (`DB_PATH` tmp + منفذ حر + `child.kill()`/`fs.rmSync` على الخروج). **28/28**.

**بيّنة الأيام** (سند: `// fixture` في الملف):

| اليوم | المعنى | النتيجة المقفلة |
|---|---|---|
| A 2026-04-15 | الفيَكْس المرجعي net 815 (subtotal 950 / discount 15 / total 935 / refund 120) | تناغم cc/dashboard + cc/reports/sales + reports/sales (legacy) + dashboard/kpis جميعًا = 815 |
| B 2026-04-16 | درج النقود 3000 | expected=3000 actual=3050 diff=50 |
| C 2026-04-17 | COGS كامل recipe(2×40)+product(3×30)=170 | gp=540−170=370، completeness complete |
| D 2026-04-18 | COGS جزئي | cogs=null، gp=null، completeness partial/unavailable |
| E 2026-04-19 | COGS معدوم | null/unavailable |
| F 2026-04-20 | وصفة ناقصة → fallback products.cost 4×7=28 | complete |
| G 2026-04-21 | متعدد العناصر 40+60+7=107 + استرداد كارت 50 عند 23:59:59 | net=350, refunds داخل النطاق؛ خارج النطاق عند to=F |
| H 2026-04-30 | حدّ الشهر | O801 خارج/داخل (0→1)، net شهر = 5085 / orders 10 / aov 545.5 / cogs null |
| EMPTY 2026-04-01 | فترة فارغة | صفرية + `hasCostData=true` + `grossProfit {value:0, margin:null}` |

**أقراص إضافية**: RBAC (manager: net مرئي/أرباح null؛ cashier kpis 403؛ device 403؛ لا هوية 401)، completeness map 12 مفتاحًا.

## 13) المرحلة D — `admin-analytics` (frontend convergence)

- مساعد `discountAmountOf(o)` (`admin/admin-analytics.js:26`) — `discountAmount` وإلا `subtotal − total`.
- `discounts = Σ discountAmount` (`:90`)، `avgOrder = gross ÷ completed.length` (`:91`).
- `scripts/test-admin-analytics.cjs` محدّث (order1 += `subtotal:1400, discountAmount:400`) — **32/32**، avgOrder **700→750**، discounts **50→400**.

## 14) الأرطفاكت/البناء (Build Artifacts)

- `npm run build` (tsc) → **exit 0** (تشمل تغييرات reportService/accountingService/analytics). أُعيد البناء بعد آخر تعديل (اختبارات/عميل)، ثم أُعيدت كل حزمة backend فوق `dist` الجديد.
- `backend/package.json`: `npm test` = 8 سويات — **286/286 exit 0** (16+9+13+57+67+61+35+28).

## 15) الاختبارات الجارية & النتائج (فرز كامل)

| السويت | النتيجة |
|---|---|
| `guard-regression` | 16/16 |
| `checkout-idempotency` | 9/9 |
| `runtime-smoke` | 13/13 |
| `p0-money-guards` | 57/57 |
| `p1-followup` | 67/67 |
| `phase4-admin-write` | 61/61 |
| `phase5-decision-layer` | 35/35 |
| `phase6-accounting-convergence` | **28/28 (جديد)** |
| **backend total** | **286/286** |
| `c2-tests/run-tests` | 17/17 |
| `c2-tests/accounting-tools` | 17/17 |
| `c2-tests/knowledge-unit` | 12/12 |
| `c2-tests/rpc-v1-checkout-model` | 16/16 |
| `scripts/test-admin-api` | 21/21 |
| `scripts/test-shifts` | PASSED |
| `scripts/test-employee-invite` | PASSED |
| `scripts/test-admin-analytics` | **32/32** |

## 16) أدلة تقارب النقاط (Cross-Endpoint Convergence)

لليوم A (فيxكس 815): `GET /api/cc/dashboard` (netSales=815) = `GET /api/cc/reports/sales` (net=815) = `GET /api/reports/sales` (legacy net=815) = `GET /api/dashboard/kpis` (sales.value=815). شهر 2026-04: `cc/dashboard` (net=5085/10) = `reports/sales`. (phase6 أدلة مباشرة.)

## 17) أدلة COGS (4 حالات + إضافات)

recipe(2×40)+product(3×30)=**170** كامل؛ partial→**null**؛ unavailable→**null**؛ recipe ناقصة fallback `products.cost` 4×7=**28**؛ متعدد العناصر 40+2×30+7=**107**. `getProductUnitCost` يطابق `inventoryByTrimmedName` للوصفات.

## 18) أدلة درج النقود

B: opening 1000 + cash payments 2500 − cash refunds 200 − cash expenses 300 = **3000** (actual 3050, diff 50). A: 1000+935−120−300=**1515** (تعرض card-expense لا تدخل — خارج الصيغة السيرفرية same توقعت).

## 19) أدلة RBAC (لا إضعاف)

manager: `net` مرئية لكن `cogs/grossProfit/operatingProfit/financial=null` (قناع سيرفري `controlCenter.ts:131`)؛ cashier → kpis **403**؛ device key → cc/dashboard **403**؛ لا هوية → **401**.

## 20) تغييرات نتائج موثقة (Result Changes)

| القياس | قبل | بعد | السبب (قرار) | الاختبار |
|---|---|---|---|---|
| netSales (مرجع A) | 800 | **815** | إزالة الخصم المزدوج (D1) | phase2, phase6 |
| avgOrder (admin) | 700 | **750** | على أساس ما قبل الاسترداد | test-admin-analytics |
| discounts (admin) | 50 | **400** | `Σ discountAmount` (D2) | test-admin-analytics |
| فارغ kpis `hasCostData` | false | **true** (+`{0,null}`) | اتساق «صفر كامل» | phase6 |
| top-products بلا cost | `products.cost` (قد يكون 0) | **null** | لا اختراع تكلفة | phase6 |

هذه تحسينات صحيحة مبرَّراتها في العقد؛ **ليست** ضررًا تاريخيًا صامتًا (كل منها معزول، موثق أولًا، وله اختبار).

## 21) تغييرات سلوكية مقصودة (Documented Intentional Changes)

1. `dashboard/kpis` أسلمتين المهايئ: فترة فارغة = صفر كامل (`hasCostData=true`، `grossProfit {value:0, margin:null}`) بدل التقارير «unavailable».
2. `top-products` لا يلبس `products.cost` وهمية؛ `cost=null` يظهر «—».
3. `getSalesReport` بلا خصومات مكررة (القيمة 815).
كلها متوافقة مع سلوك العرض null-safe للمستهلكين (تحقق من `dashboard.html:413`, `index.html` renderTopProducts).

## 22) نو تشاينجيز (المسارات المحمية — صفر لمس)

checkout/void/refund/stock/`crud.ts:159 serverOrderTotals`/sync/RPC/IndexedDB v9/schema unchanged. برهان إعادة التشغيل: p0 57، p1 67، guard 16، checkout-idempotency 9، runtime-smoke 13 كلها خضراء **على البناء الجديد**.

## 23) تدقيق باتمان (Batman Audit)

- **قرار**: لا أداة تنفيذ جديدة في `decisionService` — قائمة `listActions` باقية **26 أداة** (ثابت ومقفل في `phase5-decision-layer`).
- باتمان في هذه المرحلة **طبقة قراءة/تفسير فقط** (`BATMAN_ARCHITECTURE` §2): كل الأدوات read-only وقراءتها تمر عبر خدمات الخلفية المتقاربة (financials فهوا عبر reportService/accountingService).
- `_salesStats` يظل أداة [بيان] مؤجلة (§24).

## 24) عناصر مؤجلة (Deferred Items — قرار صريح)

| # | العنصر | المرجع | لماذا مؤجل | الجهة المستقبلية |
|---|---|---|---|---|
| 1 | توسيع `paymentStatus='paid'` ليشمل `completed/closed` في `_salesStats` | عقد §31 | تتطلب قرار أوسع (معناه عند POS/sync) | مرحلة القرارات المالية |
| 2 | عدّادات `expectedCash` المحلية (`admin/database.js:1927-1931`) + `netCash:2058`/`netRevenue:2083` | عقد §58 | مسار معروف؛ توحيد الاشتقاق يتطلب اختبار parity جانب IndexedDB | مرحلة cash service (6+) |
| 3 | شريط POS الفوري (يشمل pending) | Audit §12 | قاعدة لا لمس POS | مرحلة واجهات |
| 4 | `batman-dashboard` صيغ الربح المتعددة (مشتريات داخل الربح: L330/486/651/773/864-865/1329) | Audit §14 | عرض تفسيري لا كاتب؛ خارج نطاق الأرقام | مرحلة الواجهات |
| 5 | Supabase/RPC صيغ cloud | `ADMIN_REENGINEERING_PLAN §1.2` | RPC مفقودة + schema v1 | مرحلة ترحيل cloud |

لا تُلمس هذه في Phase 4؛ كلها مسجلة مع الجهة/المرحلة.

## 25) سلامة البيانات/schema

صفر migration جديد، صفر تغيير في `schema.sql`، صفر تغيير في DB_VERSION (IndexedDB v9). الاختبارات تستخدم DB مؤقتة (`DB_PATH` tmp) وتبقي المسار فارغًا بعد الخروج — لا تلوث لبيانات dev/prod.

## 26) التوافق الخلفي (Backward-Compat)

- شكل استجابة `/api/dashboard/kpis` محفوظ (المستهلكون `CC` + `dashboard.html` + `index.html` يعملون كما هم: تحقق من سلوك العرض).
- `/api/reports/sales` legacy endpoint باقٍ ومتقارب رقميًا (net=815).
- admin frontend: `test-admin-analytics` 32/32 بلا تغيير في واجهات (متوقع).

## 27) المخاطر & التخفيف (Risks & Mitigations)

| الخطر | الرصد | التخفيف |
|---|---|---|
| خطأ في صيغة net (خطأ D1-نمط) يُعاد | تستنبط التقييم بوحدات خاطئة | 4 حالات COGS + تقارب 4 نقاط + fixture 815 |
| تغيير سلوكي غير وثيق | — | §20/§21 + قفل باختبار في كل تغيير |
| اختلاف local vs server | عقد §58 | موثق/مؤجل؛ لا يُعتمد عليه كسجل |
| كسر شكل استجابة kpis | — | شكل JSON محفوظ صراحة في المهايئ + اختبار |
| توثيق يخالف الكود | — | كل مرجع `file:line` (audit §2) |

## 28) خطة التراجع (Rollback)

تُدار عبر ريفرتينغ الـ3 تعديلات الكبيرة (reportService/accountingService/analytics) + استعادة `admin-analytics.js` المساعد الجديد + سحب fixture الفترة المرجعية من phase2 — بدون أي migration (لا schema). لا يمسّ بيانات.

## 29) التسليمات (Deliverables)

1. `docs/ACCOUNTING_CALCULATION_AUDIT.md` (17 سطح + 4 مؤجلة + 5 result changes).
2. `docs/ACCOUNTING_MIGRATION_MAP.md` (17 سطر هجرة + قواعد gates).
3. `docs/PHASE_4_FINAL_REPORT.md` (هذا الملف).
4. `backend/test/phase6-accounting-convergence.cjs` (28 شكايات، في `npm test`).
5. تعديلات backend (reportService/accountingService/analytics) مطابقة للعقد.
6. `admin/admin-analytics.js` متقاربة (discounts/avgOrder) + `scripts/test-admin-analytics.cjs` (32/32).

## 30) الخطوات التالية (Next Steps)

1. **الأرقام**: live-parity دوري (`/api/reports` vs `AdminAnalytics`) على بيانات حقيقية قبل أي نقل بصري باقٍ.
2. **الواجهات**: نقل قراءة لوحة `index.html` إلى `/api/cc/reports/:type` بعد تثبيت التطابق (قاعدة D8/D9).
3. **قرار العناصر المؤجلة** (§24) — خاصة `_salesStats`/`paid` وexpectedCash.
4. **Cloud**: تنفيذ RPC مطابقة + schema v2 (camelCase+RLS) في مشروع منفصل.
5. **شريط POS/Batman**: إعادة تسمية `gross` وعرض purchases خارج الربح في مرحلة الواجهات.

## 31) الحكم النهائي (Verdict)

**PASS** — تقارب الأرقام المالية على العقد المرجعي اكتمل في النطاق المسموح؛ صفر لمس للمسار المالي الساخن، صفر schema change، صفر إضعاف RBAC، وكل تغيير رقمي **موثق + مقفل باختبار (286 backend + 32 admin + 8 حزم دعم خضراء + build exit 0)**. العناصر المتبقية **مؤجلة بقرار صريح** وليست ضمن هذا النطاق.