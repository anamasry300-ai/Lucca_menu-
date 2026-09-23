# سجل قرارات Phase 1 (PHASE1_DECISIONS)

> المستند: `docs/PHASE1_DECISIONS.md` — مخرج Phase 1.
> كل قرار: **Decision / Evidence / Options / Chosen / Reason / Risk / Migration Impact / Rollback**.

---

## D1 — تعريف صافي المبيعات (Net Sales)

**Decision:** `NetSales = Σ(total) − Σ(refunds)` حيث `total` **بعد الخصم أصلاً** (`subtotal − discountAmount + tax`). الخصومات تُعرض كـ KPI منفصلة (`Σ discountAmount`) ولا تُطرح ثانية.

**Evidence:** `reportService.ts:73` `netSales = revenue − discounts − refunds` و`revenue = SUM(total)` (paidOrdersSummary)؛ `admin-analytics` `net = gross − refunds`؛ `_salesStats:2131` `net = gross − refunds`؛ `serverOrderTotals` (crud.ts:159) يثبت `total` بعد الخصم.

**Options:** (a) `Σ subtotal − discounts − refunds` (يعيد تعريف revenue كأصلي قبل الخصم)؛ (b) `Σ total − refunds` (يبقي `revenue=Σ total`).

**Chosen:** (b) — أقل صدمة: `total` هو الرقم الموثوق المنسوب للمال، وخصم منفصل أمر منفصل.

**Reason:** إبقاء `revenue` كرقم المبيعات المعروض (لا يغيّر دلالته في النظام الحالي)، وتعديل netSales في reportService فقط.

**Risk:** من طبقة العرض في admin-analytics (تسمية `gross` توحي بالمقوام قبل الخصم) — تُعاد تسمية في Phase 4.

**Migration Impact:** **reportService.ts:73** تغير الصيغة فقط (لا جداول). لا يغيّر ما في POS/sidebar.

**Rollback:** إعادة السطر الأصلي (محفوظ في git history قبل أي تعديل مستقبلي).

---

## D2 — الخصم في تقارير admin-analytics

**Decision:** KPI الخصومات = `Σ discountAmount` (مبلغ), **ليس** `Σ o.discount` (نسبة).

**Evidence:** `admin-analytics.js:83` يجمع `o.discount` — وهذا الحقل `discount` هو **نسبة** في نموذج order (`discountType: percent`).

**Options:** (a) جمع `discountAmount`؛ (b) حساب `discountAmount` إن غاب؛ (c) إبقاء النسبة كمقياس.

**Chosen:** (a).

**Reason:** المبلغ متاح في كل order؛ جمع النسب لا معنى نقديًا.

**Risk:** منخفض — عمليات حساب لا schema.

**Migration Impact:** طبقة العرض فقط (Phase 4).

**Rollback:** إعادة سطر الجمع السابق.

---

## D3 — الربح وقاعدة «المشتريات ليست مصروفًا»

**Decision:** الربح التشغيلي = `Gross Profit − expenses`؛ المشتريات تدخل عبر COGS عند البيع فقط، ولا تُطرح من الربح مباشرة.

**Evidence:** 3 صيغ مختلفة: `batman-dashboard.js` ~330 `profit=sales−expenses`؛ ~486 `net=sales−expenses−purchases`؛ `getDailySummary:2432` `profit = net − expenses − purchases`. والأخيرة أعطت المشتريات دور المصروف.

**Options:** (a) توحيد على `net − cogs − expenses` (مع COGS)؛ (b) `net − expenses − purchases` (خاطئ ماليًا — مشتريات ≠ نفقة)؛ (c) الاثنان.

**Chosen:** (a).

**Reason:** مع COGS تضبط القيمة؛ purchases تحوّل مخزونًا ولا تُستهلك في الفترة إلا عبر COGS.

**Risk:** لو أبلغ المستخدمون توقعهم طرح purchases مباشرة، ينخفض الربح الظاهري.

**Migration Impact:** باتمان dashboard + getDailySummary — تُعاد جلبتها في Phase 7 مقابل command, ثم تُصحَّح الصيغ.

**Rollback:** إعادة الحساب القديم في المكانين.

---

## D4 — تاريخ الاسترداد / أساس فترة Retrorefunds

**Decision:** الاستردادات تُخصم في فترة `refunds.createdAt`, والطلبات المدفوعة تُصنع بفترة `orders.date`؛ الفلاتر المالية تشمل `paymentStatus='paid'` فقط.

**Evidence:** `paidOrdersSummary` فلتر `paymentStatus='paid'`؛ ai-pos يتحدّر صفوف `completed/closed` حتى دون paid.

**Options:** (a) الفترة المالية = `orders.date` + `refunds.createdAt`؛ (b) توحيد بالـ `createdAt` لكل صف.

**Chosen:** (a).

**Reason:** مطابق لسلوك الحالي؛ الطلبات المدفوعة تُحسب بيوم العمل، والاسترداد بيوم حدوثه.

**Risk:** منخفض — انحياز تواريخ إذا أُغلقت طلبات متأخرًا.

**Migration Impact:** توصّح مستند فقط؛ أساس فترة reportService الحالي `from/to` بـ `date`.

**Rollback:** تنقيح الوثيقة.

---

## D5 — سلطة الكتابة المالية الواحدة

**Decision:** في كل وضع (local/cloud) يوجد **كاتب واحد وحيد** للماليات: local → backend SQLite عبر checkout/void/refund؛ cloud → Supabase (RPC). لا مسار كتابة ثانٍ لهذ الفئات.

**Evidence:** POS يكتب orders محليًا عبر REST ثم checkout server-side؛ payments/refunds/stock تُكتب server-side فقط (p1-followup يثبت لا hasiab محلي). P3 أظهر dual-write في cloud.

**Options:** (a) كاتب واحد لكل وضع؛ (b) السماح بالكتابة المحلية كمرآة دائمًا (بقاء P3 مفتوحًا).

**Chosen:** (a).

**Reason:** إنهاء خطر التكرار/الفساد المالي (P3/P2).

**Risk:** قطع mesh للمرآة المحلية عند تجربة cloud-only — مقبول (الماليات خارج الـ REST المحلي في cloud).

**Migration Impact:** D6 يغلق dual-write الآن؛ ترحيل Phase 2+ يوحّد باقي الكتالوج.

**Rollback:** إعادة فتح REST layer للـ orders في وضع cloud (غير مطلوب — قرار مضاد).

---

## D6 — غطاء الحماية: إغلاق الكتابة المالية المحلية في الوضع السحابي (CODED — تنفيذ Phase 1)

**Decision:** في `_enqueueOrderSync()` (index.html:5346) يُضاف فحص مبكر: `if ((localStorage.getItem('luccaDataMode') || 'local') === 'supabase') return;` — بحيث لا يوجّه POS أي REST كتابة للـ backend المحلي للماليات عندما الوضع cloud، والـ local يبقى يعمل كما هو.

**Evidence (قبل):** probe `phase1-dualwrite-probe.cjs` أظهر: (A) order بتعرف cloud id → PUT /api/orders/999999999 = 404 (بقايا طابور تعيد المحاولة، شريط أحمر كاذب)؛ (B) تعارض مع طلب محلي pending → 200 واستبدال كامل للصف (dup/corruption مثبّت)؛ (C) تعارض بنفس الإجمالي → 200 استبدال؛ (D) local mode → 200 يعمل.

**Evidence (بعد):** نفس الـ probe بعد الرقعة: `guardPresent: true`, الحالات A/B/C → `fetchLog: []`, `queueLen: 0`, `localRowMutated: false` → `postPatchCloudModeClean: true`؛ D → ما زال 200.

**Chosen:** سطر حماية واحد أمين (لا refactor).
**Reason:** أخف إصلاح يُغلق كتابة الماليات المحلية في cloud، مع استبقاء كامل للوضع المحلي. لا تعليق كود مضاف (قاعدة المشروع).

**Risk:** منخفض جدًا؛ السطر إضافي فقط بعد early-exit الـ id. في وضع supabase لا REST للـ orders يضيع (لم يكن يصل: 404/استبدال معيب).

**Migration Impact:** في الطابور السحابي صفوف orders قائمة لم تعد تُرسل — لكنها لم تكن صالحة (P3); العقد D5 يفرض مسار RPC لاحقًا.

**Verification:** الست baseline suites بعد الرقعة: run-tests 17/17, rpc-v1-checkout-model 16/16, accounting-tools 17/17, p1-followup 67/67, runtime-smoke 13/13, server-smoke 6/6.

**Rollback:** إزالة السطر (مُسجَّل في هذا المستند — إعادة الفتح تتطلب قرارًا مؤكدًا).

---

## D7 — توحيد طابور المزامنة

**Decision:** طابور واحد مستقبلاً بصيغة واحدة (§5 عقد المزامنة: `{id, entity, entityId, operation, payload, source, mode, status, createdAt, updatedAt, retryCount, lastError}`) ودورة `pending→processing→synced|failed|dead_letter`. **لا يُوحَّد الآن** — توثيق فقط؛ التوحيد يتم في Phase مع test-first لتجنّب كسر hot path.

**Evidence:** ثلاث صيغ على نفس المفتاح `lucca_sync_queue` (index.html:5259 s1, sync-engine.js s2, ServerSync دُفعة) — P2.

**Options:** (a) مفتاح واحد جديد، (b) إبقاء وضعين بمفاتيح مختلفة، (c) مفتاح موحّد بتنسيق v2.

**Chosen:** (c) كهدف مع انتقال تحكمي.

**Reason:** إزالة سوء الفهم P2 دون كسر سير العمل الحالي.

**Risk:** أثناء الانتقال قد يُطبع صفان — تُدار بمفتاح انتقالي.

**Migration Impact:** Phase 10 (Sync cleanup)؛ الاختبارات قبل/بعد.

**Rollback:** إبقاء الصيغتين حتى يثبت الانتقال.

---

## D8 — عقد تقارير موحّد

**Decision:** كل الطبقات العارضة للاشمئزاز المالي تعتمد النموذج المتفق عليه في CANONICAL_REPORTING_CONTRACT (بالفصل: gross/discounts/refunds/net/AOV/COGS/grossProfit/expenses/operatingResult/…) والمصدر الوحيد المراد = `backend/src/services/reportService.ts` (أو RPC مطابق في cloud).

**Evidence:** 4+ طبقات تعيد تنفيذ الحسابات (P1).

**Options:** (a) reportService كمرجع واحد، (b) مكتبة JS مشتركة في الواجهات، (c) كل طبقة كما هي.

**Chosen:** (a) — يتم دفعها في Phase 3/4 للواجهات، مع تطابق (live-parity) مطلوب قبل كل نقل.

**Reason:** يزيل تعارض الصيغ من الجذور؛ يضمن أرقامًا قابلة للتدقيق.

**Risk:** نقل Admin الجزئي يجب أن يتوافق مع الأساس الحالي محليًا بدقة.

**Migration Impact:** admin-analytics (Phase 3) + batman-dashboard + _salesStats (4/7).

**Rollback:** لكل انتقال، بين 0 الخاصة به.

---

## D9 — كاتب/مرجع لكل كيان في الوضع المحلي

**Decision:** محليًا: الماليات تُكتب في backend SQLite حصرًا عبر checkout/void/refund؛ الكادر/الطلبات المفتوحة في IndexedDB (LuccaDB) وتُعالج عبر ServerSync؛ وتُقرأ التقارير المالية من backend reportService. (انظر DATA_OWNERSHIP_MATRIX.)

**Evidence:** بنية الكود: POS يكتب IndexedDB + يوجّه REST للـ backend؛ payments/refunds/stock server-side.

**Options:** (a) كما أعلاه، (b) تحويل كل شيء لـ backend-first الآن.

**Chosen:** (a) — أصغر صدمة ويحل الالتباس التدريجي.

**Risk:** إبقاء مصدرين (IndexedDB/backend) يتطلب انضباط sync أقوى حتى توحيد Phase 2/10.

**Migration Impact:** الفجوات الحالية (POS pending يُعرض في dashboard من IndexedDB خارج الماليات) موثقة في عقد التقارير.

**Rollback:** لا تغيير كود — تمثيل وضع قائم فقط.

---

## D10 — الأدوار المستهدفة (RBAC)

**Decision:** الأدوار الهدف = ADMIN, MANAGER, SUPERVISOR, CASHIER, KITCHEN, ACCOUNTANT, AI_ASSISTANT (+DEVICE) بنموذج المصفوفة في RBAC_MATRIX. الترحيل: جدولة ROLE_PERMISSIONS الحالية أولاً ثم إضافة الأدوار الجديدة.

**Evidence:** ROLE_PERMISSIONS (auth.ts:119)؛ حواجز crud.ts؛ مصفوفة batman (001). SUPERVISOR/ACCOUNTANT/AI_ASSISTANT ليسا في الكود.

**Options:** (a) 5 أدوار قائمة فقط + overlay؛ (b) 8 أدوار بعقد RBAC.

**Chosen:** (b) — مشتق من الخطة §8 والسلوك الحالي (المصفوفة تستند لأدلة سلوك).

**Reason:** إضافة دورين بشريين + AI كطبقة خدمة تُمتدح خط الأعمال دون كسر الرولات الخمسة.

**Risk:** قفل عرضي لموظف عند الترحيل → seeds idempotent + مراجعة لكل صلاحية ضد DO Matrix.

**Migration Impact:** Phase 6; الاختبارات p1-followup تؤكد سلوك الأدوار الحالية قبل/بعد.

**Rollback:** الأدوار الخمسة الحالية مصدرها الكود — العودة سهلة بإبقاء SEED.

---

## D11 — نموذج COGS

**Decision:** COGS = Σ(order_item.quantity × unitCost) لطلبات مدفوعة؛ unitCost من recipe-first ثم products.cost؛ بدون بيانات → `null` (عرض «غير متاح») ولا يُقدَّر.

**Evidence:** `ordersRepo.cogsFor` (recipe-aware)؛ `reportService` hasCostData → null؛ `product_recipes` موجود بمكوّنات.

**Options:** (a) recipe-first/fallback products.cost، (b) COGS دائمًا من products.cost، (c) تقدير.

**Chosen:** (a).

**Reason:** الوصفة أكثر دقة (عقد P11/Phase 5)، وB. يمنع الأقزام لكل المنتجات (كانت تكلفة 0 في بعض القوائم).

**Risk:** تعديل تكلفة لاحق لبعض المنتجات بلا وصفة → unitCost ناقص حتى تُعبّأ الوصفات.

**Migration Impact:** Phase 5 (Inventory/Purchases) + إكمال وصفات فعلية؛ لا برمجيات في Phase 1.

**Rollback:** products.cost يعمل فورًا بدون Migration.

---

## D12 — الصندوق النقدي (Cash Drawer)

**Decision:** `expectedCash = openingBalance + cash payments − cash refunds − cash expenses` مشتقٍ **سيرفرًا**؛ `actualCash` عند الإغلاق إدخال بشري؛ `difference = actual − expected`.

**Evidence:** `database.js:1927-1931` يحسب expected من عدّادات محلية (خلافًا للمبدأ)؛ c-shыДالمقفلة special.ts؛ `cash_registers` بها version optimistic.

**Options:** (a) اشتقاق سيرفري، (b) عدادات محلية تُحسب، (c) mix.

**Chosen:** (a) — موافقة عقد التقارير ومبدأ الكتابة المالية الواحدة.

**Risk:** تعديل السلوك بعد ترحيل في Phase 4/6 — لا تغيير Q1.

**Migration Impact:** Phase 4 (تسوية) وPhase 6 (cash service); اختبارات قبل/بعد.

**Rollback:** ترقية كود فقط.

---

## ملخص التنفيذ في Phase 1

| | |
|---|---|
| `docs/` الجديدة | 7 ملفات (هذا، CANONICAL_REPORTING_CONTRACT، BATMAN_ARCHITECTURE، RBAC_MATRIX، DATA_OWNERSHIP_MATRIX، SYNC_CONTRACT، DATA_MODEL) |
| معدَّل | `docs/ADMIN_REENGINEERING_PLAN.md` (روابط + حالة) و`index.html` (سطر حماية D6 فقط) |
| tests baseline | 6/6 خضراء (136 تمريرًا) — أعلاه |
| Code changes | **واحد فقط**: سطر القنطرة D6 في `_enqueueOrderSync` |

لا commit، لا بناء، لا bump version — وفق القواعد.