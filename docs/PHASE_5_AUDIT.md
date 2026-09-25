# Phase 5 — Admin In-App Reengineering Audit

**التاريخ:** 2026-09-25  
**الفرع:** `feature/admin-in-app-reengineering`  
**النطاق:** توحيد دخول LuccaPOS وAdmin داخل تطبيق Electron مع الحفاظ على Authentication وRBAC وAudit Logs.

## النتيجة التنفيذية

النسخة الحالية تحتوي على **POS وAdmin كواجهتين داخل نفس حزمة Electron، لكن كنافذتين ومجالَي جلسة مختلفين عملياً**. زر الإدارة في POS يستدعي `window.electronAPI.openAdmin()`، و`main.js` ينشئ `BrowserWindow` ثانياً يحمّل `admin/index.html`. صفحة Admin تعيد تهيئة قاعدة البيانات وتقرأ `localStorage.currentUser`، لكنها لا تستقبل هوية موثوقة من Main Process. لذلك أضيف لاحقاً Login ثانٍ داخل Admin.

المطلوب الصحيح هو إبقاء نافذة/صفحة Admin داخل تطبيق سطح المكتب لكن تمرير **جلسة تطبيق موثوقة** من Main Process، مع فحص صلاحية `admin`/`reports.read` قبل الفتح، ومنع أي اعتماد على `isAdmin` أو بيانات Renderer.

## نتائج التدقيق

### 1. Electron وفتح Admin

- `main.js` ينشئ نافذة POS في `createWindow()` مع `contextIsolation: true` و`nodeIntegration: false`.
- `preload.js` يعرّض `electronAPI.openAdmin()` الذي يرسل IPC باسم `open-admin`.
- معالج `open-admin` في `main.js` ينشئ `adminWindow` منفصلة ويحمّل `admin/index.html`.
- النافذة الثانية تستخدم نفس `preload.js` ونفس مسار الملفات، لكنها لا تحصل على session من Main Process.
- `index.html` يحتوي `openAdminDashboard()` ويستخدم Electron API، مع fallback إلى `window.open('admin/index.html')` في المتصفح.
- لا يوجد حالياً IPC منظم مثل `getCurrentUser` أو `authorizeAdmin`; وبالتالي لا يوجد حارس Main Process قبل فتح Admin.

### 2. المصادقة والجلسة الحالية

- الطبقة المحلية `admin/database.js` تحفظ المستخدم الآمن في `localStorage.currentUser`.
- طبقة Supabase `supabase-db.js` تفعل الشيء نفسه، وتدعم PBKDF2 أو legacy plaintext.
- POS يستخدم `window.currentUser` و`localStorage`/`sessionStorage` و`luccaToken` في عدة مواضع.
- Backend يملك جلسات SQLite بجدول `sessions`، و`resolveIdentity()` يثق في Bearer/session token ثم يستخدم `roleHas()`.
- Backend يطبق `authRequired`, `requireRole`, `requirePermission`, و`requirePasswordChanged`، لكن نافذة Admin المحلية لا تمرر جلسة Backend موثقة عبر IPC عند فتحها.
- يوجد في النسخة الحالية `TEMPORARY_LOGIN_BYPASS = true` داخل Admin كحل صيانة مؤقت؛ هذا **غير آمن وغير مقبول للإنتاج** ويجب إزالته في هذه المرحلة.

### 3. RBAC والصلاحيات

- مصدر الصلاحيات الأساسي في Backend هو `backend/src/auth.ts` داخل `ROLE_PERMISSIONS` و`roleHas()`.
- الأدوار الحالية تشمل `admin`, `manager`, `cashier`, `kitchen`, و`device`.
- Admin يملك `*`، وManager يملك `reports.read` وعمليات الإدارة التشغيلية، بينما device محدود ولا يملك عمليات الإدارة الحساسة.
- `backend/src/routes/admin.ts` محمي بـ `authRequired` و`requirePasswordChanged`، والنسخ الاحتياطي مقيد بـ `requireRole('admin')`.
- لا يوجد حتى الآن عقد IPC موحد يفحص صلاحية المستخدم قبل فتح نافذة Admin؛ يجب إضافته مع عدم قبول الدور من Renderer كحقيقة.

### 4. Admin pages والازدواجية

- الصفحة الأساسية هي `admin/index.html` وتحتوي UI كبيرة وطبقة استدعاءات مباشرة إلى `window.LuccaDB`.
- توجد `admin/dashboard.html` كتقارير إضافية منفصلة تعتمد على `sessionStorage.luccaToken` وHTTP API.
- يوجد تكرار جزئي في التقارير: `admin/admin-analytics.js` و`admin/dashboard.html` وBackend report services.
- المسار canonical الموجود في Backend هو:
  `routes/reports.ts → controllers/reportsController.ts → services/reportService.ts → repositories/* → database`.
- لا يوجد `control-center.html` في الشجرة الحالية.
- لا توجد ملفات مستقلة باسم `reportService` خارج Backend؛ المصدر canonical هو `backend/src/services/reportService.ts`.

### 5. Reporting

- `backend/src/services/reportService.ts` يحسب Sales/Expenses/Inventory/Employees/Suppliers عبر repositories.
- `getSalesReport()` يحدد revenue/orders/avgOrder/discounts/refunds/netSales ويدعم byDay/byPeriod/byCategory/topProducts/payments.
- يجب عدم نقل الحسابات إلى HTML أو إنشاء SQL جديد لكل تبويب.
- توجد ملاحظة تحتاج اختباراً منفصلاً: تعبير `refundTotal()` يعتمد على صياغة SQLite `createdAt >= ? AND createdAt <= ? || 'T23:59:59'` ويجب تثبيت معناه قبل أي توحيد، بدون تغيير business meaning تلقائياً.

### 6. Audit Logs وBatman

- توجد طبقة `AuditLogs` محلية ومسارات Backend للتدقيق، وBatman مرتبط بأدوات موجودة داخل POS/Admin.
- يجب أن تبقى عمليات Batman tool-mediated، مع permission check وvalidation وAudit Log؛ لا يجوز إعطاء AI وصول SQL مباشر.
- واجهة Admin الحالية تعرض Batman ومصفوفة قرارات، لكنها لا تحصل على authorization context موحد من Main Process.

### 7. الأداء

- `admin/index.html` كبير ويقوم بتهيئة بيانات كثيرة عند الدخول، وبعض loaders تقرأ collections كاملة عبر `getAll()`.
- توجد وظائف lazy جزئية عبر `initTabs()`، لكنها ليست طبقة routing/permission واضحة.
- إعادة الهندسة يجب أن تبدأ من جلسة/فتح النافذة، ثم تحسين loaders ذات الأثر الأكبر دون إعادة كتابة schema.

### 8. الاختبارات والحالة

- توجد اختبارات في `tests/`, `c2-tests/`, `backend/test/`, و`scripts/`.
- آخر commits المرجعية `db5ea34` و`99ab994` غير موجودة في clone الحالي، لذلك لا يمكن افتراض محتواها أو تطبيقهما.
- لا يوجد `docs/PHASE_5_AUDIT.md` قبل هذا التقرير؛ تم إنشاؤه الآن كمرجع للمرحلة.
- `package.json` و`main.js` كانا محذوفين من HEAD السابق، وتمت استعادتهما من آخر commit قابل للبناء حتى يمكن بناء Electron؛ يجب الحفاظ عليهما.

## قرار التصميم قبل التنفيذ

1. إزالة `TEMPORARY_LOGIN_BYPASS` نهائياً.
2. إضافة جلسة تطبيق في Main Process لا تقبل role/permissions من Renderer.
3. إضافة IPC محدود:
   - `auth-login` لتسجيل الدخول في Main Process أو ربط جلسة موثقة موجودة.
   - `auth-session` لإرجاع snapshot غير حساس للجلسة.
   - `open-admin` يعيد نتيجة authorization قبل فتح النافذة.
4. جعل Admin تفتح داخل نافذة Electron نفسها/نافذة فرعية تابعة للتطبيق بدون Login ثانٍ، وتستخدم snapshot المستخدم الحالي للعرض فقط.
5. إبقاء backend authorization هو الحارس الحقيقي للبيانات والعمليات؛ IPC ليس بديلاً عن `authRequired`/`requirePermission`.
6. عدم تغيير schema أو RPC أو أسماء الجداول أو الحقول المالية.
7. إعادة استخدام `reportService.ts` في أي API reporting جديد أو تعديل route قائم، وعدم تكرار الحسابات داخل HTML.
8. إخفاء أقسام Admin من الواجهة بحسب snapshot permissions، مع بقاء التحقق الخادمي إلزامياً.

## مخاطر يجب عدم تجاوزها

- لا يمكن جعل Admin آمنة بمجرد `localStorage.currentUser` أو `role='admin'` من Renderer.
- لا يجوز إبقاء نسخة bypass في EXE النهائي.
- توحيد الواجهة لا يعني توسيع صلاحيات الكاشير أو الجهاز.
- لا يجوز تغيير schema أو migration تلقائياً دون توقف ومراجعة منفصلة.

## الخطوة التالية

تنفيذ طبقة session/IPC الآمنة أولاً، ثم إزالة Login Admin المنفصل، ثم ربط فتح Admin بالـ permission، ثم إضافة اختبارات focused قبل إعادة بناء Windows.
