# A1 — تقرير دمج الموظفين والدعوات والدخول بالبريد في الواجهة (Phase A1)

**الحالة:** ✅ مكتمل — واجهات الاستخدام (Client/UI) موصولة بالخلفية الجاهزة، وكل الاختبارات خضراء.
**ملاحظة:** تم وقف العمل **قبل** بدء B1 (Invoice Scanner/OCR) كما هو مفروض في خطة الغايات.

---

## 1. ما أُنجز

### 1.1 الدخول بالبريد أو اسم المستخدم (Client — `admin/database.js` `Users`)
- `Users.login` الآن يطابق `username` **أو** `email` (بحث غير حساس لحالة الأحرف)، متوافقاً مع الخادم `WHERE username = ? OR email = ?`.
- كائن `currentUser` المحفوظ أصبح يحمل: `userId`, `employeeId`, `email`, `username`, `name`, `role`, `active`, `mustChangePassword`.
- عند نجاح الدخول محلياً + تسليم الخادم جلسة، **نسخة الهوية الموثوقة من الخادم تعيد الكتابة فوق المحلية** (`userId/employeeId/email/role/active`) — الخادم هو مصدر الحقيقة، لا نثق بهوية يرسلها العميل.
- أُضيفت `Users.checkInvite(token)` و `Users.activateInvite(token, email, password)` (عامة، لا أسرار داخل الرابط).

### 1.2 إدارة الموظفين والدعوات (Client — `Employees` + واجهة الإدارة)
- حقل الإضافة أصبح يشمل **البريد الإلكتروني** و **كود الموظف** إضافةً للاسم/الهاتف/الوظيفة/الراتب.
- `Employees.invite()` → `POST /api/employees/invite` (إداري/مدير بحسب `employees.write`) ويُسجِّل الدعوة محلياً لعرض حالتها.
- `Employees.setStatus(id, active)` → `POST /api/employees/:id/status` (نقطة نهاية مخصّصة، وليست sync) لتعطيل/تفعيل الموظف وكل حساب مرتبط به.
- `Employees.getInviteStatus(employeeId)` تعيد الحالة المحلية (pending/used/expired).
- جدول الموظفين يضم الآن أعمدة: البريد، **حالة الدعوة** (قيد الانتظار/مفعّل/منتهية)، وإجراء **نسخ رابط التفعيل** 🔗 (رابط بدون أي كلمة مرور — رمز الدعوة فقط).
- زر «إنشاء دعوة بالبريد» في صف الموظف وأعلى النموذج.

### 1.3 صفحة تفعيل الحساب (New — `?invite=TOKEN`)
- شاشة تفعيل مستقلة تُعرض تلقائياً عند فتح الرابط الذي يحمل `?invite=TOKEN`.
- تعرض الاسم/البريد/الدور من الخادم عبر `checkInvite` (لا تخمين هوية، لا أسرار).
- الحساب يُفعَّل عبر `activateInvite` بكلمة مرور + تأكيد (≥6 أحرف)، والبريد يجب أن يطابق الدعوة، والدور يحدده النظام.
- بعد النجاح: تنظيف المعامل من الرابط، توجيه إلى شاشة الدخول مسبقاً بالبريد.

### 1.4 الإسناد التلقائي لمستخدم الجلسة (Financial Attribution)
- `Expenses.add`: يسند `createdBy` + `userId` + `employeeId` من الجلسة (كان يسند userId فقط).
- `Purchases.add`: أُضيف الإسناد التلقائي `createdBy` + `userId` + `employeeId` من الجلسة.
- لا تقبل أي عملية مصدر هوية من الإدخال — تُحقن من الجلسة داخل طبقة التنفيذ.

### 1.5 Batman Phase 1
- Batman يعرف المستخدم الحالي من الجلسة (`window.currentUser`) تلقائياً.
- أمر «سجّل مصروف … بـ …» (وما يعادله) يستخرج الوصف والمبلغ، ويعرض **ملخص تأكيد** يتضمن «المسجَّل بواسطة» ثم ينتظر «تأكيد/إلغاء».
- التنفيذ عبر `Expenses.add` (الذي يُسند الهوية من الجلسة) — **لا يقبل Batman userId/employeeId/createdBy من نص المستخدم**.
- لا يمنح Batman صلاحية إضافية تتجاوز `ROLE_PERMISSIONS`؛ العمليات تمر عبر نفس طبقات التنفيذ والتفويض.

### 1.6 التقارير حسب الموظف
- تقرير المصروفات يعرض بالفعل قسماً «حسب الموظف» (من تحليلات الخادم) — والعمليات الجديدة تُسند بمعرّفات حقيقية (userId/employeeId) إضافةً للاسم.

---

## 2. الملفات المعدّلة

| الملف | التغيير |
|---|---|
| `admin/database.js` | دخول بالبريد/المستخدم، هوية أغنى، checkInvite/activateInvite، `ServerAPI.post/get` عامة، `Employees.invite/setStatus/getInviteStatus`، إسناد Purchases/Expenses، مخزن `invitations` في الذاكرة |
| `admin/index.html` | شاشة التفعيل، نموذج موظف + بريد/كود، عمود البريد وحالة الدعوة، نسخ رابط، باتمان create_expense بالتأكيد، تسمية الدخول، ربط initActivation |
| `A1-EMPLOYEE-INTEGRATION-REPORT.md` | هذا التقرير |

> الخلفية (backend) لم تتغيّر في A1 — كانت جاهزة وخضراء من النسخة السابقة (invitations/email-login/status).

---

## 3. نتائج الاختبار (كلها خضراء)

| المجموعة | النتيجة |
|---|---|
| **A1 Backend** (`batman-invite.cjs`) | **21 / 21** (دعوة→تحقق→تفعيل→دخول بالبريد→تعطيل→إعادة تفعيل، بريد مكرر 409، جلسة تحمل employeeId، token لمرة واحدة) |
| **A1 Client** (`a1-client.cjs`, جديد) | **17 / 17** (البريد/المستخدم، هوية الجلسة، إسناد Purchases، invite/setStatus) |
| H1 Security | 29 / 29 |
| H2 Security | 40 / 40 |
| H3 Authorization | 36 / 36 |
| H2 Session Expiry | PASS |
| H5 Financial | 15 / 15 |
| p2-finance | 37 / 37 |
| p2-client-logic | 17 / 17 |
| c2-server-smoke | 6 / 6 |
| c2-audit2 | 26 / 26 |
| c2-backward | PASS |
| c2-fail2 | PASS |
| c2-tests/run-tests.js | 15 / 15 |
| `tsc -p backend` | 0 errors |
| `node --check admin/database.js` + كشف HTML | OK |

> ملاحظة: `c2-failure.cjs` و `c2-audit-integration.cjs` هما أسكربتات تشخيصية قديمة **ليست ضمن قائمة الاختبارات المفروضة**، وتتعثر في سطر يفرض شكل مصفوفة متوقعة لـ `/api/sync_log` + خطأ ناتج عن تنظيف `uv` على ويندوز — وهي سابقة لـ A1 وغير متعلقة بتغييراتنا (لا تغيير في الخلفية).

---

## 4. لم يُنفَّذ (حسب خطة التوقف)
- **B1 (Invoice Scanner/OCR)** — لم يُبدأ. أي نموذج رؤية/OCR غير مثبَّت.
- لا تغيير في بنية Auth، ولا في `ROLE_PERMISSIONS`، ولا مزامنة C2، ولا ترحيلات كبيرة.
- لا تخزين دائم لصور الفواتير.

---

## 5. الموافقة المطلوبة
انتهت A1. **بانتظار موافقتك قبل بدء B1** (ماسح الفواتير/OCR) و/أو أي مرحلة جديدة.
