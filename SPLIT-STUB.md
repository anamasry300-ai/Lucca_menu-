# SPLIT-STUB.md — إكمال ai-pos `awaitingSplitDetails` (تقسيم الدفع)

## القرار
**تكميل المسار** (وليس الحذف). `toolSplitPayment` هو أداة تقسيم دفع واضحة المنتج وتوجد أصلاً: يطلب من المستخدم تفاصيل الأجزاء ("ادفع 200 كاش والباقي فيزا"). المشكلة كانت أن الرسالة التالية **لا يستهلكها أحد** — العلم `awaitingSplitDetails` يُنشأ ولا يُقرأ في أي مكان، فكانت أي رسالة تفاصيل تُفسَّر خطأً كأمر `process_payment` عادي. أُكمل المسار ليغذي نفس مسار `/checkout` السيرفر (قرار P0/P1: لا إغلاق محلي، لا دفع محلي مزيف).

## ماذا كانت العقدة
- `toolSplitPayment` يعرض رسالة "اكتب المبلغ لكل طريقة دفع" ويُرجع `{ needsInput: true, awaitingSplitDetails: true }`.
- `awaitingSplitDetails` لم يكن له أي مستهلك في `process()` — المسار ميت (dead stub). المستخدم يكتب التفاصيل ثم تُستدعي `detectIntent` كأنها أمر جديد (غالباً `process_payment`) ولا يُنفَّذ تقسيم حقيقي.

## المعالجة (`ai-pos-engine.js`)
1. **`this.pendingSplit = null`** في الـ constructor.
2. **`toolSplitPayment`**: يحفظ سياق التقسيم `{ orderId, tableNum, total }` في `pendingSplit` مع الطلب (obligatory idempotency على مستوى السيارة).
3. **مستهلك جديد في `process()`** (قبل multi-command بتمام): إذا كان `pendingSplit` موجوداً:
   - "إلغاء/لا" → يمسح السياق، الطلب يبقى مفتوحاً.
   - نص بلا أجزاء دفع صالحة → طلب إعادة صياغة (يبقى `pendingSplit`).
   - نص صالح → يفسّر الأجزاء ثم `_executeSplitDetails`.
4. **`_parseSplitParts(text)`**: يفسّر صيغ "X كاش"، "كاش X"، "X فيزا"، "بالباقي فيزا"… يدمج أنفس الطريقة، ويحدد طريقة "الباقي".
5. **`_executeSplitDetails(sp, text)`**:
   - إذا وُجد "الباقي": البقية = `total − مجموع الأجزاء الصريحة` وترتبط بطريقة الباقي (نص صريح أو افتراضية card ثم cash). إذا غطت الأجزاء الإجمالي أو زادته → خطأ.
   - تحقق `|مجموع الدفعات − total| ≤ 0.01` وإلا رفض صريح (الطلب مفتوح).
   - كل جزء يحصل على `paymentSyncId` مستقر (`crypto.randomUUID`) — نفس انضباط `confirmSplitPayment` (idempotent على السيرفر، لا تكرار).
   - قفل طاولة (`_acquireTableLock`) ثم **`Orders.checkoutToServer(sp.orderId, { payments })`** — التحصيل حصري عبر `/checkout`:
     - `null` (سيرفر غير متاح) → خطأ "الطلب بقي مفتوحاً ولم يُسجَّل أي دفع"، لا إغلاق محلي.
     - رفض (409) → خطأ + الطلب مفتوح.
     - نجاح → رسالة نجاح، تفريغ `context.currentTable`، `logAudit('split_payment', ...)`.
   - `_releaseTableLock` في `finally`.
   - السيرفر يخصم المخزون مرة واحدة داخل معاملة الـ checkout (لا تكرار).

## الاختبار
- **اختبار واحد** في `backend/test/p1-followup.cjs` (§6b): فحص مصدر ثابت بأن العقدة وُصلت بالمسار الصحيح —
  `toolSplitPayment` يحفظ `pendingSplit = { orderId: order.id, ... }`، و`process()` يستهلك `this.pendingSplit`، و`_executeSplitDetails` يستدعي `checkoutToServer(sp.orderId, { payments })` مع `paymentSyncId`.
- سلوك السيرفر للـ split نفسه (إقفال + صفّي دفع + خصم مخزون مرة + `alreadyProcessed` + رفض مبلغ غير مطابق) مغطى مسبقاً باختبارات `P1-split` في نفس الملف وصافي 66/66.

## النتيجة
`npm run build` ✓ (tsc) · `npm test` 160/160 ✓
(الفرق 66→67 تحوّل عدد فحوصات p1-followup من 66 إلى 67 بعد إضافة §6b.)

> ملاحظة: `split_bill` (معلوماتي: تقسيم المبلغ على N أشخاص) لم يُلمس. لا تغيير على CRUD / sync / proxy-llm / المطبخ.