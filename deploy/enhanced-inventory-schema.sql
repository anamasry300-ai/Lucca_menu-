-- =====================================================
-- ENHANCED INVENTORY SYSTEM
-- Execute in Supabase SQL Editor
-- =====================================================

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enhanced inventory (ingredients/raw materials)
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  unit TEXT DEFAULT 'قطعة',
  quantity REAL DEFAULT 0,
  min_quantity REAL DEFAULT 5,
  max_quantity REAL DEFAULT 999,
  cost_per_unit REAL DEFAULT 0,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  location TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  last_counted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product recipes (links products to ingredients)
CREATE TABLE IF NOT EXISTS product_recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id BIGINT NOT NULL,
  ingredient_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_needed REAL DEFAULT 1,
  unit TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock movements (audit trail)
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('purchase','sale','adjustment','waste','transfer','count','recipe_deduct')),
  quantity REAL NOT NULL,
  reference_id TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  performed_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Waste tracking
CREATE TABLE IF NOT EXISTS waste_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  reason TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  performed_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(name);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON product_recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipes_ingredient ON product_recipes(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient ON stock_movements(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_waste_log_ingredient ON waste_log(ingredient_id);

-- RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON inventory_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON product_recipes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON stock_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON waste_log FOR ALL USING (true) WITH CHECK (true);
