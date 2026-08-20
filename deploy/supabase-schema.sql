-- =====================================================
-- LUCCA CAFFE POS — Supabase PostgreSQL Schema
-- =====================================================
-- Execute this in Supabase SQL Editor (Dashboard > SQL)
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== USERS ====================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'cashier',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== TABLES ====================
CREATE TABLE IF NOT EXISTS tables_store (
  id BIGINT PRIMARY KEY,
  number INTEGER,
  status TEXT DEFAULT 'available' CHECK(status IN ('available','occupied','reserved','cleaning','closed')),
  capacity INTEGER DEFAULT 4,
  current_order BIGINT,
  zone TEXT DEFAULT 'صالة'
);

-- ==================== CATEGORIES ====================
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== PRODUCTS ====================
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  category_id BIGINT REFERENCES categories(id),
  price REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  image TEXT DEFAULT '',
  description TEXT DEFAULT '',
  components TEXT DEFAULT '[]',
  badge TEXT DEFAULT '',
  available INTEGER DEFAULT 1,
  product_type TEXT DEFAULT 'standard' CHECK(product_type IN ('standard','modifier','combo')),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== PRODUCT MODIFIERS ====================
CREATE TABLE IF NOT EXISTS product_modifiers (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- ==================== PRODUCT VARIATIONS ====================
CREATE TABLE IF NOT EXISTS product_variations (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  sku TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- ==================== PAYMENT METHODS ====================
CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  type TEXT DEFAULT 'cash' CHECK(type IN ('cash','card','wallet','bank','other')),
  icon TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== TAXES ====================
CREATE TABLE IF NOT EXISTS taxes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  applies_to TEXT DEFAULT 'all' CHECK(applies_to IN ('all','products','orders')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ORDERS ====================
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT DEFAULT '',
  table_id TEXT,
  order_type TEXT DEFAULT 'dine_in' CHECK(order_type IN ('dine_in','takeaway','delivery','pickup')),
  items TEXT DEFAULT '[]',
  customer_name TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'cash',
  payment_method_id BIGINT DEFAULT NULL,
  customer_notes TEXT DEFAULT '',
  invoice_delivery TEXT DEFAULT 'cashier',
  marketing_opt_in INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_preparation','ready','served','completed','cancelled','closed')),
  payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','partial','paid','refunded')),
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  discount_type TEXT DEFAULT 'percent' CHECK(discount_type IN ('percent','fixed')),
  discount_by TEXT DEFAULT '',
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  change_amount REAL DEFAULT 0,
  date TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ORDER ITEMS ====================
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  discount_type TEXT DEFAULT 'percent',
  tax REAL DEFAULT 0,
  modifiers TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_preparation','ready','served','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ORDER STATUS HISTORY ====================
CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== PAYMENTS ====================
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  invoice_id BIGINT,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'cash',
  payment_method_id BIGINT DEFAULT NULL,
  reference TEXT DEFAULT '',
  status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','refunded','void')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== REFUNDS ====================
CREATE TABLE IF NOT EXISTS refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id BIGINT,
  amount REAL NOT NULL,
  reason TEXT DEFAULT '',
  type TEXT DEFAULT 'full' CHECK(type IN ('full','partial','item')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== AUDIT LOGS ====================
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT DEFAULT NULL,
  user_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  object_type TEXT DEFAULT '',
  object_id BIGINT DEFAULT NULL,
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== DISCOUNTS ====================
CREATE TABLE IF NOT EXISTS discounts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'percent' CHECK(type IN ('percent','fixed')),
  value REAL DEFAULT 0,
  min_order_amount REAL DEFAULT 0,
  max_uses INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== CUSTOMERS ====================
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT,
  name TEXT DEFAULT '',
  visits INTEGER DEFAULT 1,
  last_visit TIMESTAMPTZ,
  total_spent REAL DEFAULT 0,
  marketing_opt_in INTEGER DEFAULT 0,
  preferred_channel TEXT DEFAULT 'cashier',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== SETTINGS ====================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ==================== INVENTORY ====================
CREATE TABLE IF NOT EXISTS inventory (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT 'قطعة',
  min_stock REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== PURCHASES ====================
CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  name TEXT DEFAULT '',
  item TEXT DEFAULT '',
  quantity REAL DEFAULT 1,
  cost_price REAL DEFAULT 0,
  total REAL DEFAULT 0,
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'admin'
);

-- ==================== EMPLOYEES ====================
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  phone TEXT DEFAULT '',
  role TEXT DEFAULT 'موظف',
  salary REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== ATTENDANCE ====================
CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT REFERENCES employees(id),
  date TEXT,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  late_minutes INTEGER DEFAULT 0,
  bonus REAL DEFAULT 0,
  deduction REAL DEFAULT 0,
  hours_worked REAL,
  notes TEXT DEFAULT ''
);

-- ==================== EXPENSES ====================
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'أخرى',
  amount REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'admin'
);

-- ==================== SHIFTS ====================
CREATE TABLE IF NOT EXISTS shifts (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT DEFAULT 0,
  date TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  hours_worked REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  notes TEXT DEFAULT ''
);

-- ==================== DAILY SHIFTS ====================
CREATE TABLE IF NOT EXISTS daily_shifts (
  date TEXT PRIMARY KEY,
  opening_balance REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  actual_cash REAL,
  expected_cash REAL,
  difference REAL,
  cash_sales REAL,
  card_sales REAL,
  total_sales REAL,
  total_expenses REAL,
  order_count INTEGER DEFAULT 0,
  notes TEXT DEFAULT ''
);

-- ==================== BOT MEMORY ====================
CREATE TABLE IF NOT EXISTS bot_memory (
  id BIGSERIAL PRIMARY KEY,
  type TEXT DEFAULT 'learned',
  question TEXT DEFAULT '',
  answer TEXT DEFAULT '',
  keywords TEXT DEFAULT '',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id ON shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);

-- ==================== SEED DEFAULT DATA ====================
-- Default admin user
INSERT INTO users (username, password, name, role) 
VALUES ('admin', '123456', 'مدير النظام', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Default tables (14 tables)
INSERT INTO tables_store (id, number, status, capacity, zone)
VALUES 
  (1, 1, 'available', 4, 'صالة'),
  (2, 2, 'available', 4, 'صالة'),
  (3, 3, 'available', 4, 'صالة'),
  (4, 4, 'available', 4, 'صالة'),
  (5, 5, 'available', 4, 'صالة'),
  (6, 6, 'available', 4, 'صالة'),
  (7, 7, 'available', 4, 'صالة'),
  (8, 8, 'available', 6, 'VIP'),
  (9, 9, 'available', 6, 'VIP'),
  (10, 10, 'available', 6, 'VIP'),
  (11, 11, 'available', 6, 'VIP'),
  (12, 12, 'available', 4, 'خارجي'),
  (13, 13, 'available', 4, 'خارجي'),
  (14, 14, 'available', 6, 'أرجيلة')
ON CONFLICT (id) DO NOTHING;

-- Default payment methods
INSERT INTO payment_methods (name, name_ar, name_en, type, active)
VALUES 
  ('Cash', 'كاش', 'Cash', 'cash', 1),
  ('Card', 'فيزا/ماستركارد', 'Card', 'card', 1),
  ('Transfer', 'تحويل بنكي', 'Transfer', 'bank', 1),
  ('WhatsApp', 'واتساب', 'WhatsApp', 'wallet', 1)
ON CONFLICT DO NOTHING;

-- ==================== ROW LEVEL SECURITY ====================
-- Enable RLS on all tables
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

-- Allow all operations for authenticated and anon users (POS app)
-- You can tighten this later with proper auth policies
CREATE POLICY "Allow all for authenticated" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON tables_store FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON refunds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON daily_shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON purchases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON discounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON bot_memory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON order_status_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON payment_methods FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON taxes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON product_modifiers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON product_variations FOR ALL USING (true) WITH CHECK (true);
