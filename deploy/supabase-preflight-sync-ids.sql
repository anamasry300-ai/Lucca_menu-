-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-preflight-sync-ids.sql  (READ-ONLY — لا DML ولا DDL)
-- المرحلة 2B — فحص sync_id في payments / refunds قبل تشغيل migrate:
--
--   الجداول: public.payments ، public.refunds
--   ما يُفحص:
--     1) NULL sync_id
--     2) سلسلة فارغة sync_id ('')
--     3) sync_id مكرّر (غير NULL وغير فارغ) — ممنوع قانونياً قبل رفع قيد فريد
--        (unique index) لأنه سيفشل CREATE UNIQUE INDEX عند تطبيق المخطط.
--
-- كل الاستعلامات SELECT فقط. النتائج تُقرأ وتُردّ. لا تُنفّذ عليها أي كتابة.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- A) payments — نظرة عامة
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'payments' AS tbl,
       COUNT(*)                                   AS total_rows,
       COUNT(*) FILTER (WHERE sync_id IS NULL)    AS null_sync,
       COUNT(*) FILTER (WHERE sync_id = '')       AS empty_sync,
       COUNT(*) FILTER (WHERE sync_id IS NOT NULL AND sync_id <> '') AS nonempty_sync
FROM public.payments;

-- A1) payments: صفوف sync_id = NULL
SELECT id, order_id, method, amount, created_at, sync_id
FROM public.payments
WHERE sync_id IS NULL
ORDER BY created_at DESC;

-- A2) payments: صفوف sync_id = ''
SELECT id, order_id, method, amount, created_at, sync_id
FROM public.payments
WHERE sync_id = ''
ORDER BY created_at DESC;

-- A3) payments: sync_id مكرّر (كل قيمة تظهر أكثر من مرة)
SELECT sync_id, COUNT(*) AS cnt,
       array_agg(id ORDER BY created_at DESC, id) AS payment_ids
FROM public.payments
WHERE sync_id IS NOT NULL AND sync_id <> ''
GROUP BY sync_id
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- A4) payments: تكرارات عبر ORDER_ID (نفس الطلب أكثر من دفع بنفس sync_id)
SELECT order_id, sync_id, COUNT(*) AS cnt, array_agg(id) AS payment_ids
FROM public.payments
WHERE sync_id IS NOT NULL AND sync_id <> ''
GROUP BY order_id, sync_id
HAVING COUNT(*) > 1
ORDER BY order_id, sync_id;

-- ─────────────────────────────────────────────────────────────────────────
-- B) refunds — نظرة عامة
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'refunds' AS tbl,
       COUNT(*)                                   AS total_rows,
       COUNT(*) FILTER (WHERE sync_id IS NULL)    AS null_sync,
       COUNT(*) FILTER (WHERE sync_id = '')       AS empty_sync,
       COUNT(*) FILTER (WHERE sync_id IS NOT NULL AND sync_id <> '') AS nonempty_sync
FROM public.refunds;

-- B1) refunds: صفوف sync_id = NULL
SELECT id, order_id, reason, amount, created_at, sync_id
FROM public.refunds
WHERE sync_id IS NULL
ORDER BY created_at DESC;

-- B2) refunds: صفوف sync_id = ''
SELECT id, order_id, reason, amount, created_at, sync_id
FROM public.refunds
WHERE sync_id = ''
ORDER BY created_at DESC;

-- B3) refunds: sync_id مكرّر
SELECT sync_id, COUNT(*) AS cnt,
       array_agg(id ORDER BY created_at DESC, id) AS refund_ids
FROM public.refunds
WHERE sync_id IS NOT NULL AND sync_id <> ''
GROUP BY sync_id
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- B4) refunds: تكرارات عبر ORDER_ID
SELECT order_id, sync_id, COUNT(*) AS cnt, array_agg(id) AS refund_ids
FROM public.refunds
WHERE sync_id IS NOT NULL AND sync_id <> ''
GROUP BY order_id, sync_id
HAVING COUNT(*) > 1
ORDER BY order_id, sync_id;

-- ─────────────────────────────────────────────────────────────────────────
-- C) ملخص الحكم النهائي للجاهزية (أعمدة اختيارية)
--    النتيجة المطلوبة قبل التشغيل: 0 تكرارات في A4 و B4.
--    NULL / '' مقبولة مؤقتاً (المخطط الحالي لا يفرض NOT NULL بعد الدوال الجديدة
--    تُزوّد sync_id دائماً) لكن إن كانت كبيرة يُفضَّل تنظيف قبل الرفع.
-- ─────────────────────────────────────────────────────────────────────────