-- Public Menu (لوحة المنيو العام للعملاء) — جداول مستقلة تماماً عن المحاسبة والكاشير.
-- لا تعدّل أي جدول موجود. مجرد منيو عام للعرض فقط.
CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  description TEXT DEFAULT '',
  price REAL DEFAULT 0,
  image_path TEXT DEFAULT '',
  thumb_path TEXT DEFAULT '',
  is_available INTEGER DEFAULT 1,
  is_featured INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available);
CREATE INDEX IF NOT EXISTS idx_menu_items_deleted ON menu_items(is_deleted);
CREATE INDEX IF NOT EXISTS idx_menu_cats_visible ON menu_categories(is_visible);
