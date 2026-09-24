# Phase 5A — RBAC & Write-Path Closures — التقرير النهائي

**النطاق:** LuccaPOS — `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-` — أساس `ade80af`
**التاريخ:** 2026-09-24
**المرجع:** `docs/PHASE_5_AUDIT.md` (القسم 17 — خطة 5A، وS1/S2/S3)

> ملاحظة: هذا التقرير يغلق **5A فقط** وهو **ليس** إعلان استكمال المرحلة الخامسة كاملة. بقية بنود
> المرحلة (5B/5C/5D) خارج هذا النطاق ومؤجّلة صراحة في القسم 9.

---

## 1) الأسباب الجذرية (Root Causes)

| # | المشكلة | السبب الجذري |
|---|---------|--------------|
| **A** | `SYNC-1` — كتابات المزامنة المالية/الإدارية بلا تفويض لكل مخزن | حارس `/api/sync` يكتفي بـ `requirePermission('sync')` + `ADMIN_ONLY_STORES`. مخازن `purchases`/`expenses`/`suppliers`/`product_recipes`/`waste_log` ليست ضمن `ADMIN_ONLY_STORES`، وكل الأدوار المحدودة (cashier/kitchen/device) تملك `sync` → كانت كتاباتها تُدمج دون أي فحص صلاحية كتابة للمخزن. |
| **B** | `BM-1/BM-2` — مصروف الدردشة يتجاوز طبقة قرار باتمان | `window.saveExpenseFromText` (الحارس الموحّد) يُكتب فيه المصروف مباشرة إلى `Expenses.add` دون مرور `_decide('add_expense', …)`. تُستدعى مباشرة من `batman-dashboard.js sendChat`, و`index.html` مسارين. مسار المحرك (`toolAddExpense`) كان الوحيد الذي يستدعي `_decide` مسبقاً. كما أن `/api/batman/check` كان يقبل دوراً من الـ body لهوية الـ device (دور عميل غير موثوق). |
| **C** | `EXP-21` — الكاشير يكتب حقول `cash_registers` المالية | `writeDenied` في `crud.ts` يخلّي مخزن `cash_registers` للصلاحية `cash-registers.write`، والكاشير يملكها في `ROLE_PERMISSIONS` → يستطيع POST/PUT تزوير `expectedCash/actualCash/difference/إقفال` عبر `/api/cash_registers`. (المزامنة كانت تحجبها أصلاً عبر `ADMIN_ONLY_STORES`). |

## 2) الملفات المتغيّرة (Files Changed)

| ملف | التغيير |
|-----|---------|
| `backend/src/index.ts` | +31 سطر: `SYNC_WRITE_PERM`/`SYNC_ADMIN_ONLY` (تعريف)، حارس RBAC لكل مخزن داخل حلقة `/api/sync`. |
| `backend/src/routes/crud.ts` | +4 أسطر: منع كتابة `cash_registers` لغير admin/manager في `writeDenied`. |
| `backend/src/controllers/batmanController.ts` | `checkDecision`: الدور يُشتق دائماً من الهوية (`req.identity.role`) ويُتجاهَل `body.role` بالكامل. |
| `ai-pos-engine.js` | حارس قرار باتمان داخل `saveExpenseFromText` (قبل أي كتابة DB)؛ تمرير قرار المحرك من `toolAddExpense`؛ توثيق قرار القناة المباشرة. |
| `backend/package.json` | إضافة `phase5a-rbac-write-paths.cjs` إلى سلسلة `npm test`. |
| `backend/test/phase5a-rbac-write-paths.cjs` | جديد: 34 سطر تأكيد (A: 17، B: 9، C: 8). |

لا تغييرات في الـ schema/المها&#1569;/الإعدادات. `git diff --check` نظيف (تحذيرات LF→CRLF فقط).

## 3) تعديلات التفويض الدقيق (Exactly — Authorization)

### A) `/api/sync` — RBAC لكل مخزن
- تُضاف بعد حارس `ADMIN_ONLY_STORES` داخل حلقة المخازن (قبل أي INSERT/UPDATE):
  - **غير admin** + مخزن في `SYNC_ADMIN_ONLY` (`suppliers` فقط) → **skip** السبب «مخزن إداري — يلزم صلاحية admin (إدارة الموردين)».
  - **غير admin** + مخزن في `SYNC_WRITE_PERM` بلا صلاحيته → **skip** السبب «صلاحية غير كافية لكتابة المخزن — يلزم X».
- الخريطة (مطابقة `crud.ts` + `WRITE_ADMIN_STORES`):
  `purchases→purchases.write`, `expenses→expenses.write`, `product_recipes→products.write`, `waste_log→inventory.write`, `suppliers→admin`.
- **Admin** يتجاوز الكل (مطابق للسلوك الحالي). **manager** يملك `purchases.write/expenses.write/inventory.write/products.write` فيُزامنها مشروعاً، ويُحجب عن `suppliers` (مطابق لـ CRUD). الأدوار المحدودة (cashier/kitchen/device) بلا هذه الصلاحيات → تُستبعد كتاباتها.
- بقية المخازن غير المالية (orders/tables/categories/…) سلوكها **لم يتغير** (لا دخول خريطة → كالسابق).
- الرفض **واضح**: `conflictDetail` يتضمن `store` + `reason` + عدد `skipped`، بلا حذف/استبدال لأي بيانات موجودة.

### B) نقاط الصلاحية على السيرفر
- `checkDecision` (`/api/batman/check`): `effectiveRole = identity.role` دائماً — لا `role` من الـ body لأي هوية (مستخدم أو device). لا تصعيد بدور مُرسَل عميلاً.
- `approve/execute` (`/api/batman/execute`): يبقى كما هو — `canRoleAct` يشتق الدور من هوية الجلسة (فعلياً `actorNameFor`) → كاشير بلا `expenses.write` **blocked** حتى بـ `explicitConfirm`.
- نقاط الكتابة السيرفرية للمصروف: `/api/sync` (+ A) و`/api/cc/expenses` (`expenses.write`) — كلاهما مرفض للكاشير/المطبخ/الجهاز.

## 4) تعديلات مسار كتابة المصروف في باتمان (Exactly — Batman write-path)

المسار الجديد في كل نقطة إنشاء:
`User → Batman(_decide) → Intent → Permission(server RBAC) → Tool → saveExpenseFromText → Expenses.add → (sync)/cc`.

- داخل `saveExpenseFromText(raw, providedDecision)`:
  1. تُحسب `decision` = `providedDecision` (مسار المحرك المحسوم) أو عبر `_decide('add_expense', amount)` (الدردشة المباشرة — server-first ثم local fail-closed).
  2. `decision === 'blocked'` → `{ok:false, ask:true, message:'🔒 '+reason}` قبل أي كتابة.
  3. `decision === 'needs_approval'` بلا `providedDecision` → لا يُكتب؛ يُطلب إعادة الأمر مع «تأكيد» كموافقة صريحة موثقة (مطابق لسياسة الحد 500)، وإلا رفض واضح `requiresApproval:true`.
  4. `under_threshold/executed` → يُكتب، مع `_recordBatmanDecision` لأي قرار حُسب في نقطة الدردشة (outbox عند انقطاع الشبكة).
- `toolAddExpense`: يمرر `params._expenseDecision` → **لا تتغير** سيمانتيك تأكيد المحرك (الموافقة الصريحة عبر الواجهة لا تُعيد الحساب).
- نقاط الدردشة (batman-dashboard.js:1237، index.html:6424 و:7297) لا تملك `providedDecision` → تمر بالحارس تلقائياً بلا أي تعديل على تلك الملفات.
- حدود المبالغ **لم تتغير** (لغة مصفوفة add_expense = 500)؛ الرفض **واضح وقابل للاختبار** عبر B1–B6.

## 5) تعديلات صلاحية `cash_registers` (Exactly — Cash-register authorization)

- في `writeDenied` (crud.ts): لغير `isAdminish(req)` (admin/manager) → مخزن `cash_registers` = مرفوض (403) على POST وPUT.
  - admin → يتجاوز عند رأس الدالة (كما هو).
  - manager → يمر (ليس في `WRITE_ADMIN_STORES`).
  - cashier/kitchen/device → **403** مهما امتلكوا `cash-registers.write/read`.
- القراءة: `readDenied` لم يتغير → `GET /api/cash_registers` تبقى وظيفية لكل هوية موثّقة.
- حارس «وردية واحدة مفتوحة» (409) **لم يتغير** — لكنه لم يعد يسبق حارس الصلاحية للأدوار المحدودة.
- الحذف يبقى admin/manager (كما هو بالحكم العام).
- الغاية: منع تزوير `expectedCash/actualCash/difference/إقفال` من طرف كاشير/جهاز/مطبخ.

## 6) الاختبارات

سلسلة `npm test` الحالية + **`backend/test/phase5a-rbac-write-paths.cjs` (34 تأكيدًا)**:

**A — Sync RBAC (المقصور):**
A1/A2/A3 cashier+kitchen+device→purchase مرفوضة · A4/A5/A6 →expense مرفوضة · A7 cashier→supplier مرفوضة · A7b manager→supplier مرفوضة · A8 cashier→recipe مرفوضة · A9 device→waste مرفوضة · A10 admin→expense مقبولة · A10b/c/d manager→purchase/expense/waste مقبولة · A10e kitchen→categories مقبولة (غير مالية) · A10f cashier→orders مقبولة (POS) · A11 بلا هوية → 401.

**B — Batman (المقصور):**
B1/B2/B2b/B2c: `/api/batman/check` يفرض دور الهوية (cashier/device/kitchen) ويتجاهل `body.role` · B3 كاشير create_expense بـ confirm → blocked · B4 أدمن create_expense → executed · B5 كاشير دفع مصروف عبر sync → مرفوض سيرفراً · B5b `/api/cc/expenses` كاشير → 403 · B6 مدير فوق الحد → executed.

**C — Cash-registers:**
C1/C2a/C2b cashier+kitchen+device → 403 · C3 admin → 201 · C4 وردية ثانية → 409 (السلوك القائم) · C5 manager PUT → 200 · C6 قراءة كاشير → 200 مجموع 34.

**المجموع الكلي بعد إضافة 5A:** 320 تأكيدًا ناجحًا / 0 فاشل.

## 7) نتائج الريغريس

| السويت | النتيجة |
|--------|---------|
| `node scripts/test-admin-login-matrix.cjs` (root) | 22/22 |
| `node scripts/test-ollama-runtime.cjs` (root) | 17/17 |
| `npm test` (backend، 9 ملفات) | 320/320 (منها 34 جديدة للـ 5A) |
| `npm run build` (backend) | PASS |
| `git diff --check` | 0 |
| `git status --short` | 5 ملفات معدّلة + ملفان غير متتبعين فقط (المتباين أدناه) |

`git diff --stat`: 5 ملفات، +70 / −7. لا ظهور لـ `dist/` (مهمَلة). لم يُنفَّذ أي commit/push/version bump.

```
 M ai-pos-engine.js
 M backend/package.json
 M backend/src/controllers/batmanController.ts
 M backend/src/index.ts
 M backend/src/routes/crud.ts
?? backend/test/phase5a-rbac-write-paths.cjs
?? docs/PHASE_5_AUDIT.md
```

## 8) ملاحظات المرحلة الخامسة المتبقية (Recording only — لم تُعالج في 5A)

- مزامنة المصروف من جهاز كاشير كانت «تعمل» سابقاً عبر /api/sync بلا صلاحية → الآن تُستثنى سيرفراً (تظهر الكمية في `skipped`). الواجهة قد تعرض المحتوى محلياً حتى يزامنه مؤهَّل؛ تنسيق تجربة الاستخدام/التعليمات يُؤجل إلى 5B.
- `record` في `/api/batman/record` يقبل أي هوية موثّقة، و`check` قرار استشاري (لا تنفيذ) — لا نعيد هندسة ذلك هنا؛ التنفيذ الفعلي يبقى محكوماً بـ `execute` + السيرفر.
- `cashier` يبقى يملك `cash-registers.write`/`read` في `ROLE_PERMISSIONS`؛ الإنفاذ عند كتابة CRUD أصبح server-side (لم نُعدم الصلاحية لتجنّب أثر جانبي على أي مسار إداري مستقبلي — يُراجع في 5D).
- مسار `update_price` (مصفوفة) وعموم مصفوفة الأدوار على الـ client (`_canonicalRole` يقرأ دور المستخدم المحلي) بقايا من بنود 5B/5D.
- `COGS` متعدد التطبيقات (INV-2/14)، حساب الربح الشبكي، و`daily-shifts` كلها بند 5C/5D — لم تُمس.

## 9) مؤجَّل صراحة (Explicitly deferred — خارج نطاق 5A)

- 5B: سدّ فجوات كتابة إضافية (attendance/stock عبر CSC، مسارات CC ناقصة التدقيق) + توحيد تعليمات/تجربة المتزامنة.
- 5C: إعادة احتساب `daily-shifts/cash_registers` على السيرفر (لن نعيد حسابها داخل 5A) وتوثيق الفروق النقدية المركزي.
- 5D: تنظيف الأدوار/الصلاحيات (`cashier.cash-registers.write`)، مصفوفة العميل، هجرة كلمات المرور، RAG/المعرفة.
- بنود خارج الإصلاح: المخططات (product_recipes/purchases/expenses/expense_categories)، إعداد المنصّة المنخفضة/الاحتياط، نسخة الأصول (version bump)، المسار الساخن للدفع/الإلغاء/الاسترداد، COGS القانوني، إصلاحات XSS غير ذات الصلة، تحسين الأداء، ترقيات الاعتماديات.