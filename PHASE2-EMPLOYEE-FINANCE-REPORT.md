# Phase 2 — Employee Attribution & Finance (Employee/Invoices/Expenses/Suppliers/Cash/Reports/Audit)

التاريخ: 2026-08-31 • النطاق: **Phase 2 only** • الحالة: التنفيذ مكتمل + اختبارات حقيقية خضراء • **بانتظار اعتمادك قبل أي مرحلة تالية (لا تُطلق H6)**

---

## 1. ما الذي فُحِص (What was checked)
- **النموذج الحالي للأدوار** (مُحتفظ بـه دون أي تغيير): `admin / manager / cashier / kitchen / device` — عبر `ROLE_PERMISSIONS` في `backend/src/auth.ts`.
- **الجلسة والربط**: `Users.getCurrentUser()` يُعيد `{id, username, name, role}` من `localStorage['currentUser']`. الربط يتم **دائماً تلقائياً من الجلسة** (وليس اختيار الموظف لنفسه).
- **تدقيق مالي**: كل عملية مالية مهمّة تُسجَّل؛ لا حذف صامت.
- **التعريف المالي (H5 موقَّت ومعتمد)**: الإيراد = الطلبات `paymentStatus='paid'` − الاستردادات؛ المعلّق/غير المدفوع/المسترد **ليست إيراداً**.
- **سلامة C2/schema**: لم يُلمَس جدول/ترحيل/list sync. العمود/الحقل الإضافي محلي يُقصّى عند الدفع للسيرفر (لا فشل، لا خسارة، لا تكرار).
- **نقص تم اكتشافه أثناء الفحص**: المصروفات والاستردادات **لم تكن تُسجَّل في درج الكاش**. أُصلح في النطاق (ميزة إضافية) لضمان صحّة المطابقة النقدية.

## 2. ما أُعيد استخدامه (What was reused — لا تكرار/لا جداول جديدة)
- Stores موجودة (IndexedDB): `expenses`, `suppliers`, `expense_categories`, `cash_registers`, `payments`, `refunds`, `invoices`, `audit_logs`, `orders`.
- `AuditLogs.log()` و`CashRegister.recordTransaction()` و`getActiveDrawer()` — أُعيد استخدامها كما هي.
- Endpoints خلفية موجودة لتقارير الإيراد/الموظفين: `/dashboard/kpis`, `/dashboard/employees`, `/dashboard/sales-by-day`, `/dashboard/refunds-voids` (كلها مُرشَّحة بـ `paymentStatus='paid'` من H5).
- تفويض H3/ROLE_PERMISSIONS وC2 Sync architecture كما هما — **بدون أي تعديل**.

## 3. الملفات المعدّلة (Files modified)
| الملف | التغيير |
|---|---|
| `admin/database.js` | `Expenses.add`: نسبة تلقائية `createdBy`/`userId` من الجلسة، تسجيل المصروف في الدرج مرّة واحدة، تدقيق `expense.create`، إرسال أعمدة موجودة فقط للخادم. `Expenses.delete`: تدقيق `expense.delete` (لا حذف صامت). `Expenses.update` يُقصّى أعمدة السيرفر. Checkout المحلي: `payment` يحمل `createdBy`/`userId`. |
| `admin/index.html` | نموذج المصروف (فئة من ExpenseCategories + مورد من Suppliers + طريقة دفع). جدول المصروفات (فئة/مورد/دفع/موظف). بطاقتا تقارير «المصروفات» و«ملخص الصندوق» + فرعا `loadReport('expenses')` و`loadReport('cash')`. تعيين `window.__luccaRole` عند الدخول وخفض أزرار الحذف للكاشير. توحيد إيراد AI الإداري على `paid` (H5). |
| `index.html` | تدفّق الإلغاء/الاسترداد: تسجيل درج `refund` + تدقيق `order.void_refund` + إضافة `userId` لسجل الاسترداد. |
| `backend/src/routes/analytics.ts` | **جديد**: `GET /dashboard/expenses` (إجمالي + حسب الفئة + حسب الموظف داخل المدّة) — أعمدة `expenses` الموجودة فقط، لا تغيير schema. |

## 4. تدفّق البيانات (Data Flow)
```
[POS checkout] order(createdBy) + invoice(createdBy) + payment(createdBy,userId)  →  Orders store
[admin] Expense form (desc/amount/category/supplier/paymentMethod/notes) → Expenses.add
        └─ يضيف createdBy/userId من الجلسة
        └─ يسجّل في الدرج: recordTransaction('expense', ...)  مرة واحدة
        └─ تدقيق: AuditLogs.log('expense.create', ...)
        └─ push للخادم: description/category/amount/notes/date/createdBy (المتوافق)
[POS void/refund] refund record(createdBy,userId) + order→cancelled/refunded
        └─ درج: recordTransaction('refund', ...)
        └─ تدقيق: AuditLogs.log('order.void_refund', ...)
[C2 sync] push/pull آمن → الخادم ينسخ الأعمدة الموجودة فقط (لا unknown-column/خسارة/تكرار)
[Reports] /dashboard/expenses + /dashboard/employees + /dashboard/kpis + لوحة «ملخص الصندوق» (محملياً)
[Cash] Expected = Opening + CashSales − CashExpenses − CashRefunds  (formula في recordTransaction)
```

## 5. الصلاحيات (Permissions — ROLE_PERMISSIONS)
- `cashier`: لا يملك `expenses.write`/`refunds.write`/`reports.read`/`settings.read` → **لا ينشئ مصروفاً، لا استرداداً، لا يحذف، لا يقرأ التقارير** (أُكِّد بالاختبار 403).
- `cashier` يملك `checkout`/`payments.write`/`orders.*` فقط — لا تحرير أسعار/إلغاء/إعدادات.
- `manager`: يملك `expenses.write` + `reports.read` + `payments/refunds` (200/201).
- `admin`: كامل (`*`).
- `device`: مفتاح الجهاز — قراءة `expenses` فقط، لا حذف (403). المخازن الإدارية (`users/settings/audit_logs/daily_shifts/shifts`) إدارية فقط.

## 6. التدقيق (Audit — لا حذف صامت)
- `expense.create` / `expense.delete` / `order.void_refund` تُكتب عبر `AuditLogs.log` مع `userId/userName` و`oldValue/newValue`.
- العميل يسجّل محلياً كامل السجل؛ والخادم يخزّن أعمدة `audit_logs` الموجودة (سجل مجمّع عبر sync).
- ملاحظة الحقل `source`: لتجنّب تغيير schema/backend، لم أضِف عمود `source`؛ **كل سجلات التطبيق الآن مصدرها `ui`** (لا عميل agent بعد)، ويمكن تمييز عمليات مستقبلية من أي عميل آلي ببادئة action (مثل `batman:...`) دون ترحيل.

## 7. التقارير (Reports — بيانات حقيقية لا مصطنعة)
- **المصروفات**: `GET /dashboard/expenses` → إجمالي + حسب الفئة + حسب الموظف (نطاق زمني). +(تفاصيل المورد/طريقة الدفع/الموظف في العميل محلياً).
- **الموظفون**: `/dashboard/employees` → مبيعات مدفوعة فقط لكل موظف (من `createdBy`).
- **الصندوق**: «ملخص الصندوق» محلياً من `cash_registers` → فتح/أساسي/كاش/كارت/مصروفات/مرتجعات/متوقع/فعلي/فرق/حالة، لكل درج في المدّة.
- **KPIs/صافي المبيعات**: `/dashboard/kpis` = مدفوع − استرداد (H5).
- التقارير تُبنى على فواتير/مدفوعات/مصروفات حقيقية؛ لا ربح صندوقي كاذب/COGS وهمي.

## 8. الاختبارات (Tests — منفّذة وموثَّقة على Test DB، ليست فحصاً ساكناً)
### جديد (Phase 2)
- **`p2-finance.cjs` (تكامل على Test DB): 37 / 37 PASS**
  - تسجيل دخول admin + تغيير كلمة + إعادة دخول؛ إنشاء cashier/manager وتسجيل دخولهما.
  - مورد (sync يحفظ `name`؛ CRUD بأعمدة صالحة 201).
  - مصروفات عبر sync بنسبة `createdBy`؛ إعادة push **لا تكرار**؛ خادم يخزّن الفئة/المبلغ/الموظف.
  - `/dashboard/expenses`: total=300, byCategory مواد خام=240/كهرباء=60, byEmployee admin=240.
  - CRUD POST بمناسبة manager (201).
  - الصلاحيات: cashier إنشاء مصروف (403) / قراءة تقرير (403) / حذف (403) / استرداد (403)؛ manager قراءة (200).
  - KPIs netSales=860 (400+500−40), refunds=40؛ employees empA=400/empB=500، لا empC (مسترد/ملغي).
  - نسبة الـ `payments` (createdBy=empA)؛ تدقيق `expense.create` مسجّل يحمل newValue.
  - device يقرأ expenses (200) ولا يحذف (403).
- **`p2-client-logic.cjs` (منطق الكود الفعلي في admin/database.js عبر stubs): 17 / 17 PASS**
  - صيغة الإقفال `Expected = Opening + CashSales − Expenses − Refunds` (35)، كاش/كارت/مصروفات/مرتجعات/currentCash، فرق=0 عند الإغلاق بالقيمة المتوقعة.
  - `Expenses.add`: نسبة `createdBy=mo7`/`userId=7` من الجلسة، حفظ بيانات المورد/طريقة الدفع محلياً، **سندات الخادم مقصّرة** لأعمدة موجودة، **تسجيل الدرج مرة واحدة (لا مضاعفة)**، تدقيق `expense.create`؛ `Expenses.delete` => تدقيق `expense.delete` (لا حذف صامت).

### الانحدار (Regression — كلها خضراء)
| المجموعة | النتيجة |
|---|---|
| H1 Security | 29/29 |
| H2 Security | 40/40 |
| H2 Session Expiry | PASS |
| H3 Authz (Roles) | 36/36 |
| C2 Audit (c2-audit2) | 26/26 |
| C2 Server Smoke | 6/6 |
| C2 Safe Sync (run-tests.js) | 15/15 |
| H5 Financial | 15/15 |
| tsc build (backend) | OK |
| HTML/JS syntax (index.html + admin/index.html + database.js) | OK |

## 9. PASS / FAIL
- **PASS**: Phase 2 (37/37 + 17/17) وكل الانحدار أعلاه خضراء؛ لا فشل.

## 10. القيود / المسائل المتبقية (Remaining issues)
1. **جدول `suppliers` في الخادم ضيّق** (`id/syncId/name/updatedAt` فقط): العميل يخزّن `phone/address/active` محلياً كاملاً، لكن الخادم لا يحملها (يتطلب ترحيل schema لتفعيلها خلفياً). يؤثّر على تقارير المورد *على الخادم*؛ تقارير العميل المحلية كاملة. — **مقترح لاحق (يحتاج اعتماداً)**: إضافة أعمدة اختيارية لجدول `suppliers` + `expenses` (مورد/طريقة دفع) عبر ترحيل صغير.
2. **حقل المصدر `source`**: لم أضِفه كعمود (لتجنّب تغيير schema/C2)؛ يظل ضمنياً `ui` ويُرمز للعمليات المستقبلية ببادئة action. (انظر §6)
3. **درج الكاش محلي فقط** (`cash_registers` ليس في قائمة SYNC_STORES/backup) — المطابقة النقدية لا تتزامن/تُنسخ احتياطياً عبر C2. كشف قائم؛ أي تفعيل لتزامنه يتطلب إضافة للمخازن (يحتاج اعتماداً لأنه يلمس C2).
4. **لا تغيير في encryption/hash**: علاقات كلمات المرور لا محل لها في هذا النطاق (خارج Phase 2).

## 11. التالي (بانتظار الاعتماد — لا أُطلق H6)
- الاعتماد على هذا التقرير + النتائج الخضراء.
- ثم يمكن بحث: بقية النقص في `suppliers` خلفياً، تفعيل `cash_registers` في C2/backup، أو المرحلة التالية H6.
