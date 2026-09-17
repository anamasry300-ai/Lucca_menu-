-- =====================================================================
-- LUCCA POS — Seed مستخدمي Auth تجريبيين لاختبار RLS (Phase 1)
-- =====================================================================
-- يُشغَّل بعد deploy/supabase-schema-v2.sql وبإذن من صاحب الحساب.
-- ينشئ مستخدمين تجريبيين في auth.users + يربطهم بالأدوار في app_user_roles.
-- ثم تحقق عبر:  node tools/test-supabase-rls.cjs
--
-- كلمات المرور التجريبية (تجريبية فقط — تُحذف بعد التحقق):
--   manager@lucca.test / TrialPass@2026
--   cashier@lucca.test / TrialPass@2026
-- =====================================================================

-- مستخدم director تجريبي
DO $$
DECLARE manager_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'manager@lucca.test') THEN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'authenticated', 'authenticated',
      'manager@lucca.test',
      crypt('TrialPass@2026', gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Trial Manager"}',
      now(), now()
    ) RETURNING id INTO manager_id;
    INSERT INTO app_user_roles (user_id, role) VALUES (manager_id, 'manager');
  END IF;
END $$;

-- مستخدم كاشير تجريبي
DO $$
DECLARE cashier_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'cashier@lucca.test') THEN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'authenticated', 'authenticated',
      'cashier@lucca.test',
      crypt('TrialPass@2026', gen_salt('bf')),
      now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Trial Cashier"}',
      now(), now()
    ) RETURNING id INTO cashier_id;
    INSERT INTO app_user_roles (user_id, role) VALUES (cashier_id, 'cashier');
  END IF;
END $$;

-- تحقق سريع — اعرض المستخدمين والأدوار
SELECT au.email, ar.role
FROM auth.users au
LEFT JOIN app_user_roles ar ON ar.user_id = au.id
WHERE au.email LIKE '%@lucca.test'
ORDER BY ar.role;