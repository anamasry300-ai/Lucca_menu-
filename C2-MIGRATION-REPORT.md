# تقرير ترحيل المزامنة الآمنة (C2 MIGRATION REPORT)

**التاريخ:** 2026-08-31
**المرحلة:** CRITICAL C2 — استبدال المزامنة المدمرة بـ Safe Merge Sync
**الحالة:** مكتملة ومتحقَّق منها

## نظرة عامة
تم استبدال آلية المزامنة القديمة (التي كانت تحذف البيانات المحلية/الخادمية عند الاختلاف
وتعيد الكتابة فوقها بالكامل) بآلية **Safe Merge Sync** التي:
- لا تحذف أي بيانات أبداً عند السحب (pull).
- تعتمد على معرّف ثابت `syncId` (UUID) بدلاً من المعرف الرقمي المحلي.
- تحافظ على ترتيب/Data بشكل تراكمي وتتعامل مع التعارضات بشكل آمن.

---

## 1. تغييرات المخطط (Schema Changes)

### IndexedDB (العميل) — `admin/database.js`
- رُفع `DB_VERSION` من **8** إلى **9**.
- أُضيفت مخازن جديدة:
  - `sync_log` — سجل عمليات المزامنة (تدقيق).
  - `sync_backups` — نسخ احتياطية قبل كل مزامنة.
- أُضيفت أدوات مساعدة للوحدة:
  - `SYNC_STORES` (قائمة الـ 28 مخزن القابل للمزامنة)
  - `newSyncId()` — توليد UUID ثابت لكل سجل.
  - `newDataTimestamp()` — زمن التحديث.
  - `stampSyncRecord()` — ختم السجل بمعرّف وزمن.
- أُضيفت طرق:
  - `backfillSyncIds()` / `_backfillStoreSync()` / `_linkOrderItemsToOrders()`
    لترقيم السجلات القديمة بمعرّفات syncId (Post-migration).
- يُستدعى `await db.backfillSyncIds()` بعد `db.init()` داخل `initSystem()`.

### SQLite (الخادم) — `backend/src/db.ts`
- أُضيف جدول `invoices` + جدول `sync_log`.
- كتلة `ALTER TABLE` (`syncColumnTables`) تضيف الأعمدة التالية لـ **28** جدولاً:
  - `syncId` ، `updatedAt` ، `orderSyncId` (للجداول الفرعية المرتبطة بالطلبات).
- يُنشأ تلقائياً إن لم تكن موجودة: `suppliers` ، `stock_movements` ، `product_recipes` ، `waste_log`.
- فهارس جديدة: `idx_orders_syncId` ، `idx_order_items_syncId` ، `idx_order_items_orderSyncId` ،
  `idx_invoices_syncId` ، `idx_payments_syncId`.

**الجداول المتأثرة (28):** users, tables, tables_store, orders, order_items, invoices,
payments, refunds, audit_logs, order_status_history, customers, inventory, purchases,
employees, attendance, expenses, shifts, categories, products, product_modifiers,
product_variations, payment_methods, taxes, discounts, stock_movements, suppliers,
product_recipes, waste_log.

---

## 2. منطق المزامنة الجديد

### العنصر الأساسي: `_sameData(a, b)`
يقارن فقط مفاتيح **البيانات الواردة** (يستثني `id`، `syncId`، `updatedAt`، `updated_at`،
`revision`، `version`). هذا حلّ جذري للخطأ الذي كان يجعل العميل يدفع سجلاً مكرراً
يُعامل كتعارض بسبب القيم الافتراضية لقاعدة SQL.

### نافذة الغموض: `AMBIGUITY_MS = 5000`
عندما يقترب زمن السجلين (ضمن 5 ثوانٍ) يُعامَل على أنه تعارض أمان (لا يُكتب فوقه).

### `_mergeOne` (دمج سجل واحد)
- **INSERT** إن لم يكن السجل موجوداً على الجهة الأخرى.
- **SKIP** إن كانت البيانات متطابقة (`_sameData`).
- **UPDATE** فقط إذا كانت الجهة الواردة **أحدث بشكل موثوق** (عبر `version`/`revision`
  أو `updatedAt` خارج نافذة الـ 5 ثوانٍ).
- **CONFLICT** في كل الحالات الأخرى — يُسجَّل، **ولا تُكتب فوق البيانات أبداً**.

### `_preSyncBackup`
قبل أي مزامنة تُخزَّن كل البيانات في مخزن `sync_backups` عبر `DataSync.exportAll()`.

### `_logSync`
تسجّل كل عملية مزامنة في `sync_log` (زمن، جهة، أعداد الإدراج/التحديث/التخطّي/التعارض).

### `pullAll` — السحب أصبح دمجاً
- لا يوجد أي `clear` بعد الآن. تتم إضافة الجديد وتحديث الأحدث الموثوق فقط،
  ولا حذف نهائي.

### `_applyLocal`
- عند **INSERT** يُستبعد المعرّف الرقمي للجهة الأخرى ويُعاد ربط المفاتيح الفرعية
  (`orderId`) عبر `_parentLinkMap` + `_localBySyncId`.
- عند **UPDATE** يُحتفظ بالمعرّف المحلي.

### `_parentLinkMap`
يربط `order_items / payments / refunds / invoices / order_status_history` بأبوها
`orders` عبر `orderSyncId` ← `orderId`.

### الخادم — `backend/src/index.ts` (`/api/sync`)
- `tableNameFor()` يطابق أسماء الجداول (مثل `tables`→`tables_store`) ويثبّت وجودها في sqlite_master.
- `sameData(...)` — نفس مبدأ مقارنة المفاتيح الواردة فقط.
- إعادة ربط FK فرعي عبر `remapRule` (`orderSyncId`→`orderId` مقابل جدول `orders`).
- عمليات الكتابة ملفوفة داخل `beginTransaction` / `commitTransaction` / `rollbackTransaction`
  (ذرّية + استرجاع عند الفشل).
- إدراج سطر `sync_log` ثم `saveDb()`.
- قائمة التجميع (`include`) موسّعة لتشمل invoices, suppliers, stock_movements,
  product_recipes, waste_log, daily_shifts مع `processed` Set لمنع التكرار.

### هوية التزامن الثابتة (قرار رئيسي)
- هوية السجل = **UUID ثابت `syncId`** + `orderSyncId` للصفوف الفرعية (الربط عبر
  `order.syncId` وليس عبر الـ `id` المحلي).
- يُبقى المعرف الرقمي `id` كمفتاح داخلي فقط.

---

## 3. نتائج الاختبارات

### اختبارات العميل — `c2-tests/run-tests.js` (بيئة معزولة)
**النتيجة: 15/15 ناجح (exit 0)**

| المعرّف | الفحص |
|---|---|
| TEST0a/0b | ثبات هوية UUID |
| TEST1 | الفواتير تتراكم دون حذف |
| TEST2 | `updatedAt` الأحدث يحدّث |
| TEST3 | تعارض بدون كتابة فوق |
| TEST4 | السحب لا يُسقط البيانات المحلية |
| TEST5 | استرجاع عند فشل الشبكة |
| TEST6/6b | `order_items` عبر syncId + orderSyncId |
| TEST7 | علاقة فاتورة ↔ دفعة |
| TEST8 | دمج المخزون |
| TEST9 | `audit_logs` يُلحق فقط |
| TEST10 | عدّادات سجل المزامنة |
| TEST11/11b | التزام ذرّي + استرجاع |

### اختبار تكامل الخادم — `c2-server-smoke.cjs`
**النتيجة: 6/6 ناجح (عبر `DB_PATH` لبيئة مؤقتة — لم تُمسّ قاعدة المستخدم الحقيقية)**

| المعرّف | الفحص |
|---|---|
| S1 | أول دفعة = إدراج |
| S2 | عدّادات صحيحة |
| S3 | إعادة ربط FK (`item.orderId == order.id`) |
| S4 | دفع مكرر = تخطّي (لا تعارض خاطئ) |
| S5 | تحديث موثوق → 500 |
| S6 | إجمالي محدَّث |

### فحوصات البناء
- `node --check admin\database.js` → **SYNTAX OK**.
- `tsc --noEmit` + بناء كامل للخادم → **exit 0** (خالٍ من الأخطاء).

---

## 4. سلامة البيانات (Data Integrity)
- لا يوجد أي مسار يحذف بيانات المستخدم في أي اتجاه (سحباً أو دفعة).
- كل كتابة في الخادم داخل معاملة ذرّية مع استرجاع عند الفشل.
- كل مزامنة تُحفظ قبلها في `sync_backups` (نسخة احتياطية قابلة للاسترجاع).
- تعارضات غير مؤكَّدة تُسجَّل ولا تُكتب فوق تلقائياً.
- إعادة ربط الصفوف الفرعية بالطلبات تتم عبر المعرّف الثابت `orderSyncId` لضمان
  سلامة العلاقة بعد الترحيل.

---

## 5. التحقق من الاسترجاع (Rollback Verification)
- الاختباران TEST5 و TEST11/11b يؤكّدان أن الفشل أثناء المزامنة يستعيد الحالة
  السابقة بالكامل (لا يبقى أي جزء غير مكتمل).
- على الخادم: `rollbackTransaction` يُستدعى عند أي خطأ قبل الالتزام.

---

## 6. المخاطر المتبقية / ملاحظات للترحيل الفعلي
1. **نقل إلى الإنتاج:**
   - قبل الترقية، عمل نسخة احتياطية كاملة للمشروع (موجودة في Temp:
     `lucca-backup-20260831-033629` و `lucca-c2-backup-20260831-035621`).
   - عند أول تشغيل بعد `DB_VERSION=9` سيُشغَّل `backfillSyncIds()` تلقائياً
     لترقيم السجلات القديمة.
   - التأكيد اليدوي بعد الترحيل بأن جميع السجلات لديها `syncId` و`orderSyncId`
     قبل تفعيل المزامنة بين الأجهزة.
2. **مشاكل متبقية من مرحلة HIGH (خارج نطاق C2):**
   - `checkout` غير ذرّي (عدة `put` في مخازن مختلفة).
   - تقارير `/api/reports/summary` بتواريخ نصية.
   - الحالة الضريبية لسطر الطباعة الحراري.
3. **الأداء:** المزامنة الأولى على قاعدة بيانات كبيرة قد تكون أبطأ بسبب الـ backfill
   وبناء الفهارس — يُنصح بإجرائها خارج أوقات الذروة.

---
