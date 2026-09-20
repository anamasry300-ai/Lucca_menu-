-- Lucca POS Cloud Live migration
-- Run once in Supabase SQL Editor after the canonical schema and RPC migration.
-- This does not contain or require a service_role key.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'orders', 'order_items', 'order_status_history', 'payments',
    'tables_store', 'inventory', 'products', 'categories', 'expenses', 'refunds'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Realtime UPDATE/DELETE payloads need the previous row identity.
ALTER TABLE IF EXISTS public.orders REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.order_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.payments REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.tables_store REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.inventory REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.products REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.categories REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.expenses REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.refunds REPLICA IDENTITY FULL;

SELECT 'LUCCA LIVE: realtime publication configured' AS status;
