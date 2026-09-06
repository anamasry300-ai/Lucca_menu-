# H2-SECURITY-AUDIT — تدقيق نظام المصادقة والصلاحيات (قبل أي تعديل)
**التاريخ:** 2026-08-31
**النطاق:** نظام المستخدمين وكلمات المرور والأدوار والصلاحيات والمصادقة على الخادم (Backend) والعميل (Frontend).
**المبدأ:** لم أُعدّل أي كود بعد — هذه المرحلة تشخيص فقط لفهم النظام قبل التغيير.

---

## 1) طريقة تسجيل الدخول الحالية
- **دخول العميل POS** (`index.html`): نافذة `doAdminLogin` تستدعي `window.LuccaDB.Users.login(user, pass)` ثُم تتحقق عميلاً من الدور:
  ```js
  const currentUser = window.LuccaDB.Users.getCurrentUser();
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
      sessionStorage.setItem('posAdminAuthed', '1');  // بوابة المنطقة الإدارية — client-side فقط
  ```
- **دخول لوحة الإدارة** (`admin/index.html`): `doLogin()` يستدعي `window.LuccaDB.Users.login(user, pass)` ليخفي شاشة الدخول ويعرض التطبيق.
- **لا يوجد أي Endpoint تسجيل دخول على الخادم** (`/api/login` غير موجود). كل التحقق يتم **محلياً على جهاز العميل** من بيانات IndexedDB.

### `Users.login()` في `admin/database.js` (سطر 598)
```js
async login(username, password) {
    const users = await db.getAll('users');          // يقرأ كل المستخدمين من IndexedDB المحلية
    const user = users.find(u => u.username === username);
    ...
    valid = (user.password === password);             // مقارنة نصية إن لم تكن pbkdf2
    if (valid) { localStorage.setItem('currentUser', JSON.stringify(safe)); return user; }
}
```

## 2) مكان تخزين كلمات المرور
- **على العميل:** IndexedDB، مخزن `users` (`db.add('users', ...)` / `db.getAll('users')`).
- **على الخادم:** قاعدة sql.js (ملف DB)، جدول `users` بعمود `password TEXT NOT NULL` (`backend/src/db.ts:113`).
- كما تُرفع كلمات المرور إلى الخادم عبر `/api/sync` و `ServerAPI.add('users', ...)` مع مجمل ملفات المستخدمين داخل `_collectAllData()` → `data.users` يرسل حقل `password` كاملاً.

## 3) هل كلمة المرور hashed أم plain text
**كليهما — بحسب المصدر:**
- **المستخدم الافتراضي للمدير** `admin/123456` مخزّن **نصاً صريحاً (plain text)**:
  - الخادم `db.ts:616`: `INSERT INTO users ... ('admin', '123456', 'مدير النظام', 'admin')`
  - العميل `database.js:688` `createDefaultAdmin`: `password: '123456'`
  - `supabase-db.js:99` و `deploy/supabase-db.js:68`: `password: '123456'`
- **المستخدمون المنشأون من العميل** (`Users.add`, database.js:648): يُخزَّنون بصيغة `pbkdf2:<salt>:<hash>` (PBKDF2-SHA512, 100000 تكرار) عبر Web Crypto **داخل المتصفح** — لكن لأن الخادم لا يتحقق، وأي المستخدمين القدامى نصاً صريحاً، يبقى النظام هشاً.
- الصيغة الحالية: `pbkdf2:<salt>:<hex-hash>`. العميل يتحقق بـ `pbkdf2Hash(password, salt)`.

## 4) أين يتم التحقق من الصلاحيات
- **فقط على الواجهة الأمامية (Frontend):**
  - `admin/index.html`: عناصر القائمة (لوحة الأدوار/الصلاحيات، المستخدمين...) تظهر/تختفي حسب `currentUser.role`، و `initTabs()` تُحمّل الصفحة عند النقر.
  - `index.html:1123`: بوابة المنطقة الإدارية تعتمد على `sessionStorage 'posAdminAuthed'` الذي يُعيّن عميلاً بعد التحقق من `role`.
- **الخادم لا يتحقق من أي دور أو صلاحية** — لا يوجد فحص `role`/`permission` في أي Endpoint.

## 5) هل التحقق في Frontend فقط أم Backend أيضاً
**Frontend فقط.** الخادم لا يملك أي مفهومً للهوية أو الدور أو الصلاحية. كل ما على الخادم هو مفتاح API ثابت مشترك (انظر 6/10).

## 6) كل الـ API endpoints التي تحتاج authentication
مجموع مسارات `/api/*` خلف `apiKeyCheck` (مفتاح مشترك واحد):
- `POST /api/sync` (دمج كل المخازن حساساً: orders, payments, refunds, users, invoices, settings...)
- `POST /api/orders/:id/checkout` (إقفال طلب + إنشاء فاتورة/دفعة)
- `GET /api/reports/summary`, `GET /api/reports/sales-by-category` (تقارير مالية)
- CRUD عام: `GET/POST/PUT/DELETE /api/:store[/:id]` لكل المخازن في `SAFE_TABLES`
  (users, orders, customers, payments, refunds, invoices, inventory, settings, suppliers, stock_movements, waste_log, ...)
- `GET/POST/PUT/DELETE /api/settings`, `/api/settings/:key`
- `GET/POST/PUT/DELETE /api/daily-shifts[/:date]`
- **ملاحظة حرجة:** `GET /api/public-key` (index.ts:95) **خارج** `apiKeyCheck` → **متاح لغير المصادقين** ويسرّب المفتاح.

المسارات الحساسة (المالية/الإدارية) — كلها تُحمى حالياً بنفس المفتاح المشترك دون تمييز أدوار:
- `users`, `invoices`, `payments`, `refunds`, `inventory` (inventory), `settings`, `sync`, `reports`, `daily-shifts`, `checkout`, CRUD عام.

## 7) كل الأدوار والصلاحيات الحالية
| الدور | التسمية | أين يظهر |
|---|---|---|
| `admin` | مدير النظام | `db.ts`/`database.js` seed، `admin/index.html` |
| `manager` | مدير | `admin/index.html` (يُعامل كأدمن في بوابة POS) |
| `cashier` | كاشير | افتراضياً (`role TEXT DEFAULT 'cashier'`) |
| `kitchen` | مطبخ | `admin/index.html` |
| `waiter`/`chef` | (في جدول `employees` فقط، ليس مستخدمي نظام) | `admin/index.html` rendering |

**لا يوجد جدول صلاحيات (permissions)** ولا ربط رمزي بين الأدوار والأفعال. التحقق الوحيد هو: من في الصفحة + إخفاء أزرار/عناصر في الـ UI.

## 8) وجود default credentials
**نعم — `admin / 123456`:**
- `backend/src/db.ts:616` (خادم)
- `admin/database.js:688` (`createDefaultAdmin` — العميل)
- `supabase-db.js:99` و `deploy/supabase-db.js:68`

كما أن `API_KEY` الافتراضي على الخادم **`lucca-secret-key`** مثبّت في الكود (index.ts:10) وكمرجع احتياطي للعميل (`'lucca-secret-key'`).

## 9) bypass يمكن استغلاله بتعديل JS/HTTP
مخاطر استغلال متعددة وواضحة:
1. **`/api/public-key` يسرّب مفتاح API لغير المصادقين** (index.ts:95) → أي جهة تحصل على المفتاح ثم تصدر أي طلب `/api`.
2. **المفتاح الافتراضي معروف في الكود المصدري** (`lucca-secret-key`) ومرجع احتياطي عبر كل ملفات العميل → في غياب `.env` يتم تشغيل الخادم بالمفتاح الافتراضي فعلياً.
3. **لا تحقق من الأدوار على الخادم** → أي طلب HTTP مباشر (curl/Postman) بالمفتاح ينفذ أي عملية (users، invoices، settings، delete...) بلا قيد.
4. **البوابة الإدارية client-side:** تعيين `sessionStorage.posAdminAuthed='1'` يدوياً من الكونسول يفتح المنطقة الإدارية. تعديل `localStorage.currentUser` يُغيّر الدور المعروض/الممنوح في UI.
5. **المستخدمون سفراء/مشاهدون مؤقتون:** `Users.login` يقرأ `users` من IndexedDB محلياً؛ أي تعديل لحقل `role` أو `password` محلياً يغيّر الوصول.
6. **كلمات مرور نصية تُنقل/تُخزَّن:** password plain يظهر في ملفات السفر (sync push يرسل `users` كاملة) وفي القاعدة.
7. **`Users.add` يرفع `{...safe}` فقط بدون password إلى ServerAPI** — لكن `/api/sync` (`_collectAllData`) يرسل `users` **مع password** (لذا الصيغة وصلت للخادم).

## 10) session/token mechanism الحالي
- **لا توجد** أي جلسات أو توكنات لكل مستخدم. النموذج هو **مفتاح API ثابت مشترك**:
  - يُقبل عبر `x-api-key` أو `Authorization: Bearer <key>` مساوياً لـ `API_KEY` الثابت (index.ts:101-103).
  - يُخزَّن على العميل في `localStorage 'luccaApiKey'` (يُجلب من `/api/public-key` أو مرجع افتراضي).
  - لا صلاحية انتهاء، لا إنشاء/إبطال توكن، لا رابط لمستخدم/دور.

---

## خلاصة
النظام **لا يملك مصادقة لكل مستخدم ولا تفويضاً (Authorization) على الخادم أصلاً**. الحماية الحالية سطحية تماماً:
- عموم `/api/*` تعتمد مفتاح ثابت مشترك يُسرَّب عبر `/api/public-key` ويُعرف بالكود الافتراضي.
- لا تحقق من هوية/دور/صلاحية لأي طلب حساس.
- البوابة الإدارية والصلاحيات كلها client-side → قابلة للتجاوز بتعديل sessionStorage/localStorage/JS أو بإرسال HTTP مباشر.
- كلمات المرور الافتراضية نص صريح (`admin/123456`) تُخزَّن وتُنقل كما هي.
- لا جلسات ولا توكنات إلى غير ذلك.

**هذه هي مخرجات التدقيق. الخطوة التالية قبل أي تنفيذ: اعتماد تصميم الخادم (مصادقة لكل مستخدم + تفويض أدوار + تأمين كلمة المرور) مع خطة انتقال (migration) لا تُقفل المستخدمين الحاليين — أنتظر موافقتك على التصميم قبل تعديل الكود لتفادي أي lockout.**
