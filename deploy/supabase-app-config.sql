-- ============================================================
-- Lucca POS — App Config Table for Force Update (P0 Security)
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  id BIGSERIAL PRIMARY KEY,
  min_required_version TEXT NOT NULL DEFAULT '0.0.0',
  latest_version TEXT NOT NULL DEFAULT '0.0.0',
  update_required BOOLEAN NOT NULL DEFAULT false,
  update_message TEXT DEFAULT '',
  release_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهرس للقراءة السريعة
CREATE INDEX IF NOT EXISTS idx_app_config_id ON public.app_config (id);

-- تفعيل RLS (Row Level Security) — القراءة فقط للجميع، الكتابة محظورة
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- سياسة سماح بالقراءة (SELECT) للجميع بما في ذلك anon (Supabase client)
CREATE POLICY "app_config_select_all" ON public.app_config
  FOR SELECT
  TO public
  USING (true);

-- سياسة منع الكتابة التامة (INSERT/UPDATE/DELETE) لكل الأدوار
CREATE POLICY "app_config_write_deny_all" ON public.app_config
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- إدراج السجل الافتراضي (التحديث الأمني الإجباري v1.3.6)
INSERT INTO public.app_config (
  min_required_version,
  latest_version,
  update_required,
  update_message,
  release_date
) VALUES (
  '1.3.6',
  '1.3.6',
  true,
  'تم إصدار تحديث أمني إلزامي. يجب تحديث التطبيق للمتابعة.',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  min_required_version = EXCLUDED.min_required_version,
  latest_version = EXCLUDED.latest_version,
  update_required = EXCLUDED.update_required,
  update_message = EXCLUDED.update_message,
  release_date = EXCLUDED.release_date,
  updated_at = NOW();
