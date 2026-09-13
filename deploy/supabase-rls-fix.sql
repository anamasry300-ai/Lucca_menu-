-- ============================================================================
-- LUCCA POS — إصلاح Supabase RLS (2026-09-13)
-- يعالج: سياسات "USING (true)" على كل الجداول جعلت الـ anon key (عمومي) قادراً
--        على قراءة/كتابة كل شيء — بما فيها users و password.
--
-- !! مهم جداً قبل التشغيل !!
-- التطبيق يعمل بتسجيل دخول داخلي (username/password) وليس Supabase Auth،
-- لذا كل عملائه على شبكة anon. إغلاق RLS حقيقةً (سطر 3 أ) سيكسر الاتصال المباشر
-- من المتصفح للمخازن الحساسة (orders/users/payments...) حتى تُهاجر للتطبيق إلى
-- Supabase Auth أو وسيط backend يحمل service_role.
-- نفّذ على ثلاث مراحل مرسومة أدناه بالترتيب والتوقعات.
-- ============================================================================

-- 0) أزل السيل في السياست السابقة (معرف فريد بالاسم المولّد في seed)
DROP POLICY IF EXISTS "Allow all for authenticated" ON users;
DROP POLICY IF EXISTS "Allow all for authenticated" ON tables_store;
DROP POLICY IF EXISTS "Allow all for authenticated" ON categories;
DROP POLICY IF EXISTS "Allow all for authenticated" ON products;
DROP POLICY IF EXISTS "Allow all for authenticated" ON orders;
DROP POLICY IF EXISTS "Allow all for authenticated" ON order_items;
DROP POLICY IF EXISTS "Allow all for authenticated" ON payments;
DROP POLICY IF EXISTS "Allow all for authenticated" ON refunds;
DROP POLICY IF EXISTS "Allow all for authenticated" ON audit_logs;
DROP POLICY IF EXISTS "Allow all for authenticated" ON expenses;
DROP POLICY IF EXISTS "Allow all for authenticated" ON employees;
DROP POLICY IF EXISTS "Allow all for authenticated" ON attendance;
DROP POLICY IF EXISTS "Allow all for authenticated" ON shifts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON daily_shifts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON inventory;
DROP POLICY IF EXISTS "Allow all for authenticated" ON purchases;
DROP POLICY IF EXISTS "Allow all for authenticated" ON customers;
DROP POLICY IF EXISTS "Allow all for authenticated" ON settings;
DROP POLICY IF EXISTS "Allow all for authenticated" ON discounts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON bot_memory;
DROP POLICY IF EXISTS "Allow all for authenticated" ON order_status_history;
DROP POLICY IF EXISTS "Allow all for authenticated" ON payment_methods;
DROP POLICY IF EXISTS "Allow all for authenticated" ON taxes;
DROP POLICY IF EXISTS "Allow all for authenticated" ON product_modifiers;
DROP POLICY IF EXISTS "Allow all for authenticated" ON product_variations;

-- 1) إغلاق أي مقروء/مكتوب افتراضي للأدوار عبر RLS (قاعدة: بلا سياسة = لا وصول)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variations ENABLE ROW LEVEL SECURITY;

-- 2) (اختياري لكن موصى) FORCE: حتى مالك الجدول يخضع لـ RLS - لا تجعلهم يعتمدوا على
--    صلاحيات SQL التقليدية للالتفاف.
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE tables_store FORCE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE daily_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
ALTER TABLE discounts FORCE ROW LEVEL SECURITY;
ALTER TABLE bot_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE order_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE taxes FORCE ROW LEVEL SECURITY;
ALTER TABLE product_modifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE product_variations FORCE ROW LEVEL SECURITY;

-- 3 أ) بيانات عامة (القائمة/الأصناف) — مسموح للـ anon قراءة فقط (الويب/المتاجر).
CREATE POLICY "public_read_categories" ON categories FOR SELECT TO anon USING (true);
CREATE POLICY "public_read_products" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "public_read_product_modifiers" ON product_modifiers FOR SELECT TO anon USING (true);
CREATE POLICY "public_read_product_variations" ON product_variations FOR SELECT TO anon USING (true);
CREATE POLICY "public_read_payment_methods" ON payment_methods FOR SELECT TO anon USING (true);
CREATE POLICY "public_read_taxes" ON taxes FOR SELECT TO anon USING (true);

-- 3 ب) كل الجداول الحساسة (orders/users/payments/...) — لا سياسة anon إطلاقاً.
--     أي طلب anon يعيد 0 صف / يُرفض الكتابة. هذه هي الحالة المطلوبة.
--     ملاحظة: التطبيق سيفقد الاتصال المباشر لهذه الجداول من المتصفح فوراً حتى
--     تُهاجر للمصادقة الشبكة (سطر 3 ج).

-- 3 ج) النمط الصحيح بعد هجرة Supabase Auth (مثال لـ users — مستقبلي):
-- عندما يملك المستخدم وب صفة auth.uid، اربط الدور من جدول (users.uid أو profiles):
-- CREATE POLICY "users_self" ON users FOR SELECT TO authenticated
--   USING (auth.uid() = (SELECT uid FROM users WHERE id = id));
-- CREATE POLICY "orders_role_admin" ON orders FOR ALL TO authenticated
--   USING (EXISTS (SELECT 1 FROM users u WHERE u.uid = auth.uid() AND u.role IN ('admin','manager')))
--   WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.uid = auth.uid() AND u.role IN ('admin','manager')));
-- كرر النمط لكل مخزن حساس بصلاحيات دور مساوية لـ ROLE_PERMISSIONS في backend/src/auth.ts.

-- ============================================================================
-- التحقق (لوحة Supabase > SQL):
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE tablename IN ('orders','users','products')
--   ORDER BY tablename;
-- يجب أن ترى: products باسم السياسة public_read... و الأوامر FOR SELECT فقط،
-- و لا "Allow all for authenticated" إطلاقاً.
-- ============================================================================