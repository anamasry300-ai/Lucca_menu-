# مصفوفة الصلاحيات (RBAC Matrix) — Contract

> المستند: `docs/RBAC_MATRIX.md` — مخرج Phase 1.
> الحالة: عقد للانتقال إلى أدوار/صلاحيات جدولة في Phase 6. لا تعديل كود في هذه المرحلة.
> القاعدة: «لا تُسنَد صلاحية بلا إثبات سلوك موجود» — كل صفّية أدناه مبنية على السلوك الفعلي الحالي (مصدره في الملاحظات).

---

## 1) الأدوار الحالية (حقيقية، تعمل — المصدر `backend/src/auth.ts:119-150`)

### 1.1 `ROLE_PERMISSIONS`

| الدور | الصلاحيات (set) |
|---|---|
| **admin** | `['*']` (كل شيء) |
| **manager** | orders.read/write, checkout, payments.write, refunds.write/void, customers.read/write, categories.read/write, products.read/write, inventory.read/write, purchases.write, expenses.read/write, employees.read/write, attendance.read/write, shifts.read/write, reports.read, settings.read, daily-shifts.read/write, cash-registers.read/write, audit.read, sync, users.read |
| **cashier** | orders.read/write, checkout, payments.write, customers.read/write, categories.read, products.read, inventory.read, cash-registers.read/write, sync |
| **kitchen** | orders.read/write, products.read, categories.read, sync |
| **device** (API key مشترك) | sync, checkout, orders.read/write, order_items.read, customers.read/write, tables.read/write, categories.read, products.read, inventory.read, payments.read/write, settings.read, daily-shifts.read |

### 1.2 حواجز إضافية قائمة (مثلّثة في crud.ts)

- `STORE_WRITE_PERM` (crud.ts:37-48): يحدد صلاحية كتابة كل store — غرفة التوقف للرول المحدود.
- `WRITE_ADMIN_STORES` (crud.ts:30-32): users, settings, audit_logs, daily_shifts, shifts, suppliers, stock_movements, inventory_alerts → إداري/مدير فقط.
- `ADMIN_ONLY_STORES` (auth.ts:153-158): قراءة متاحة وظيفيًا؛ الكتابة عبر endpoints مالية حصرًا (payments/refunds/inventory/stock_movements/cash_registers يُكتبون عبر checkout/void/إدارة مخزون، لا عبر sync).
- `readDenied`/`writeDenied`/`deleteDenied` (crud.ts:51-77): users/audit/daily_shifts/shifts محدودو القراءة؛ الحذف إداري/مدير؛ device يقرأ settings.
- `requirePermission(perm)` + `requirePasswordChanged` (H2): mustChangePassword يمنع العمليات المميزة قبل تغيير كلمة المدير.
- مصفوفة batman (طبقة قرار ثانية فوق RBAC الخام — تفصيلها في القسم 4).

---

## 2) الأدوار الهدف (Phase 6)

| الدور | الأساس (من الوجود الحالي) | الهوية |
|---|---|---|
| `ADMIN` | إدماج admin الحالي | قوة كلية |
| `MANAGER` | إدماج manager الحالي | إدارة تشغيل + ماليات |
| `SUPERVISOR` | **جديد** — بلا مقابل كود اليوم | مراقبة مناوبة/طلبات/مخزون للقراءة، لا إعدادات/موظفين |
| `CASHIER` | إدماج cashier الحالي | نقطة البيع |
| `KITCHEN` | إدماج kitchen الحالي | طلبات مطبخ فقط |
| `ACCOUNTANT` | **جديد** — بلا مقابل كود اليوم | ماليات/تقارير/مصروفات، لا POS |
| `AI_ASSISTANT` | **جديد** — يمثل Batman (خدمة LLM متصلة) | صلاحيات عبر فحص permission الحالي + لا سلطة مستقلة |
| `DEVICE` | إدماج device الحالي (API key) | عمليات مؤقتة وقراءة اتصال |

> ملاحظة: إضافة أدوار جديدة لا تمس الأدوار الخمسة الحالية — الأدوار الحالية تبقى صالحة للمصادقة الحالية حتى الترحيل في Phase 6.

---

## 3) مصفوفة «دور × صلاحية» (الهدف — مبنية على أدلة السلوك الحالي)

الصيغة: `Y` = نعم، `C` = مشروطة بالحد/بالموافقة (مصفوفة batman)، `V` = عرض فقط، `N` = لا.

| الصلاحية | ADMIN | MANAGER | SUPERVISOR | CASHIER | KITCHEN | ACCOUNTANT | AI_ASSISTANT |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **sales.view** | Y | Y | V | Y | Y (طلباته) | V | V |
| **sales.create** | Y | Y | N | Y | Y (إرسال مطبخ) | N | C (needs action via batman) |
| **sales.checkout** | Y | Y | N | Y | N | N | N |
| **sales.refund** | Y | Y | N | N | N | N | N |
| **sales.discount** | Y | Y | C | C (حدّ مسموح عبر orders.write الحالي) | N | N | C (confirmation) |
| **sales.cancel/void** | Y | Y | N | N | N | N | N |
| **inventory.view** | Y | Y | V | Y | N | V | V |
| **inventory.adjust/count** | Y | Y | N | N | N | N | N |
| **products.view** | Y | Y | V | Y | Y | V | V |
| **products.manage / pricing** | Y | Y | N | N | N | N | C (update_price، minRole manager) |
| **recipes.manage** | Y | Y | N | N | N | N | N |
| **purchases.view** | Y | Y | V | N | N | V | V |
| **purchases.create** | Y | Y | N | C (≤1000 تلقائي) | N | N | C |
| **expenses.view** | Y | Y | V | N | N | V | V |
| **expenses.create** | Y | Y | N | C (≤500 تلقائي) | N | Y | C |
| **expenses.approve** | Y | Y | N | N | N | N | N |
| **employees.view** | Y | Y | V | N | N | N | V |
| **employees.manage** | Y | Y | N | N | N | N | N |
| **attendance.view** | Y | Y | N | N | N | N | V |
| **attendance.manage** | Y | Y | N | N | N | N | N |
| **shifts/drawer.view** | Y | Y | V | Y (درجه) | N | N | V |
| **shifts/drawer.close** | Y | Y | N | C (إغلاق مناوبته) | N | N | N |
| **reports.view** | Y | Y | V | N | N | Y | V |
| **reports.financial** (نت صافي/أرباح) | Y | N | N | N | N | Y | N |
| **settings.manage** | Y | N | N | N | N | N | N |
| **users.manage** | Y | N | N | N | N | N | N |
| **audit.view** | Y | Y | N | N | N | N | N |
| **sync.control** | Y | Y | N | N | N | N | N |
| **ai.read** (محادثة/أسئلة) | Y | Y | Y | Y | N | Y | Y |
| **ai.analyze** (تحليل ما يتعدى view) | Y | Y | V | N | N | V | V |
| **ai.action** (أدوات كتابة عبر باتمان) | Y | Y | C | C | N | C | C (بمصفوفة دائمًا) |
| **ai.approve** (موافقة needs_approval) | Y | Y | N | N | N | N | N |

**الأساس الدلالي (AM لمن يقرؤه كرأى):** الأدلة الحالية:
- cashier اليوم يملك `orders.write` و`checkout` و`inventory.read` و`cash-registers.write`، ولا يملك refunds/expenses، ولا inventory.write/products.write/purchases → تعيين N في shift/manage الصفوف المقابلة.
- manager يملك refunds.write/void + purchases.write + expenses.write + employees.write → ما يُعطى له التفضيل في الأعلى.
- باتمان (الطبقة الثانية) يعطي الكاشير الحدود: add_expense ≤500، add_purchase ≤1000، record_invoice ≤1000 → C في الصفوف المالية.
- view_net_profit minRole=admin فقط → **reports.financial ADMIN فقط** (حتى ACCOUNTANT بلا نطاق النت الصافي إلا بصلاحية جديدة مفوّضة).
- `update_price` minRole=manager → منتجات/تسعير C فقط للبشر الآمنين.

---

## 4) مصفوفة batman (الطبقة الثانية — موجودة وتعمل، تُستمر)

المصدر: `backend/migrations/001_batman_permissions.sql` (seed من كل تشغيل) — **تُنفَّذ في `permissionService.decide()`**:

| action | limitValue | requiresApproval | autoExecute | minRole | النتيجة |
|---|:-:|:-:|:-:|:-:|---|
| add_expense | 500 | 1 | 1 | cashier | ≤500 تحت العتبة تلقائيًا؛ فوقها needs_approval |
| add_purchase | 1000 | 1 | 1 | cashier | ≥1000 needs_approval (مدير) |
| record_invoice | 1000 | 1 | 1 | cashier | ≤1000 تلقائي |
| update_price | 0 | 1 | 0 | manager | مدير/أدمن فقط |
| delete_employee | 0 | 1 | 0 | manager | مدير/أدمن فقط |
| view_net_profit | 0 | 1 | 0 | admin | إدارة فقط |
| view_reports | 0 | 0 | 1 | manager | مدير فأقوى |

`decide()`: admin/manager تنفيذ مباشر (إلا minRole=admin)، أي دور أدنى من minRole → **blocked**، وأعلى من limit دون autoExecute → needs_approval. **حارس مكمّل للـ RBAC، لا بديل عنه.**

قاعدة الترتيب (نظريًا للعقد): 
1. `roleHas(role, perm)` (RBAC الأساس).
2. `decide(role, action, amount)` (مصفوفة batman) — فوقُها للمؤثرات المالية/الكتابية.
3. لغير المحددات في المصفوفة: `decide` تُعامل defaults (limit=0, requiresApproval=1, autoExecute=0, minRole='manager').

---

## 5) إرشادات تثبيت (Phase 6 إلزامية)

1. ترحيل `ROLE_PERMISSIONS` إلى جداول `roles`/`permissions`/`role_permissions` بنفس المحتوى أولاً (صالح سلوكيًا بنسبة 100%)، ثم إضافة SUPERVISOR/ACCOUNTANT/AI_ASSISTANT.
2. الحارس الوحيد: كل فحص عبر `requirePermission(perm)` مستقبليًا — لا حواجز متوازية جديدة تكتب في الكود.
3. الواجهة المحلية (Admin IndexedDB) لا تمر بالـ backend اليوم → سلوكها خارج الحارس؛ يجب توجيهها للخدمات (Phase 3) قبل حسم الصلاحيات نهائيًا.
4. `mustChangePassword` يبقى إلزاميًا قبل العمليات المميزة (سلوك H2 قائم، محمي باختبارات p1-followup).
5. الجداول المقتفية: **لا تنشاء** `roles/permissions` الآن (مستقبلًا): الوثيقة تصف الهدف فقط.