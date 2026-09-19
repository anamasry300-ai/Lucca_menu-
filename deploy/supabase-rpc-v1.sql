-- ============================================================================
-- LUCCA POS — Supabase Backend Money Layer (RPC) — v1
-- ============================================================================
-- شغّل هذا الملف كاملاً من Supabase Dashboard → SQL Editor (Run) مرة واحدة.
-- آمن إعادة التشغيل (idempotent): يمكنك تشغيله أكثر من مرة دون ضرر.
--
-- يضيف:
--   1) أعمدة ناقصة للتحصيل الذري/الإلغاء على الجداول الحية (snake_case القديمة).
--   2) جدولي stock_movements و product_recipes (مطلوبان لخصم/استرجاع المخزون).
--   3) دالة  checkout_order(...) — تحصيل ذري آمن التكرار (idempotent).
--   4) دالة  void_order(...)      — إلغاء/استرداد ذري آمن ضد الاسترداد المزدوج.
--   5) GRANT EXECUTE للـ anon (يستدعيها العميل عبر PostgREST مباشرة).
--
-- ملاحظة صلاحيات: الدوال SECURITY DEFINER تنفَّذ بصلاحيات مالك الدالة (postgres)
-- فتعمل حتى لو RLS مفعّل على الجداول القديمة، ويبقى الاستدعاء من العميل عبر
-- PostgREST rpc/ بـ anon key فقط (بدون أي service key).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أعمدة ناقصة (آمنة لإعادة التشغيل)
-- ---------------------------------------------------------------------------

-- مزامنة/تحصيل: syncId لتسجيل الدفعات بثبات (idempotency عبر الأجهزة)
ALTER TABLE public.orders   ADD COLUMN IF NOT EXISTS sync_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS sync_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS order_sync_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- إلغاء/استرداد: بيانات void على الطلب (تطابق أعمدة السيرفر المحلي)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS void_reason TEXT DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS void_note TEXT DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS voided_by TEXT DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_amount DOUBLE PRECISION DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- استرداد: بيانات كاملة مطابقة لصف الاسترداد المفصّل
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS refund_method TEXT DEFAULT 'cash';
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS voided_by TEXT DEFAULT '';
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS sync_id TEXT;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- فهرس idempotency للدفعات: منع تسجيل نفس الدفعة مرتين عبرها كل الأجهزة
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_sync_id
  ON public.payments (sync_id) WHERE sync_id IS NOT NULL AND sync_id <> '';

-- فهرس idempotency للاستردادات
CREATE UNIQUE INDEX IF NOT EXISTS ux_refunds_sync_id
  ON public.refunds (sync_id) WHERE sync_id IS NOT NULL AND sync_id <> '';

-- ---------------------------------------------------------------------------
-- 2) جداول ناقصة (csخم/استرجاع المخزون)
-- ---------------------------------------------------------------------------

-- حركات المخزون (نفس عقد السيرفر المحلي: type = sale/return، order_id للتمييز)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id BIGSERIAL PRIMARY KEY,
  sync_id TEXT,
  product_id BIGINT,
  order_id BIGINT,
  quantity DOUBLE PRECISION DEFAULT 0,
  type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_stock_movements_order_type
  ON public.stock_movements (order_id, type);

-- وصفات المنتج (خصم المخزون حسب الوصفة بدل الاسم 1:1)
CREATE TABLE IF NOT EXISTS public.product_recipes (
  id BIGSERIAL PRIMARY KEY,
  sync_id TEXT,
  product_id BIGINT DEFAULT NULL,
  ingredient TEXT DEFAULT '',
  quantity DOUBLE PRECISION DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_product_recipes_product ON public.product_recipes (product_id);

-- ---------------------------------------------------------------------------
-- 3) دوال مساعدة مشتركة (خساب الإجماليات + خصم/استرجاع المخزون)
-- ---------------------------------------------------------------------------

-- حساب إجمالي/خصم/ضريبة من items (يطابق serverOrderTotals في الباك-إند المحلي)
CREATE OR REPLACE FUNCTION public._lucca_compute_totals(
  items_json JSONB,
  p_discount DOUBLE PRECISION DEFAULT 0,
  p_discount_type TEXT DEFAULT 'percent',
  p_tax DOUBLE PRECISION DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_subtotal DOUBLE PRECISION := 0;
  v_discount_amount DOUBLE PRECISION := 0;
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(items_json, '[]'::jsonb)) LOOP
    v_subtotal := v_subtotal
      + (COALESCE(NULLIF((item->>'quantity')::DOUBLE PRECISION, 0), 1)
         * COALESCE((COALESCE(item->>'unitPrice', item->>'price'))::DOUBLE PRECISION, 0));
  END LOOP;
  IF p_discount_type = 'fixed' THEN
    v_discount_amount := p_discount;
  ELSE
    v_discount_amount := v_subtotal * (p_discount / 100.0);
  END IF;
  RETURN jsonb_build_object(
    'subtotal', round(coalesce(v_subtotal, 0)::numeric, 2)::double precision,
    'discount_amount', round(coalesce(v_discount_amount, 0)::numeric, 2)::double precision,
    'total', round(coalesce(v_subtotal - v_discount_amount + p_tax, 0)::numeric, 2)::double precision
  );
END;
$$;

-- خصم المخزون داخل معاملة التحصيل (idempotent عبر حركة sale لنفس الطلب)
CREATE OR REPLACE FUNCTION public._lucca_deduct_stock(
  p_order_id BIGINT,
  items_json JSONB
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  item JSONB;
  v_name TEXT;
  v_product_id BIGINT;
  v_wanted DOUBLE PRECISION;
  v_applied_recipe BOOLEAN;
  v_ingredient TEXT;
  v_ing_qty DOUBLE PRECISION;
  v_inv_id BIGINT;
  v_available DOUBLE PRECISION;
  v_notes TEXT;
  v_shortfall TEXT := '';
  recipe RECORD;
  inv RECORD;
  v_allow_neg BOOLEAN := FALSE;
  v_setting TEXT;
BEGIN
  -- لا خصم مزدوج: نفس الطلب سبق خصمه بحركة sale
  PERFORM 1 FROM public.stock_movements
    WHERE order_id = p_order_id AND type = 'sale' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'shortfall', '');
  END IF;

  IF to_regclass('public.settings') IS NOT NULL THEN
    SELECT value INTO v_setting FROM public.settings WHERE key = 'allowNegativeStock' LIMIT 1;
    v_allow_neg := (lower(coalesce(v_setting, '')) IN ('true', '1', 'yes'));
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(items_json, '[]'::jsonb)) LOOP
    v_product_id := NULLIF((item->>'productId')::TEXT, '')::BIGINT;
    v_product_id := COALESCE(v_product_id, NULLIF((item->>'product_id')::TEXT, '')::BIGINT);
    v_wanted := COALESCE(NULLIF((item->>'quantity')::DOUBLE PRECISION, 0), 1);
    v_applied_recipe := FALSE;

    -- الوصفة أولاً (نفس منطق العميل/السيرفر)
    IF v_product_id IS NOT NULL AND to_regclass('public.product_recipes') IS NOT NULL THEN
      FOR recipe IN
        SELECT ingredient, quantity FROM public.product_recipes WHERE product_id = v_product_id
      LOOP
        v_ingredient := NULLIF(btrim(coalesce(recipe.ingredient::text, '')), '');
        if v_ingredient IS NULL OR v_ingredient = '' THEN CONTINUE; END IF;
        v_ing_qty := COALESCE(NULLIF(recipe.quantity::double precision, 0), 1) * v_wanted;
        v_applied_recipe := TRUE;
        v_notes := NULL;
        -- خصم من inventory بالاسم
        IF to_regclass('public.inventory') IS NOT NULL THEN
          SELECT id, quantity INTO inv FROM public.inventory WHERE name = v_ingredient ORDER BY id LIMIT 1;
          IF FOUND THEN
            v_available := COALESCE(inv.quantity::double precision, 0);
            IF (NOT v_allow_neg) AND v_available < v_ing_qty THEN
              v_shortfall := v_shortfall || v_ingredient || ' (المتاح ' || v_available || ' — المطلوب ' || v_ing_qty || ')، ';
              CONTINUE;
            END IF;
            UPDATE public.inventory SET quantity = v_available - v_ing_qty,
              last_updated = NOW()
              WHERE id = inv.id;
            v_notes := 'طلب #' || p_order_id || ' :: ' || v_ingredient;
          ELSE
            v_notes := 'طلب #' || p_order_id || ' :: ' || v_ingredient || ' (بدون صنف مخزون مقابل)';
          END IF;
        END IF;
        INSERT INTO public.stock_movements (product_id, order_id, quantity, type, notes)
          VALUES (v_product_id, p_order_id, -v_ing_qty, 'sale', v_notes);
      END LOOP;
    END IF;

    -- بدون وصفة → الاسم 1:1
    IF NOT v_applied_recipe THEN
      v_name := NULLIF(btrim(coalesce(item->>'name', '')), '');
      IF v_name IS NULL OR v_name = '' THEN CONTINUE; END IF;
      v_notes := NULL;
      IF to_regclass('public.inventory') IS NOT NULL THEN
        SELECT id, quantity INTO inv FROM public.inventory WHERE name = v_name ORDER BY id LIMIT 1;
        IF FOUND THEN
          v_available := COALESCE(inv.quantity::double precision, 0);
          IF (NOT v_allow_neg) AND v_available < v_wanted THEN
            v_shortfall := v_shortfall || v_name || ' (المتاح ' || v_available || ' — المطلوب ' || v_wanted || ')، ';
            CONTINUE;
          END IF;
          UPDATE public.inventory SET quantity = v_available - v_wanted,
            last_updated = NOW(), updated_at = COALESCE(updated_at, NOW())
            WHERE id = inv.id;
          v_notes := 'طلب #' || p_order_id || ' :: ' || v_name;
        ELSE
          v_notes := 'طلب #' || p_order_id || ' :: ' || v_name || ' (بدون صنف مخزون مقابل)';
        END IF;
      END IF;
      INSERT INTO public.stock_movements (product_id, order_id, quantity, type, notes)
        VALUES (v_product_id, p_order_id, -v_wanted, 'sale', v_notes);
    END IF;
  END LOOP;

  IF v_shortfall <> '' THEN
    RETURN jsonb_build_object('ok', false, 'shortfall', v_shortfall);
  END IF;
  RETURN jsonb_build_object('ok', true, 'shortfall', '');
END;
$$;

-- إعادة المخزون بعد الإلغاء (مرة واحدة فقط: كل حركة sale تعكس بحركة return)
CREATE OR REPLACE FUNCTION public._lucca_restore_stock(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  v_name TEXT;
  v_amount DOUBLE PRECISION;
  inv RECORD;
  v_count INTEGER;
BEGIN
  IF to_regclass('public.stock_movements') IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.stock_movements
    WHERE order_id = p_order_id AND type = 'sale' LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*) INTO v_count FROM public.stock_movements
    WHERE order_id = p_order_id AND type = 'return';
  IF v_count > 0 THEN RETURN; END IF;

  FOR m IN
    SELECT id, product_id, quantity, notes FROM public.stock_movements
    WHERE order_id = p_order_id AND type = 'sale'
  LOOP
    v_name := NULL;
    IF m.notes IS NOT NULL THEN
      v_name := NULLIF(btrim(split_part(m.notes::text, ' :: ', 2)), '');
    END IF;
    v_amount := abs(coalesce(m.quantity::double precision, 0));
    IF v_amount = 0 THEN CONTINUE; END IF;
    IF v_name IS NOT NULL AND to_regclass('public.inventory') IS NOT NULL THEN
      SELECT id, quantity INTO inv FROM public.inventory WHERE name = v_name ORDER BY id LIMIT 1;
      IF FOUND THEN
        UPDATE public.inventory SET quantity = COALESCE(inv.quantity::double precision, 0) + v_amount,
          last_updated = NOW()
          WHERE id = inv.id;
      END IF;
    END IF;
    INSERT INTO public.stock_movements (product_id, order_id, quantity, type, notes)
      VALUES (coalesce(m.product_id, NULL), p_order_id, v_amount, 'return',
              'استرداد مخزون طلب #' || p_order_id || coalesce(' :: ' || v_name, ''));
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) checkout_order — التحصيل الذري الوحيد (يطابق /api/orders/:id/checkout)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout_order(
  p_order_id BIGINT,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_sync_id TEXT DEFAULT NULL,
  p_order_sync_id TEXT DEFAULT NULL,
  p_change_amount DOUBLE PRECISION DEFAULT 0,
  p_payments JSONB DEFAULT NULL,   -- [{method, amount, paymentSyncId}]
  p_created_by TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_totals JSONB;
  v_total DOUBLE PRECISION;
  v_subtotal DOUBLE PRECISION;
  v_discount_amount DOUBLE PRECISION;
  v_parts JSONB := '[]'::jsonb;
  v_part JSONB;
  v_method TEXT;
  v_collected DOUBLE PRECISION := 0;
  v_one_method TEXT;
  v_sync_id TEXT;
  v_order_sync TEXT;
  v_today TEXT;
  v_order_number TEXT;
  v_table_id TEXT;
  v_created_by TEXT;
  v_result JSONB;
  v_dup_count INTEGER;
  v_dup BIGINT;
  v_short JSONB;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found', 'status', 404);
  END IF;

  -- إجبار الإجماليات من الأصناف (مصدر الحقيقة = السيرفر)
  v_totals := public._lucca_compute_totals(
    COALESCE(v_order.items::jsonb, '[]'::jsonb),
    COALESCE(v_order.discount, 0),
    COALESCE(v_order.discount_type, 'percent'),
    COALESCE(v_order.tax, 0)
  );
  v_total := (v_totals->>'total')::double precision;
  v_subtotal := (v_totals->>'subtotal')::double precision;
  v_discount_amount := (v_totals->>'discount_amount')::double precision;
  v_created_by := NULLIF(btrim(p_created_by), '');
  v_created_by := COALESCE(v_created_by, NULLIF(btrim(coalesce(v_order.created_by, '')), ''), 'unknown');
  v_order_sync := NULLIF(btrim(coalesce(p_order_sync_id, v_order.sync_id, '')), '');
  v_table_id := NULLIF(btrim(coalesce(v_order.table_id, '')), '');

  -- --- توليد أجزاء الدفع (المقسم أو الموحد) ---------------------------------
  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    v_parts := p_payments;
    v_one_method := NULL;
    IF jsonb_array_length(v_parts) = 1 THEN
      v_one_method := coalesce(v_parts->0->>'method', v_parts->0->>'paymentMethod', 'cash');
    END IF;
    SELECT sum(coalesce((x->>'amount')::double precision, 0)) INTO v_collected
      FROM jsonb_array_elements(v_parts) AS x;
    v_collected := coalesce(v_collected, 0);
  ELSE
    v_one_method := coalesce(NULLIF(btrim(coalesce(p_payment_method, '')), ''), 'cash');
    v_parts := jsonb_build_array(jsonb_build_object(
      'method', v_one_method,
      'amount', v_total,
      'paymentSyncId', coalesce(NULLIF(btrim(coalesce(p_payment_sync_id,'')), ''), 'x' || md5(random()::text || clock_timestamp()::text))
    ));
    v_collected := v_total;
  END IF;

  -- --- Idempotency: نفس الدفعة/الأجزاء سجِّلت سابقاً؟ -----------------------
  -- (تُفحص قبل "الطلب مغلق" لأن إعادة المحاولة قد تصادف طلباً أغلقته المحاولة الأولى)
  IF jsonb_array_length(v_parts) > 0 THEN
    FOR v_part IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
      v_sync_id := NULLIF(btrim(coalesce(v_part->>'paymentSyncId', '')), '');
      IF v_sync_id IS NULL OR v_sync_id = '' THEN CONTINUE; END IF;
      SELECT id INTO v_dup FROM public.payments WHERE sync_id = v_sync_id LIMIT 1;
      IF FOUND THEN
        SELECT COUNT(*) INTO v_dup_count FROM public.payments
          WHERE sync_id = v_sync_id
            AND (order_id = p_order_id OR (v_order_sync IS NOT NULL AND order_sync_id = v_order_sync));
        IF v_dup_count > 0 THEN
          RETURN jsonb_build_object(
            'success', true, 'already_processed', true,
            'order', (SELECT to_jsonb(o) FROM public.orders o WHERE o.id = p_order_id)
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- --- فحوصات الحالة --------------------------------------------------------
  IF v_order.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is already closed', 'status', 409);
  END IF;
  IF v_order.status IN ('cancelled', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order is already ' || v_order.status, 'status', 409);
  END IF;

  -- قيمة كل دفعة موجبة + مجموع الدفعات يطابق الإجمالي (سياسة /checkout)
  FOR v_part IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
    IF NOT (coalesce((v_part->>'amount')::double precision, 0) > 0) THEN
      RETURN jsonb_build_object('success', false, 'error', 'قيمة كل دفعة يجب أن تكون أكبر من صفر', 'status', 400);
    END IF;
  END LOOP;
  IF round(v_collected::numeric, 2) <> round(v_total::numeric, 2) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'مبلغ الدفعات (' || round(v_collected, 2) || ') لا يطابق إجمالي الطلب (' || round(v_total, 2) || ') — لم يُغلق الطلب',
      'status', 409
    );
  END IF;

  -- --- رقم الطلب (إن ناقص / إن تكرر اليوم) ----------------------------------
  v_today := to_char(now(), 'YYYYMMDD');
  v_order_number := coalesce(NULLIF(btrim(coalesce(v_order.order_number, '')), ''), '');
  IF v_order_number = '' THEN
    v_order_number := 'ORD-' || v_today || '-' || lpad((floor(random() * 900 + 100))::text, 3, '0');
  ELSE
    PERFORM 1 FROM public.orders WHERE order_number = v_order_number AND id <> p_order_id LIMIT 1;
    IF FOUND THEN
      v_order_number := 'ORD-' || v_today || '-' || lpad((floor(random() * 900 + 100))::text, 3, '0');
    END IF;
  END IF;

  -- --- التنفيذ الذري ----------------------------------------------------------
  -- إغلاق الطلب بالحساب الصحيح من السيرفر
  UPDATE public.orders SET
    status = 'closed',
    payment_method = coalesce(v_one_method,
      CASE WHEN jsonb_array_length(v_parts) = 1 THEN v_parts->0->>'method' ELSE 'split' END),
    payment_status = 'paid',
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax = coalesce(v_order.tax, 0),
    total = v_total,
    total_paid = v_total,
    change_amount = coalesce(p_change_amount, 0),
    order_number = v_order_number,
    sync_id = coalesce(v_order_sync, sync_id),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- تحرير الطاولة (تطابق /checkout)
  IF v_table_id IS NOT NULL AND v_table_id <> 'takeaway'
     AND v_table_id ~ '^[0-9]+$' THEN
    IF to_regclass('public.tables_store') IS NOT NULL THEN
      UPDATE public.tables_store SET status = 'available',
        current_order = NULL
        WHERE id = v_table_id::bigint;
    ELSIF to_regclass('public.tables') IS NOT NULL THEN
      UPDATE public.tables SET status = 'available',
        current_order = NULL
        WHERE id = v_table_id::bigint;
    END IF;
  END IF;

  -- صفوف الدفع (كل جزء بسطر معلق بـ sync_id / order_sync_id)
  FOR v_part IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
    v_sync_id := NULLIF(btrim(coalesce(v_part->>'paymentSyncId', '')), '');
    IF v_sync_id IS NULL OR v_sync_id = '' THEN
      v_sync_id := 'x' || md5(random()::text || clock_timestamp()::text);
    END IF;
    INSERT INTO public.payments
      (order_id, amount, method, status, created_by, sync_id, order_sync_id)
    VALUES
      (p_order_id,
       coalesce((v_part->>'amount')::double precision, 0),
       coalesce(NULLIF(btrim(coalesce(v_part->>'method', '')), ''), 'cash'),
       'completed', v_created_by, v_sync_id, v_order_sync);
  END LOOP;

  -- صفـوف الأصناف (order_items) — نفس محتوى سجل/طلب
  IF to_regclass('public.order_items') IS NOT NULL THEN
    FOR v_part IN SELECT * FROM jsonb_array_elements(coalesce(v_order.items::jsonb, '[]'::jsonb)) LOOP
      INSERT INTO public.order_items
        (order_id, product_id, name, quantity, unit_price, cost, discount, discount_type, tax, modifiers, notes, status)
      VALUES
        (p_order_id,
         coalesce(NULLIF(v_part->>'productId', '')::bigint, NULLIF(v_part->>'product_id', '')::bigint),
         coalesce(v_part->>'name', ''),
         coalesce(NULLIF((v_part->>'quantity')::double precision, 0), 1),
         coalesce(NULLIF(v_part->>'unitPrice', ''), v_part->>'price', '0')::double precision,
         0, 0, 'percent', 0, '[]', coalesce(v_part->>'notes', ''), 'served');
    END LOOP;
  END IF;

  -- خصم المخزون داخل المعاملة
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    v_short := public._lucca_deduct_stock(p_order_id, coalesce(v_order.items::jsonb, '[]'::jsonb));
    IF NOT (v_short->>'ok')::boolean THEN
      RAISE EXCEPTION 'LUCCA_STOCK_SHORTFALL %', (v_short->>'shortfall');
    END IF;
  END IF;

  -- سجل الحالة (order_status_history)
  IF to_regclass('public.order_status_history') IS NOT NULL THEN
    INSERT INTO public.order_status_history (order_id, status, changed_by, created_at)
      VALUES (p_order_id, 'closed', v_created_by, NOW());
  END IF;

  -- تدقيق التحصيل
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_name, action, object_type, object_id, new_value, created_at)
      VALUES (v_created_by, 'checkout', 'orders', p_order_id,
              jsonb_build_object('total', v_total, 'method', coalesce(v_one_method, 'split'),
                                 'parts', v_parts, 'actor', v_created_by)::text,
              NOW());
  END IF;

  SELECT to_jsonb(o) INTO v_result FROM public.orders o WHERE o.id = p_order_id;
  RETURN jsonb_build_object('success', true, 'already_processed', false, 'order', v_result);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'LUCCA_STOCK_SHORTFALL%' THEN
      RETURN jsonb_build_object('success', false, 'status', 409, 'error',
        'مخزون غير كافٍ لإتمام البيع: ' || replace(SQLERRM, 'LUCCA_STOCK_SHORTFALL ', ''));
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_order(BIGINT, TEXT, TEXT, TEXT, DOUBLE PRECISION, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.checkout_order(BIGINT, TEXT, TEXT, TEXT, DOUBLE PRECISION, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) void_order — إلغاء/استرداد ذري (يطابق /api/orders/:id/void)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_order(
  p_order_id BIGINT,
  p_reason TEXT DEFAULT '',
  p_note TEXT DEFAULT '',
  p_refund_method TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_net_paid DOUBLE PRECISION;
  v_already_refunded DOUBLE PRECISION := 0;
  v_refundable DOUBLE PRECISION;
  v_void_amount DOUBLE PRECISION;
  v_refundable_method TEXT;
  v_payment_method TEXT;
  v_created_by TEXT;
  v_sync_id TEXT;
  v_table_id TEXT;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found', 'status', 404);
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'السبب إلزامي لا يمكن تركه فارغاً', 'status', 400);
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order already voided', 'status', 409);
  END IF;

  -- void مسموح فقط لطلب مدفوع فعلاً (تطابق P2-A3)
  v_payment_method := coalesce(NULLIF(btrim(coalesce(v_order.payment_method, '')), ''), 'cash');
  v_net_paid := CASE WHEN coalesce(v_order.total_paid, 0) > 0
                       THEN v_order.total_paid
                       WHEN coalesce(v_order.total, 0) > 0 THEN v_order.total
                       ELSE 0 END;
  IF NOT (v_order.payment_status = 'paid') OR NOT (v_net_paid > 0) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'الطلب غير مدفوع — لا يمكن إلغاؤه/استرداده. أكمِل الدفع عبر /checkout أو احذف الطلب المفتوح',
      'status', 409);
  END IF;

  -- سقف الاسترداد = الصافي المدفوع − مجموع الاستردادات السابقة (يمنع المسترد > المدفوع)
  SELECT COALESCE(sum(amount), 0) INTO v_already_refunded FROM public.refunds WHERE order_id = p_order_id;
  v_already_refunded := coalesce(v_already_refunded, 0);
  v_refundable := v_net_paid - v_already_refunded;
  IF NOT (v_refundable > 0.01) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'لا مبلغ متبقٍ لاسترداده — الطلب مُستردّ بكامله سابقاً', 'status', 409);
  END IF;
  v_void_amount := v_refundable;
  v_refundable_method := coalesce(NULLIF(btrim(coalesce(p_refund_method, '')), ''),
                                  v_payment_method);
  v_created_by := NULLIF(btrim(p_created_by), '');
  v_created_by := COALESCE(v_created_by, NULLIF(btrim(coalesce(v_order.created_by, '')), ''), 'unknown');
  v_sync_id := 'void-' || p_order_id || '-' || md5(random()::text || clock_timestamp()::text);
  v_table_id := NULLIF(btrim(coalesce(v_order.table_id, '')), '');

  -- 1) صف الاسترداد (بيانات كاملة: السبب/الملاحظة/طريقة الرد/الفاعل)
  INSERT INTO public.refunds
    (order_id, amount, reason, note, refund_method, created_by, voided_by, sync_id, created_at, updated_at)
  VALUES
    (p_order_id, v_void_amount, btrim(p_reason), coalesce(btrim(coalesce(p_note,'')), ''),
     v_refundable_method, coalesce(v_order.created_by, 'unknown'), v_created_by, v_sync_id, NOW(), NOW());

  -- 2) إلغاء الطلب مع بيانات الـ void
  UPDATE public.orders SET
    status = 'cancelled',
    payment_status = 'refunded',
    void_reason = btrim(p_reason),
    void_note = coalesce(btrim(coalesce(p_note,'')), ''),
    voided_at = NOW(),
    voided_by = v_created_by,
    refund_amount = v_void_amount,
    refunded_at = NOW(),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- 3) تحرير الطاولة
  IF v_table_id IS NOT NULL AND v_table_id <> 'takeaway'
     AND v_table_id ~ '^[0-9]+$' THEN
    IF to_regclass('public.tables_store') IS NOT NULL THEN
      UPDATE public.tables_store SET status = 'available',
        current_order = NULL
        WHERE id = v_table_id::bigint;
    ELSIF to_regclass('public.tables') IS NOT NULL THEN
      UPDATE public.tables SET status = 'available',
        current_order = NULL
        WHERE id = v_table_id::bigint;
    END IF;
  END IF;

  -- 4) سجل الحالة
  IF to_regclass('public.order_status_history') IS NOT NULL THEN
    INSERT INTO public.order_status_history (order_id, status, changed_by, notes, created_at)
      VALUES (p_order_id, 'cancelled', v_created_by,
              'reason: ' || btrim(p_reason) || ', note: ' || coalesce(btrim(coalesce(p_note,'')), ''), NOW());
  END IF;

  -- 5) إعادة المخزون الذي خصمه التحصيل (مرة واحدة فقط — داخل نفس المعاملة)
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    PERFORM public._lucca_restore_stock(p_order_id);
  END IF;

  -- 6) تدقيق الإلغاء
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_name, action, object_type, object_id, new_value, created_at)
      VALUES (v_created_by, 'void', 'orders', p_order_id,
              jsonb_build_object('refund', v_void_amount, 'reason', btrim(p_reason),
                                 'method', v_refundable_method, 'actor', v_created_by)::text,
              NOW());
  END IF;

  SELECT to_jsonb(o) INTO v_result FROM public.orders o WHERE o.id = p_order_id;
  RETURN jsonb_build_object('success', true, 'already_processed', false, 'order', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_order(BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.void_order(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) أذونات القراءة/الكتابة على الجداول المستخدمة (في حال توجد RLS صارمة)
-- ---------------------------------------------------------------------------
-- الدوال SECURITY DEFINER تنفذ بصلاحيات المالك (postgres) فلا تحتاج أكثر من
-- GRANT EXECUTE أعلاه. لو كان RLS مفعّل FORCE على بعض الجداول، ثبّت هذا:
--   ALTER TABLE public.inventory FORCE ROW LEVEL SECURITY;

-- تم بنجاح
DO $$ BEGIN
  RAISE NOTICE 'LUCCA RPC v1 applied: checkout_order + void_order ready';
END $$;