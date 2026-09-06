# C2-FIX-REPORT — تقرير إصلاح C2
**التاريخ:** 2026-08-31
**النطاق:** إصلاح العيوب المؤكَّدة في `CRITICAL-POST-AUDIT.md` (PT12, PT13/PT24, `_applyLocal`) وإعادة التحقق.
**قاعدة البيانات:** كل الاختبارات على قواعد مؤقتة (`DB_PATH` في مجلد `Temp\opencode`) — **لم تُمسَّ أي بيانات إنتاج**.

> القاعدة: لم أعتبر أي اختبار "أخضر" إلا بعد تنفيذه فعلياً والتحقق من نتيجته.

---

## 1) الفحص الأولي (تشخيص — تم عبر `c2-probe.cjs`)
- **PT12:** `/api/sync` يفشل عند إدراج `order_items` بـ `price` (الجدول يحتوي `unitPrice`) → `no such column: price`.
  *(إعادة إنتاج R1: `{conflicts:1, conflictDetail:[{syncId:"p-oi", reason:"فشل إدراج", store:"order_items"}]}`)*
- **PT13/PT24:** `invoices, suppliers, stock_movements, product_recipes, waste_log, settings`
  ليست في `SAFE_TABLES` → `GET` تعيد `400 Invalid store` (push-only).

## 2) المعالجات

### 2.1 PT12 — `backend/src/index.ts`
- أُضيف `COLUMN_ALIASES = { order_items: { price: 'unitPrice' } }`.
- `_columnCache` + `columnsFor(table)` (عبر `PRAGMA table_info` — تحققت أن prepare يعمل بـ sql.js).
- `validColumns(store,target,item)`: تطبيق الاسم المستعار + الاحتفاظ بأعمدة الجدول الفعلية فقط + تجاهل `id`.
- `mapKey(store,k)`: تحويل المفاتيح (orderId↔orderSyncId).
- `sameData` يقارن `normItem` بعد التطبيع (كثير الأعمدة) مع السجل الموجود → لا تعارض كاذب لإعادة الدفع.
- INSERT/UPDATE يعيدان رسالة الخطأ الحقيقية في `conflictDetail.reason`.

النتيجة: مُثبَّت، وتخمين حماية عامة ضد أي عدم تطابق أعمدة مستقبلي لأي جدول.

### 2.2 PT13/PT24 — `backend/src/routes/crud.ts`
- أُضيف للمخازن الستة إلى `SAFE_TABLES` (كلها مُتحقَّقة في `db.ts`؛ `settings` بدون `id` → `STORE_ORDER_BY` بـ `key`).
- `parseRow(table,row)`: للمخزن `order_items` تُحوّل `unitPrice`→`price` (شكل العميل). عُدِّلت مواضع الاستدعاء الثلاثة.

النتيجة: مُثبَّت — GET تعمل لجميع المخازن (غير 400) وتُرجع `price` للعميل.

### 2.3 client الانعكاس المحلي — `admin/database.js`
- `_applyLocal` يعيد `{ok:true}`/`{ok:false,error}` ويسجّل `[sync-applyLocal]` بدل البلع الصامت.
- `pullAll`/`pushAll` تحسب فشل الإدراج/التحديث كأخطاء (`result.errors`) وتُضيف `conflictDetail`، وتعيد `success:false` عند أي فشل.

النتيجة: مُثبَّت — أخطاء الكتابة تظهر ولا تُتجاهل.

## 3) اختبارات ما بعد الإصلاح (نفِّذت فعلياً — كلها 0 FAIL)

| الاختبار | النتيجة | الغرض |
|---|---|---|
| `c2-audit2.cjs` | **26 ناجح / 0 فاشل** | التكامل الكامل: جهازان، orders/items، فواتير، نسخة احتياطية، TO GET الستة، إظهار الأخطاء، دفةعة مختلطة |
| `c2-server-smoke.cjs` | **6 ناجح / 0 فاشل** | إعادة التحقق الأساسية للسيرفر بعد إعادة البناء |
| `c2-backward.cjs` | **PASS** | بيانات قديمة `unitPrice` تبقى، GET تعيد `price`، إعادة الدفع → skip (لا تكرار، syncId ثابت) |
| `c2-failure.cjs` + `c2-fail2.cjs` | **PASS** | سجل يخالف `CHECK` على `status` → تفشل الكتابة، تظهر في `conflictDetail` (reason حقيقي) وتُسجَّل في `sync_log` |
| `c2-tests/run-tests.js` | **15 ناجح / 0 فاشل** | محرك التصميم unaffected |

## 4) أدلة إضافية (من المخرجات الفعلية)
- `c2-audit2.cjs` F1 … F26: `26 ناجح / 0 فاشل` (exit 0).
- `c2-server-smoke.cjs`: `6 ناجح / 0 فاشل` (exit 0).
- `c2-backward.cjs`: `GET order_items[0]` يعيد `price:42` و`unitPrice:42`؛ `REPUSH` → `{skipped:1}`.
- `c2-fail2.cjs`: صف `sync_log` يحتوي
  `[{"syncId":"baditem","reason":"فشل إدراج: CHECK constraint failed: status IN ('pending',...)"}]`.

## 5) أثر عكسي (Backward Compatibility)
- `unitPrice` القديمة يُحتفظ بها على السيرفر، وGET تعرضها للعميل كـ `price`, ولا يُفقد أي صف قديم.
- إعادة الدفع بنفس `syncId` تُحدِّث/تتخطى دون تكرار (التحقق لكل من old+new).

## 6) حالة النتائج في `CRITICAL-POST-AUDIT.md`
- PT12 → **أُصلح** (مُثبَّت عبر الاختبارات والاستطلاع العكسي).
- PT13 → **أُصلح** (SAFE_TABLES + GET 200).
- PT24 → **أُصلح** (GET للمخازن الستة 200).
- `_applyLocal` → **أُصلح** (لا بلغ للأخطاء؛ تُسجَّل في `sync_log` و`conflictDetail`).
- أُضيف قسم "تحديث ما بعد الإصلاح" أسفل `CRITICAL-POST-AUDIT.md`.

## 7) مخاطر مؤجَّلة (لم تُصلَح عمداً)
- **مصادر الضريبة المتعددة:** `Settings.get('taxRate')` (افتراضي 14، في `index.html` `_autoSaveCore`)
  مقابل `Taxes.calculateTotal` من مخزن `taxes`. لم أُعدّل أي منطق ضريبي في هذه المرحلة — مُسجَّل كخطر للفحص لاحقاً.

## 8) الأثر
- بناء الخلفية يعمل: `tsc` نجح (dist أُعيد بناؤه 2026-08-31 08:25)؛ `node --check admin\database.js` نجح.
- نسخة احتياطية قبل الإصلاح: `C:\Users\Acer\AppData\Local\Temp\opencode\lucca-c2fix-backup-20260831-082113`.

## 9) الحالة العامة
- **كل الاختبارات: 0 FAIL.** لم يبق أي FAIL مؤكد.

> التوقف هنا: بانتظار موافقة المستخدم قبل أي انتقال إلى أولويات HIGH (لا أبدأ HIGH تلقائياً).
