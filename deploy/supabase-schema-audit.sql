-- ============================================================================
-- LUCCA POS — Safe Schema Audit (قراءة فقط — READ ONLY)
-- ============================================================================
-- المرحلة 1: هذا الملف للقراءة فقط 100%. لا CREATE/ALTER/DROP/INSERT/UPDATE/DELETE.
-- شغّله في Supabase > SQL Editor ثم أعد النتائج (أو الصق المخرجات كاملة) —
-- خاصةً نتيجتَي الاستعلامين الأخيرين (أعمدة orders + دوال RPC).
--
-- متى تلجأ لهذا الملف؟
-- أداة tools/supabase-schema-audit.cjs تفحص عبر REST/OpenAPI بمفتاح anon.
-- سكك الصلاحيات لا تُظهر information_schema عبر anon، لذا هذا SQL (بدور postgres)
-- يعطي القائمة الدقيقة للعمود/الدوال من داخل المشروع.
-- ============================================================================

-- 1) كل الجداول والأعمدة في المخطط العام (public)
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 2) أعمدة جدول orders تحديداً (الجدول الحرج — يُتوقع منه تطابق RPC v1)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;

-- 3) دوال RPC المطلوبة من التطبيق
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
        'checkout_order','void_order',
        '_lucca_compute_totals','_lucca_deduct_stock','_lucca_restore_stock'
      )
ORDER BY p.proname;

-- 4) (معلوماتية فقط — توثيق الوضع الأمني الحالي، لا يغيّر شيئاً)
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================================
-- التحقق (بعد التشغيل انسخ النتائج وأعدها للفريق):
--   - الجدول (2) يعطي قائمة أعمدة orders الحية: snake_case (v1) أم camelCase (v2)؟
--     التطبيق الحالي (supabase-db.js + RPC v1) يقرأ/يكتب snake_case فقط.
--   - الجدول (3) يثبت أي دوال RPC موجودة فعلياً.
--   - الجدول (4) يعرض سياسات RLS الحالية (وثيقة — لا تعديل).
-- ============================================================================