# C3 — تقرير تدقيق "Lucca Caffè POS" (حقائق من الكود فقط)

> الكل حقائق موجودة في كود `C:\Users\Acer\OneDrive\Desktop\Lucca_menu-` بتاريخ 2026-09-17.
> كل نقطة = مسار ملف:سطر + اقتباس قصير. الغياب = **غير موجود**.

---

## A) ملخص تنفيذي (تنفيذي)

1. البنية: Node/Express + better-sqlite3 (WAL، busy_timeout=5000، FK=ON) في `backend/`، وواجهة POS بدون إطار عمل في `index.html` + طبقة IndexedDB في `admin/database.js`، مع مسارات دقيقة للـ checkout/void/sync داخل `backend/src/index.ts` والـ CRUD العام في `routes/crud.ts`.
2. **الخطر الأكبر (P0):** كاشير/جهاز يحمل صلاحية `orders.write` يستطيع إغلاق أي طلب وعلامته "مدفوع" مباشرة عبر `PUT /api/orders/:id` أو `/api/sync` — بتجاوز كامل لمسار checkout الذي يُنشئ الدفعة والفواتير والوردية — **بدون أي سجل تدقيق**.
3. **الخضراء:** مسار checkout الصريح نفسه آمن: معاملة واحدة، idempotency عبر `paymentSyncId`، rate-limit 10/دقيقة، والمخازن الإدارية ممنوعة عن device في `/api/sync`.
4. **غائب:** السيرفر لا يخصم المخزون عند الدفع إطلاقاً؛ الخصم يحدث في الواجهة فقط "في الخلفية" خارج المعاملة، غير idempotent — ودمج `inventory` عبر النسخ (version) يعني مخزون خاسر/متضاعف مع أجهزة متعددة.
5. **غائب:** أي قفل ضد الضغط المزدوج لعملية الدفع في الواجهة؛ في الوضع أوفلاين ممكن فاتورتان/دفعتان لنفس الطلب.
6. **غائب:** أي فحص أن الطلب محسوم/مغلق يمنع تعديله أو حذفه أو تغيير مبلغه عبر CRUD؛ وحذف صف `refunds` عبر generic DELETE يمحو سجل الاسترداد بلا أثر.
7. آمن/موثق جيداً: المصادقة (PBKDF2-SHA512 + جلسات بالذاكرة + 12h TTL)، الـ void (سبب إجباري + تدقيق بكليهما)، batman بمصفوفة minRole/limitValue، مزامنة الدمج في معاملة واحدة.
8. المطبخ: **غير موجود** WebSocket — poll كل 10 ثوانٍ في `kitchen.html:642` (تأخير + ضغط).
9. التفاوت: الشفت/الصندوق المالي محلي بالكامل، والسماح بالدفع بدون فتح وردية نقدية (قرار إدارة، `index.html:3393`) يجعل `cash_registers` سجلّاً اختيارياً غير محكم.
10. التوصية العاجلة: غلق مسارات CRUD على المخازن المالية، نقل خصم المخزون إلى معاملة server checkout (idempotent)، وقفل الزر أثناء السداد.

---

## B) جدول المخاطر (مرتب P0→P2)

| # | الشدة | الملف:السطر | ماذا يحدث | الأثر | إصلاح في سطر |
|---|-------|------------|-----------|-------|--------------|
| 1 | **P0** | `backend/src/routes/crud.ts:288,305-308,314-320` | `PUT /api/orders/:id` يسمح بأي `status` من القائمة (بها `'closed'`) وأي حقول (`total`,`paymentStatus`,`orderNumber`) بلا فحص أن الطلب مغلق/مدفوع، وبلا تدقيق (لا يوجد `recordAuditLog` في PUT) | كاشير/جهاز يستطيع إغلاق طلب ووضعه `paid` بلا دفعة أو فاتورة، أو تعديل إجمالي طلب مغلق — خسارة نقدية + تلاعب تقارير | امنع في PUT: الحالات `closed/cancelled` والكتابة على `paymentStatus/total/totalPaid/orderNumber` لأي دور غير مخصّص |
| 2 | **P0** | `backend/src/index.ts:572-595` (sync يقبل `orders` لكل هوية بصلاحية `sync`) + `auth.ts:110,114,122` (cashier/device لديهم `sync` + `orders.write`) | `/api/sync` يدمج صفوف `orders` الجاهزة بـ `status='closed', paymentStatus='paid'` (orders ليست في `ADMIN_ONLY_STORES` auth.ts:130-132) | نفس تجاوز النظام المالي عن طريق آخر، بلا عبور checkout | لا تُحدَّث حالة إغلاق/دفع في sync إلا عبر هوية admin/manager أو استبعدها من الدمج |
| 3 | **P0** | server checkout `index.ts:352-399` لا يمسّ المخزون؛ الخصم Client-only خارج المعاملة `admin/database.js:1359-1360` `Inventory.deductForCheckout(localOrder.items||[]).catch(() => {})` | لا يوجد مصدر حقيقة للمخزون؛ `deductForCheckout` غير idempotent و"أُنشئ بلا انتظار" خارج txn | احتساب أصناف مزدوج/مفقود عند إعادة محاولة أو جهاز متعدّد | خصم server-side داخل معاملة checkout مُربوط بـ orderSyncId، وإبطال الشكل الخلفي |
| 4 | **P1** | `admin/database.js:1284-1288` + `index.html:5385`(F2→click) مع `index.html:3444` | لا يوجد أي قفل In-flight على الزر/السداد (`checkoutInProgress` **غير موجود**) | ضغط مزدوج أوفلاين → استدعاؤان متزامنان لـ checkout: الحالة ما زالت `pending` لكلاهما → فاتورتان+دفعتان+خصمان للمخزون (الوضع أونلاين محصّن: 409 + idempotency)`index.ts:311-325` | قفل برمجي (Promise/lock) حول `Orders.checkout` + تعطيل الزر أثناء العملية |
| 5 | **P1** | `crud.ts:190-277` (POST عام) — `refunds` في `WRITE_ADMIN_STORES` (crud.ts:28) لكن **بلا تحقق**: أي `amount`، أي `orderId`، بلا حاجة لسبب/طلبات مدفوعة | مدير/أدمن يُسجّل استرداداً بمبلغ مفتعل لطلب لا علاقة له | موازنة استردادات خاطئة وتغطية لنقود | نقطة استرداد واحدة متحكم فيها (كما في void index.ts:415-456) أو تحقق من المبلغ ≤ المدفوع والطلب مدفوع |
| 6 | **P1** | `crud.ts:338-346` DELETE عام — لا `recordAuditLog`؛ حذف `refunds` ينجح فوراً (لا FK أبوي؛ الـ FK في schema.sql:295,309,326,344 بلا `CASCADE`) | حذف سجل استرداد يمحو دليلاً مالياً من البرنامج بينما الطلب يبقى `refunded` | إخفاء أثر مالي بدون أثر تدقيق | منع DELETE على `orders/refunds/payments` أو تسجيل تدقيق إجباري + اشتراط تعليق |
| 7 | **P1** | `index.ts:214-293` `/api/proxy-llm` — الـ `base` يُقبل من العميل طالما يبدأ `http(s)://` (سطر 228) | جلسة صالحة تستخدم الخادم كـ SSRF/ماسح منافذ للشبكة الداخلية (localhost/LAN) عبر LLM proxy | استغلال شبكي من وراء الجلسة | Allow-list للمضيفين المسموحين لا `http(s)` فقط |
| 8 | **P1** | `kitchen.html:630-642` `function refreshOrders(){...}` + `setInterval(refreshOrders, 10000)` — WebSocket/EventSource **غير موجود** (مطابقة: لا نتائج WebSocket في kitchen.html) | شاشة المطبخ تعرض الجديد بفارق حتى 10 ثوانٍ، وإذا أُعيد الـ fetch في أثناء Rendering تكرر | تجربة+حمولة على أجهزة منخفضة | دفع/SSE أو poll ≤3s مع debounce |
| 9 | **P2** | `auth.ts:17-18` `const sessions = new Map()...`؛ TTL `auth.ts:6` (12h) | الجلسات في الذاكرة فقط: إعادة تشغيل السيرفر تطرد الجميع؛ TTL ثابت | انقطاع عمل مع كل deploy | تخزين session في DB مع expiry |
| 10 | **P2** | `index.ts:154` rate-limit checkout لكل IP (10/دقيقة) — عدّاد ذاكرة لكل IP مصدره `req.ip` | تجاوز سهل بتغيير IP أو عبر أنظمة خلف NAT مشتركة (429 خاطئ جماعي) | حماية رمزية فقط على مسار مالي | rate-limit على (ip+actortoken) مع احتساب التحميل العام index.ts:151 |
| 11 | **P2** | `backend/src/routes/tableLocks.ts:10` `LOCK_TTL_SECONDS = 60` قفل استشاري (advisory) منفصل عن الـ order | القفل تنتهي مدته (60s) قبل أي التزام، والمنافسة الحقيقية على فتح طلب لنفس الطاولة تُمنع فقط بفحص DB عند الإنشاء (crud.ts:201-213) | منافسة بين جهازين على نفس الطاولة ووجود نوافذ تعارض | ربط القفل بالمعاملة/رقم قراءة يتحقق عند الإدراج وليس بالـ TTL فقط |
| 12 | **P2** | `index.html:3393-3394` "لا شرط لفتح وردية نقدية — الكاش يعمل مباشرة" + `database.js:1294-1299` تسجل الصندوق فقط إن كان مفتوحاً لحظة الدفع | `cash_registers` يفوّت مبيعات نقدية إذا لم يُفتح الصندوق — تسوية الوردية لا تعكس الحقيقة | تقارير كاش غير مطابقة لنقود الصندوق | اشتقاق `expectedCash` من `payments` عند الإقفال بدل العدادات المحلية |
| 13 | **P2** | `database.js:2030-2033` إعادة حساب `expectedCash` في كل `recordTransaction` + `1975-1978` تُحسب في الإقفال من `totalCashSales` المحلي فقط | الوردية تعتمد على عدادات محلية قابلة للتعديل ولا تقرأ `payments` من السيرفر | تحقق كاش ضعيف | حساب expected من payments (server) في الإقفال |

---

## C) مسارات تُغلق فوراً (تكتب نفوذاً/مخزون/طلبات مقفلة بدون checkout)

| الطريقة + المسار | الملف:السطر | السبب |
|---|---|---|
| **PUT** `/api/orders/:id` | `crud.ts:288` | كاشير/device (صلاحيات `orders.write`) يُغلق الطلب ويغيّر `total`/`paymentStatus` بلا دفع — بلا تدقيق |
| **POST** `/api/sync` (حقول `orders`) | `index.ts:562` | يدفع `orders` مغلقة/مدفوعة من أجهزة بأذونات `sync` دون عبور checkout |
| **DELETE** `/api/refunds/:id` | `crud.ts:338` | يمحو سجل استرداد (!) بلا تدقيق |
| **POST** `/api/refunds` (طريق عام) | `crud.ts:190` | استرداد مفتعل: مبلغ حر بدون تحقق من طلب/دفعة/سبب |
| **PUT** `/api/payments/:id` | `crud.ts:288` + `auth.ts:110` | كاشير يعدّل مبلغ الدفعة عبر CRUD |
| **DELETE** `/api/orders/:id` | `crud.ts:338` | حذف طلب مدفوع (مقيد بـ FK إن وُجدت أبناء، وإذا لا → حذف صامت بلا سجل) |

---

## D) المقتطفات الحرجة (ملخصات مع الملف:السطر)

### D1) Checkout (سيرفر) — `backend/src/index.ts:297-411`
```ts
app.post('/api/orders/:id/checkout', authRequired, requirePermission('checkout'), (req,res) => {
  // 304: order = SELECT ... (404 إن غاب)
  // 311-325: paymentSyncId → SELECT payments WHERE syncId → sameOrder → {alreadyProcessed:true}  // idempotency
  // 328: if (order.status === 'closed') 409 'Order is already closed'
  // 330: beginTransaction()
  // 338-349: توليد/إصلاح orderNumber (nextFreeOrderSeq) بلا تصادم
  // 352-355: UPDATE orders SET status='closed', paymentStatus='paid', totalPaid=total ... WHERE id=?
  // 358-361: تحرير الطاولة
  // 366-370: INSERT payments (syncId || newSyncId()) // لا خصم مخزون هنا
  // 374-380: INSERT order_items (unitPrice من item.total...)
  // 383-386: INSERT order_status_history
  // 389-399: UPDATE daily_shifts (فقط إن وُجد shift لهذا اليوم — لا إنشاءات)
  // 401: commitTransaction()
});
```
**النقاط:** آمنة جداً في حد ذاتها؛ لكنها **لا تخصم المكتبات/الوصفات إطلاقاً**، ولا تُنشئ shift اليوم (يُحدَّث فقط إن وُجد).

### D2) Checkout (محلي/أوفلاين) — `admin/database.js:1284-1423`
```js
async checkout(orderId, paymentMethod) {
  // 1288: if (localOrder.status === 'closed') throw
  // 1305: const serverResult = await ServerAPI.checkout(orderId, { paymentMethod }) // أونلاين → ذري
  // 1306-1316: نجاح → يطابق من السيرفر، يحرر الطاولة، _recordDrawerSale()
  // 1359-1360: Inventory.deductForCheckout(localOrder.items||[]).catch(()=>{})  // خارج المعاملة وغير idempotent
  // 1370-1413: معاملة IDB واحدة readwrite(['invoices','payments','orders','order_items'])
  //     → invoice.add → payment.add → orders.put(status closed) → order_items deleteAll+add
  // 1423: ServerAPI.checkout(orderId, { paymentSyncId ... }) // إعادة مزامنة الدفعة المحلية
}
```
**النقاط:** المعاملة المالية واحدة (لا فاتورة بلا دفعة) ✓؛ لكن خصم المخزون **خارجها وبلا انتظار**، وبدون قفل زر → ضغط مزدوج أوفلاين = فاتورتان.

### D3) Void/Refund — `backend/src/index.ts:415-456`
```ts
app.post('/api/orders/:id/void', authRequired, requirePermission('refunds.void'), (req,res) => {
  // 420: if (!reason) 400 'السبب إلزامي'
  // 424: if (order.status==='cancelled') 409
  // 443: beginTransaction()
  // 446-449: INSERT refunds (orderId, amount, reason, ..., voidedBy=cancellerName)
  // 452-456: UPDATE orders SET status='cancelled', paymentStatus='refunded', refundAmount=total
  // 460-462: تحرير الطاولة
  // 465-468: order_status_history
  // 471-474: audit_logs بكل من الموظف الأصلي والمُلغِي (لا void صامت)
});
```
**نقطة ضعف:** مسار الـ void ممتاز، لكنه **وحده يُسجّل الاسترداد**؛ بينما `POST /api/refunds` العام (crud.ts:190) يسمح باسترداد بلا حالة/فحص.

### D4) Sync merge — `backend/src/index.ts:562-746`
```ts
app.post('/api/sync', authRequired, requirePermission('sync'), (req,res) => {
  // 572-580: stores = [...] (كل المخازن)
  // 591-595: ADMIN_ONLY_STORES && !isAdminish → skip   // users/settings/audit/daily_shifts/shifts
  // 634-648: ترجمة الأعمدة (price→unitPrice) + كتابة أعمدة الجدول فقط
  // 651-654: البحث بالسجل من السيرفر عبر syncId
  // 667-672: !existing → INSERT
  // 691:     else if (sameData(existing, normItem)) log.skipped
  // 694-711: اختيار الأحدث عبر version/revision ثم updatedAt (AMBIGUITY_MS)
  // 712-717: incoming أحدث → UPDATE
  // 719-722: وإلا → log.conflicts ('النسخة المحلية أحدث' / 'تعارض بلا نسخة أحدث موثوقة')
  // 745-746: INSERT sync_log (conflicts)
});
```
**نقطة ضعف:** يدمج `orders` لأي هوية `sync` — أي جهاز/كاشير يفرض حالة إغلاق/دفع عبر المزامنة (P0#2)، والصراعات تُسجَّل في `sync_log` فقط دون أي واجهة تحذير.

### D5) Crud عام (POST/PUT/DELETE) — `backend/src/routes/crud.ts`
```ts
// 190: router.post('/:store') — writeDenied ثم insert للعموم
//     → 201-213: منع طلبات متتالية لنفس الطاولة (حالة pending فقط)
//     → 216-234: فحوص status مطابقة، منع ورديتين مفتوحتين معاً في cash_registers
//     → 281: recordAuditLog('create',...)   // التدقيق موجود في POST فقط
// 288: router.put('/:store/:id') — writeDenied ثم update مجاني
//     → 305-308: يتحقق فقط أن status من القائمة (بها 'closed')
//     → 314-320: إذا status completed/cancelled/closed → يحرر الطاولة
//     → **لا recordAuditLog هنا**
// 338: router.delete('/:store/:id') — deleteDenied (admin/manager) ثم delete خام
//     → **لا recordAuditLog هنا**
```

---

## E) أسئلة غير محسومة

1. لماذا خصم المخزون خارج معاملة checkout السيرفر؟ كما هو مذكور في `database.js:1359` "work in background" — هل هو تجاهل مقصود لمنع تأخير الدفع؟ هذا يحوّل الخصم من التزام فعلي إلى ملاحظة لا يمكن الاعتماد عليها.
2. ما هو مصدر الحقيقة المقصود للمخزون؟ السيرفر لا يكتب `stock_movements`/`inventory` إطلاقاً — الواجهة فقط، والدمج آخِذٌ بأحدث إصدار (آخر كتابة). قرار معماري غير موثّق في الكود.
3. هل `AMBIGUITY_MS` (معامل الغموض بين نسختين في sync, index.ts:707) موجود في جهة ما؟ لم يوجد تعريف ثابت في القراءة — النسخة الأحدث عند فرق < AMBIGUITY_MS بغموض (يُدخَل كـ conflicts). يحتاج إثباتاً.
4. `SELECT SESSION_COOKIE` معرّف (auth.ts:7, والسيرفر CORS يسمح بـ x-session-token) لكنه **غير مستخدم في أي مكان لإصدار الكوكي (غير موجود)** — متى/كيف يُقصَد استخدامه؟ الجلسات تعمل بـ Bearer/token في localStorage فقط.
5. هل التسوية النقدية المقصودة تعتمد على `cash_registers` المحلي أم على `payments`؟ الواجهة تسمح بالدفع نقداً بدون فتح وردية (`index.html:3393`) — وهو تناقض تشغيلي غير محسوم.
6. هل حذف `refunds` مُستدعى من أي شاشة؟ لا يُستدعى من أي شاشة سوى crud العام — إن كان، فكيف يُحفظ الأثر؟
7. خاصية إعادة ربط FK babies في sync للـ `payments`/`invoices` (index.ts:601-612, 728-729) — هل `orderSyncId` لصفوف قديمة يُطابَق؟ الصفوف بدون orderSyncId (قبل الترحيل) ستبقى مرتبطة بروابط خاطئة.
8. في `PUT /api/orders/:id`، هل السماح بتعديل `total` لطلب مغلق مقصود لأغراض تصحيح، أم ثغرة؟ لا يوجد لا comment ولا مقيّد.

---

## ملاحظات منهجية

- `غير موجود` (مؤكد): WebSocket في kitchen/monitor، خصم مخزون سيرفر في checkout، قفل زر السداد، تدقيق في PUT/DELETE لـ crud، فحص طلب مغلق/مدفوع في CRUD، وجلسات خارج الذاكرة.
- «وجود هذه النقاط في "الأحدث" أو في خطط المرحلة غريبة» — لكن هذا تقرير يوثّق *الوضع الحالي* فقط كما في الكود.