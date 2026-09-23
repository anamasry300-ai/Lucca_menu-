# عقد المزامنة (Sync Contract)

> المستند: `docs/SYNC_CONTRACT.md` — مخرج Phase 1.
> الحالة: عقد لعمل المزامنة الحالية + الهدف (الانتقال Phase 10). لا تعديل كود بهذه المرحلة عدا غطاء الحماية المالي الموثق (PHASE1_DECISIONS D6).

---

## 1) وضعان، آليتان، وصيغتان — التمييز الدقيق

### 1.1 الوضع المحلي (`luccaDataMode == 'local'`)

**الصيغة 1 — POS SyncQueue** (`index.html:5259`):
```json
{ "action": "create|update|delete", "collection": "orders|...", "data": {...}, "ts": "<iso>", "retries": 0 }
```
- المفتاح: `lucca_sync_queue` (localStorage).
- المستهلِك: `POST /api/:collection` و `PUT /api/:collection/:id` على الـ backend المحلي.
- تُنشأ بواسطة `_enqueueOrderSync()` و `SyncQueue.start()`.

**الصيغة 2 — ServerSync (الرئيسي والمستقر)** (`admin/database.js`):
- `pushAll()`: دفعة كاملة من IndexedDB → `POST /api/sync` → دمج آمن `newestWins` (فترة غموض 5s)، بلا DELETE.
- `pullAll()`: جلب كامل من server → IndexedDB.
- صيغة المسارات محددة فبي `SYNC_STORES` (`database.js:14-20`، 28 مخزنًا) — كلها مبثوثة بـ `syncId`/`updatedAt` (C2).
- الصوت المباشر: تستبدل السلوك الفعلي **في الوضع المحلي**.

> ملاحظة إثبات (D-E): عند وجود تعارض صيغ (P2) يعمل POS SyncQueue بصيغته، و ServerSync يعمل DEF فلسaría بصيغته المستقلة؛ لا يحب أن يقرأ أحدهما من localStorage بصيغة الآخر → شريط أحمر كاذب POST /api/undefined (يوثق في PHASE1_DECISIONS).

### 1.2 الوضع السحابي (`luccaDataMode == 'supabase'`)

**الصيغة 3 — sync-engine.js** (`sync-engine.js`):
```json
{ "id": "uuid", "table": "orders|...", "op": "upsert|delete", "recordId": "...",
  "data": {...}, "deviceId": "...", "timestamp": "...", "retries": 0, "status": "pending|..." }
```
- نفس المفتاح `lucca_sync_queue` لكن بصيغة مختلفة (يُقرأ `_queueIdx` بصيغته... المستهلك = sync-engine)، وأعمدة `_synced/_device_id/_synced_at`.
- **الوضع السحابي المكتوب**: يكتب مباشرةً إلى Supabase عبر `supabase-db.js` (استبدال `window.LuccaDB`) + RPC للماليات، و sync-engine للمخزون/الككتالوج.

---

## 2) قاعدة الحسم: الكاتب المالي الواحد لكل وضع

| الوضع | مالي (orders ماغلقة، payments، refunds، stock) | غير مالي (ككتالوج/عمليات) |
|---|---|---|
| local | **backend SQLite فقط** (checkout/void/refunds write-hooks) — المزامنة تنقل order قبل الدفع فقط | IndexedDB يُنسخ إلى backend → server |
| supabase | **Supabase فقط** (RPC checkout/void/upsert guarded) — **لا REST محلي يكتب ماليات** | Supabase؛ الـ local إن وُجد قراءة فقط |

**الغطاء الحاسم (D6 — نُفِّذ):** في وضع supabase، `_enqueueOrderSync()` يخرج فورًا (لا REST كتابة للـ backend المحلي للماليات). هذا هو الإصلاح الوحيد المالي المسموح في Phase 1. أي ترحيل لاحق يجب ألا يفتح هذا الباب.

---

## 3) القواعد الثابتة للمزامنة

1. **syncId** لكل سجل (UUID v4). قيد فريد (per table).
2. **newestWins** مع فترة غموض 5s (`updatedAt`)، إلا الحالات التي يثبت فيها (conflict) → تُحفظ دون استبدال + تُسجَّل في sync_log.
3. **لا DELETE مالي** — لا حذف orders/payments/refunds عبر sync أبدًا (ٳلغاء يتم بالحالة/void).
4. **الرابط عبر معرّف مستقر**: order_item يرتبط بالأب عبر `orderSyncId`، payment عبر `orderSyncId` (+ `orderId` ورقمي مرجعي) — مثبت في run-tests (TEST6/6b/7).
5. **idempotency** لكل رتل فريد (paymentSyncId — sibling e متعدد/دفعة split؛ eventId — audit) تعيد نفس النتيجة عند retry.
6. **rollback ذرّي** عند انقطاع في منتصف الدمج (TEST5/11: committed=false، صفر صفوف جزئية).
7. **أولوية القراءة**: الـ local يعمل دون server (IndexedDB موثوقة كعمل خرائط)؛ الدفع يحتاج backend متاح (أو Supabase في الوضع cloud).
8. **التعارض غير المكلو**: يُسجَّل ولا يُحذف — لا فقدان بيانات مال.

---

## 4) مسارات المزامنة (نقاط الاتصال، من الكود)

| المسار | ماذا يحرّك | المستهلك |
|---|---|---|
| `_enqueueOrderSync()` (index.html:5346) | order بعد update (خارج الغطاء) | REST API محلي (local) / مخرج (supabase) |
| `SyncQueue.start()` (index.html:5427) | يجفف `lucca_sync_queue` | REST API محلي |
| `ServerSync.pushAll/pullAll` (database.js) | دُفعة كاملة عبر `/api/sync` | backend sync router (newestWins، لا DELETE) |
| `sync-engine.js` | queue s3 (supabase) | PostgREST/RPC |
| `wrapDBOperations` enableSync (database.js:3764) | يمرر كتابات IndexedDB عبر sync-engine بصيغة s3 | — |

---

## 5) عقد الهدف عند التوحيد (Phase 10 / لا شيء قبلها)

طابور واحد بصيغة واحدة، مسارات مصنفة بوضعها، لا تعارض صيغ:

```json
{
  "id": "uuid",                 // معرّف الرتل
  "entity": "orders|payments|refunds|products|...",
  "entityId": "syncId",
  "operation": "upsert|create|update|delete(غير مالي فقط)",
  "payload": { ... },
  "source": "pos|admin|batman|kitchen",
  "mode": "local|supabase",
  "status": "pending|processing|synced|failed|dead_letter",
  "createdAt": "iso", "updatedAt": "iso",
  "retryCount": 0,
  "lastError": null
}
```

دورة الحياة: `pending → processing → synced`؛ عند الخطأ → `failed` مع `retryCount`↑؛ تجاوز السقف (مثلاً 15) → `dead_letter` — ولا حذف أبدًا. المنفذة للقفز تحقق من الماليات: أي رتل مالي في وضع supabase مع مصدر POS محلي → مستحيل (الغطاء).

ملاحظة: توحيد المفتاح `lucca_sync_queue` (صيغة s1 vs s3) قرار موثق في PHASE1_DECISIONS D7 — لا يتم الآن لتجنّب كسر POS hot path؛ يُنفّذ في Phase مع test-first.

---

## 6) التعارض وتصفية الحوادث المعروفة

- **تعارض بدون timestamp** → لا استبدال، يُسجَّل (TEST3).
- **نسخة أحدث** → تحديث (TEST2).
- **عدد غير متطابق (retry)** → idempotency يمنع التكرار (p1-followup P1-split).
- **انقطاع أثناء الترحيل** → rollback ذرّي (TEST5/11).

هذا العقد يوثّق السلوك القائم كإلزام، ويوثّق الغطاء المالي النهائي للوضع السحابي.