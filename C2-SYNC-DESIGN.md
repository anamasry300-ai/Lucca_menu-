# C2 — تصميم Safe Sync (مرحلة التصميم فقط)

> **حالة: تصميم فقط — لم يُجرَّ أي تعديل على الكود أو قاعدة البيانات.**
> المستند يوثّق مشكلة الهوية الحالية، والتصميم المقترح، ومخاطر الترحيل، قبل أي تنفيذ.

---

## 0. الخلاصة التنفيذية

المزامنة الحالية مدمرة:
- السيرفر (`/api/sync`) ينفّذ `DELETE FROM <table>` ثم `INSERT OR REPLACE` لكل جدول (backend/src/index.ts:200-228).
- العميل `pullAll` (admin/database.js:2307) يمسح IndexedDB بالكامل ثم يعيد بناه من السيرفر بلا دمج.
- `order_items` المحلي يستخدم `id autoIncrement` مختلف بين الأجهزة ⚠️ **CRITICAL SYNC IDENTITY ISSUE**.

لذلك **ممنوع تنفيذ أي Merge/UPDATE/upsert** حتى تُحسم هوية موثوقة للسجلات. هذا المستند يقترح "Stable Sync ID" لكل نوع سجل، ويؤجّل أي تغيير مفتاح حتى موافقة ومن ثم هجرة آمنة.

---

## 1. Current identity model (نموذج الهوية الحالي)

| Collection | المفتاح الحالي | المصدر | `createdAt` | `updatedAt` | ملاحظات |
|---|---|---|---|---|---|
| orders | `id INTEGER AUTOINCREMENT` | محلي/سيرفر | ✅ | ✅ | هناك أيضاً `orderNumber` (غير إلزامي) |
| order_items | `id INTEGER AUTOINCREMENT` | محلي فقط | partial | ❌ | ⚠️ **عبوة `id` غير موثوقة بين الأجهزة** |
| invoices | `id` (يُضاف؛ المصدر `orders.checkout`) | محلي/سيرفر(إن وُجد) | partial | ❌ | لا جدول `invoices` على السيرفر الحالي |
| payments | `id INTEGER AUTOINCREMENT` + `orderId` | محلي/سيرفر | ✅ | ❌ | |
| refunds | `id INTEGER AUTOINCREMENT` + `orderId` | محلي/سيرفر | ✅ | ❌ | |
| audit_logs | `id INTEGER AUTOINCREMENT` | محلي/سيرفر | ✅ | ❌ | |
| inventory / purchases / stock_movements | `id AUTOINCREMENT` | محلي/سيرفر | ✅ | ❌ | |
| settings | `key TEXT PRIMARY KEY` | محلي/سيرفر | ❌ | ❌ | ✅ مفتاح مستقر (business key) |

خلاصة: **كل الجداول المالية/الجردية تعتمد على `id` ذاتي التزايد**، وهو غير مستقر عبر الأجهزة لأن جدول sqlite/IndexedDB لكل عامل مستقل.

---

## 2. Tables with unsafe/local IDs (جداول بمعرّفات غير آمنة)

كل الجداول التالية تستخدم `id AUTOINCREMENT` غير موثوق كمفتاح Merge:

1. `order_items` — **الأخطر**: يُنشأ بـ `{ orderId, ...item }` مع `id` محلي مختلف.
2. `orders` — id غير موثوق إن نُقل تسجيل بين أجهزة؛ لكن لديه `orderNumber` و`createdAt/updatedAt` يساعدان.
3. `payments` — تعتمد على `orderId` (غير مستقر أيضاً) + `id`.
4. `refunds` — تعتمد على `orderId`/`paymentId` + `id`.
5. `audit_logs` — id محلي غير موثوق.
6. `inventory`, `stock_movements`, `purchases`, `expenses`, `employees`, `attendance`, `shifts`, `daily_shifts` — id محلي.
7. `products`, `categories`, `product_modifiers`, `product_variations`, `taxes`, `payment_methods`, `discounts`, `tables` — id محلي، لكنها إعدادات/بيانات مرجعية يهيمن عليها مشغّل واحد غالباً (أقل خطورة).

---

## 3. Tables with stable keys (جداول بمفاتيح موثوقة)

- `settings` → `key TEXT PRIMARY KEY` ✅ **business key موثوق**.
- `daily_shifts` → `date TEXT PRIMARY KEY` ✅ **تاريخ = مفتاح موثوق**.
- `users` → `username TEXT UNIQUE` ✅ **business key موثوق** (بجانب id).
- `orders` → لديه `orderNumber` كمرشّح business key، مع `createdAt/updatedAt` يستخدمان للتحقق من الأحدثية.
- `customers` → `phone` كمرشّح business key (غير إلزامي حالياً).

**لا يوجد UUID/مفتاح إصدار (version/revision) في أي جدول حاليًا.**

---

## 4. Relationships (العلاقات بين السجلات)

```
orders
 ├── order_items        (orderId → orders.id)
 ├── payments           (orderId → orders.id)
 ├── refunds            (orderId → orders.id, paymentId → payments.id)
 ├── order_status_history (orderId → orders.id)
 └── invoices           (مرتبطة برقم الطلب/الفاتورة — مرجع غير صريح)

audit_logs              (objectId/objectType يشير لأي كيان، بلا FK صريح)
inventory  ← stock_movements (moves ترتبط بالصنف/الجرد)
products ← product_modifiers / product_variations / product_recipes (productId)
categories ← products (categoryId)
```

**الخطر الترابطي:** أي تغيير في هوية `orders.id` أو `order_items.id` يكسر سلاسل FK الافتراضية (`orderId`, `productId`, `paymentId`) في التقارير والفواتير والعمليات.

---

## 5. Proposed stable IDs (معرّفات Sync موثوقة مقترحة)

مبدأ عام: **نضيف عمود `syncId` (UUID v4) لكل سجل قابل للمزامنة، ونحتفظ بالـ `id` الذاتي للتزايد كمفتاح تخزين داخلي فقط.**

| Collection | مقترح | الأساس |
|---|---|---|
| orders | `syncId UUID` + `orderNumber` | UUID ثابت + business key |
| order_items | `syncId UUID` (لكل بند) | **يُحسم الهوية**؛ `id` المحلي يبقى داخلياً فقط |
| invoices | `syncId UUID` أو `invoiceNumber` | UUID + رقم فاتورة فريد |
| payments | `syncId UUID` أو [orderSyncId, sequence] | UUID |
| refunds | `syncId UUID` | UUID |
| audit_logs | `syncId UUID` | UUID |
| inventory / stock_movements / purchases / expenses / employees / attendance / shifts | `syncId UUID` | UUID |
| products / categories / modifiers / variations / taxes / payment_methods / discounts / tables | `syncId UUID` | UUID (بيانات مرجعية) |
| settings | `key` (موجود) | لا تغيير |
| daily_shifts | `date` (موجود) | لا تغيير |
| users | `username` (موجود) | لا تغيير |

للأصناف المرتبطة بوالد (order_items←orders) نقترح `orderSyncId` بدل الاعتماد على `orderId` الذاتي، ويُستخدم `orderId` فقط داخلياً.

---

## 6. Migration risks (مخاطر الترحيل)

1. **كسر العلاقات**: تغيير مفتاح `order_items`/`orders` قد يكسر `orderId` في order_items/payments/refunds والتقارير والفواتير.
2. **الفواتير**: لا جدول `invoices` على السيرفر الحالي — أي ربط جديد يتطلب إنشائه + ترحيل.
3. **IndexedDB version bump**: إضافة عمود `syncId` يتطلب رفع `DB_VERSION` و`onupgradeneeded`، مع ترحيل البيانات القديمة (إنشاء syncId بأثر رجعي).
4. **البيانات التاريخية**: السجلات القديمة بلا `syncId` تحتاج توليد UUID بأثر رجعي (تدريجي، وليس احتياطياً).
5. **التقارير**: أي استعلام SQL يعتمد على `id` أو `orderId` القديم يجب مراجعته.
6. **ثنائية البيئات**: السيرفر (sql.js) والعميل (IndexedDB) يجب أن يتبنيا نفس مخطط `syncId`.

---

## 7. Safe migration strategy (استراتيجية الهجرة الآمنة)

1. **لا دمج حتى حسم الهوية** — هذه المرحلة تصميم فقط.
2. رفع `DB_VERSION` وإضافة عمود `syncId TEXT UNIQUE` لكل collection (بلا autoincrement).
3. **Fill بأثر رجعي**: مخطّط توليد UUID لكل سجل موجود (بمرورٍ واحد، مع سجل ترحيل).
4. **أعمدة دعم**: إضافة `updatedAt` + `sourceId`/`deviceId` حيث غائبة، وإضافة `orderSyncId` للأصناف المرتبطة.
5. تفعيل الـ merge **فقط بعد** اكتمال الـ fill على كل الأجهزة/السيرفر، تحت ميزة/علم تشغيل.
6. بينة اختبار منفصلة تماماً عن الإنتاج (نقطة 10 في صفحة الاختبارات).

---

## 8. Conflict resolution strategy (استراتيجية حل التعارض)

تعتمد على وجود `updatedAt`/إصدار موثوق:

- **تسجيل غير موجود على السيرفر** → INSERT.
- **موجود والبيانات متطابقة** → skip (لا شيء).
- **موجود والعميل أحدث بشكل موثوق** (`updatedAt`/version سيرفر < عميل، وفارق موثوق) → UPDATE.
- **موجود لكن لا توجد وسيلة موثوقة لتحديد الأحدثية** → **لا يُستبدل**؛ يُسجَّل `conflict`.
- **عدم الاعتماد على وقت الجهاز وحده**: نستخدم `lastWriteWins` فقط عند توفر `updatedAt` يُحدَّث بالتطبيق نفسه (وليس `Date.now()` المحض)، وإلا نتعامل كتعارض.

السجلات الحساسة (`invoices`, `payments`, `refunds`, `audit_logs`, `stock_movements`): **لا تُستبدل تلقائياً أبداً** — دائماً insert/append أو conflict مرصود.

**Sync Log لكل عملية** يوفر العد: `inserted / updated / skipped / conflicts / errors`.

---

## 9. Backup / Rollback strategy

1. قبل **أي** نسخة مزامنة: `DataSync.exportAll()` → حفظ JSON محلياً (localStorage/ملف) + لقطة عند السيرفر.
2. أي process sync يُفتح/يُغلق بعلم "جارٍ المزامنة"؛ عند الـ conflict يُوقف ويُعرض الحالة (بدون تغيير واجهة كبيرة).
3. العمليات متعددة الجداول تُغلَّف في `Transaction` مع `Rollback` عند أي فشل (شبكة/خطأ) — لا تُترك حالة جزئية.
4. سجل تراجع (restore) يعيد آخر نسخة احتياطية موثوقة عبر `DataSync.importAll`.
5. `pullAll` يصبح **MERGE** (إضافة الجديدة، تحديث المؤكّد أقدمه، لا حذف إلا بـ delete موثّق رسمي)، لا مسح شامل.

---

## 10. Tests required before migration (اختبارات مطلوبة قبل الهجرة)

بيئة اختبار منفصلة تماماً (بدون بيانات إنتاج). السيناريوهات:

- **TEST 1**: A لديه Invoice A، B لديه Invoice B؛ Sync A ثم B → النتيجة تحتوي A + B.
- **TEST 2**: A وB بنفس invoice id؛ الأحدث فقط يُحدَّث (بدليل موثوق).
- **TEST 3**: تعارض حقيقي بلا timestamp/version موثوق → النتيجة `conflict` لا overwrite.
- **TEST 4**: Pull بعد Push → لا فقدان لأي سجل محلي.
- **TEST 5**: انقطاع الشبكة أثناء Sync → لا حالة جزئية/غير متسقة (transaction+rollback).
- **TEST 6 (هوية)**: `order_items` بلا `id` موثوق → يُدمج عبر `syncId` وليس id، دون فواتير مكررة/مفقودة.
- **TEST 7**: migration fill بأثر رجعي على بيانات أرشيفية → كل السجلات لها syncId فريد، بلا تعارض.

---

## الملفات المتأثرة (تُعدَّل لاحقاً فقط بعد الموافقة على التصميم)

- `admin/database.js` — `DataSync.exportAll/importAll` (تم تحسينها في C3)، `ServerSync.pushAll/pullAll`.
- `backend/src/index.ts` — `/api/sync` (إزالة DELETE، إضافة merge/conflict).
- `backend/src/db.ts` — إضافة columns (`syncId`, `updatedAt`) + جدول `invoices` + جدول `sync_log`.
- `index.html` (admin) — عرض حالة sync عند الضرورة فقط.
