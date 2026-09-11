-- ============================================================
--  Lucca Caffè POS — Local SQLite Schema (canonical)
--  ============================================================
--  يُمثِّل هذا الملف الحالة النهائية لقاعدة البيانات المحلية
--  (sql.js / SQLite) كما تُنشئها دالة migrate() في src/db.ts
--  عند بدء التشغيل. لا تحتاج لتشغيله يدوياً عادةً — السيرفر
--  ينشئ كل شيء تلقائياً، لكنه مرجع واضح للبنية ولعمل نسخة
--  احتياطية/استعادة أو إعداد يدوي لقاعدة جديدة.
--  المتطلبات: Products/Menu + Orders + Order Items + Shifts
--  ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
--  المستخدمون والمصادقة
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password TEXT NOT NULL,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'cashier',
  active INTEGER DEFAULT 1,
  employeeId INTEGER,
  mustChangePassword INTEGER DEFAULT 0,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email) WHERE email IS NOT NULL AND email <> '';

-- ------------------------------------------------------------
--  الموظفون / الدعوات / الحضور / الشيفتات / الورديات اليومية
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT DEFAULT '',
  role TEXT DEFAULT 'موظف',
  salary REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  email TEXT,
  userId INTEGER,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  token TEXT,
  email TEXT,
  employeeId INTEGER,
  role TEXT DEFAULT 'cashier',
  name TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','used','revoked','expired')),
  expiresAt TEXT,
  createdBy INTEGER,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER,
  date TEXT,
  checkIn TEXT,
  checkOut TEXT,
  lateMinutes INTEGER DEFAULT 0,
  bonus REAL DEFAULT 0,
  deduction REAL DEFAULT 0,
  hoursWorked REAL,
  notes TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employeeId) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER DEFAULT 0,
  date TEXT,
  startTime TEXT,
  endTime TEXT,
  hoursWorked REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  notes TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_shifts (
  date TEXT PRIMARY KEY,
  openingBalance REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  openedAt TEXT DEFAULT (datetime('now')),
  closedAt TEXT,
  actualCash REAL,
  expectedCash REAL,
  difference REAL,
  cashSales REAL,
  cardSales REAL,
  totalSales REAL,
  totalExpenses REAL,
  orderCount INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- صندوق نقدي / ورديات كاش (صندوق افتراضي واحد لكل جهاز)
CREATE TABLE IF NOT EXISTS cash_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'open',
  startingCash REAL DEFAULT 0,
  currentCash REAL DEFAULT 0,
  openingCash REAL DEFAULT 0,
  employeeId INTEGER DEFAULT NULL,
  openedBy TEXT DEFAULT '',
  openedByUser INTEGER DEFAULT NULL,
  closedBy TEXT DEFAULT '',
  closedByUser INTEGER DEFAULT NULL,
  openedAt TEXT,
  closedAt TEXT,
  closingCash REAL,
  expectedCash REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  differenceType TEXT DEFAULT 'balanced',
  totalCashSales REAL DEFAULT 0,
  totalCardSales REAL DEFAULT 0,
  totalWalletSales REAL DEFAULT 0,
  totalExpenses REAL DEFAULT 0,
  totalRefunds REAL DEFAULT 0,
  transactionCount INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  version INTEGER DEFAULT 1
);

-- ------------------------------------------------------------
--  المنيو: التصنيفات + الأصناف + الإضافات + التغييرات
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sortOrder INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  categoryId INTEGER,
  price REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  taxRate REAL DEFAULT 0,
  image TEXT DEFAULT '',
  description TEXT DEFAULT '',
  components TEXT DEFAULT '[]',
  badge TEXT DEFAULT '',
  available INTEGER DEFAULT 1,
  productType TEXT DEFAULT 'standard' CHECK(productType IN ('standard','modifier','combo')),
  sortOrder INTEGER DEFAULT 0,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (categoryId) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS product_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  sortOrder INTEGER DEFAULT 0,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS product_variations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  sku TEXT DEFAULT '',
  sortOrder INTEGER DEFAULT 0,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (productId) REFERENCES products(id)
);

-- ------------------------------------------------------------
--  طرق الدفع والضرائب
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  name_en TEXT DEFAULT '',
  type TEXT DEFAULT 'cash' CHECK(type IN ('cash','card','wallet','bank','other')),
  icon TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  sortOrder INTEGER DEFAULT 0,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  appliesTo TEXT DEFAULT 'all' CHECK(appliesTo IN ('all','products','orders')),
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
--  الأوردرات + تفاصيلها + سجل الحالة + الدفعات + الاسترداد
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderNumber TEXT DEFAULT '',
  tableId TEXT,
  orderType TEXT DEFAULT 'dine_in' CHECK(orderType IN ('dine_in','takeaway','delivery','pickup')),
  items TEXT DEFAULT '[]',
  customerName TEXT DEFAULT '',
  customerPhone TEXT DEFAULT '',
  paymentMethod TEXT DEFAULT 'cash',
  paymentMethodId INTEGER DEFAULT NULL,
  customerNotes TEXT DEFAULT '',
  invoiceDelivery TEXT DEFAULT 'cashier',
  marketingOptIn INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_preparation','ready','served','completed','cancelled','closed')),
  paymentStatus TEXT DEFAULT 'unpaid' CHECK(paymentStatus IN ('unpaid','partial','paid','refunded')),
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  discountAmount REAL DEFAULT 0,
  discountType TEXT DEFAULT 'percent' CHECK(discountType IN ('percent','fixed')),
  discountBy TEXT DEFAULT '',
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  totalPaid REAL DEFAULT 0,
  changeAmount REAL DEFAULT 0,
  date TEXT DEFAULT (datetime('now')),
  createdBy TEXT DEFAULT 'unknown',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  voidReason TEXT DEFAULT '',
  voidNote TEXT DEFAULT '',
  voidedAt TEXT,
  voidedBy TEXT DEFAULT '',
  refundAmount REAL DEFAULT 0,
  syncId TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  orderSyncId TEXT,
  productId INTEGER,
  name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unitPrice REAL DEFAULT 0,
  total REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  discountType TEXT DEFAULT 'percent',
  tax REAL DEFAULT 0,
  modifiers TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_preparation','ready','served','cancelled')),
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id),
  FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  orderSyncId TEXT,
  status TEXT NOT NULL,
  changedBy TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  orderSyncId TEXT,
  invoiceId INTEGER,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'cash',
  paymentMethodId INTEGER DEFAULT NULL,
  reference TEXT DEFAULT '',
  status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','refunded','void')),
  createdBy TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  orderSyncId TEXT,
  paymentId INTEGER,
  amount REAL NOT NULL,
  reason TEXT DEFAULT '',
  type TEXT DEFAULT 'full' CHECK(type IN ('full','partial','item')),
  createdBy TEXT DEFAULT '',
  voidedBy TEXT DEFAULT '',
  note TEXT DEFAULT '',
  refundMethod TEXT DEFAULT 'cash',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id)
);

-- ------------------------------------------------------------
--  العملاء / الخصومات / الإعدادات / السجل التدقيقي
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  name TEXT DEFAULT '',
  visits INTEGER DEFAULT 1,
  lastVisit TEXT,
  totalSpent REAL DEFAULT 0,
  marketingOptIn INTEGER DEFAULT 0,
  preferredChannel TEXT DEFAULT 'cashier',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'percent' CHECK(type IN ('percent','fixed')),
  value REAL DEFAULT 0,
  minOrderAmount REAL DEFAULT 0,
  maxUses INTEGER DEFAULT 0,
  usedCount INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  startsAt TEXT,
  endsAt TEXT,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER DEFAULT NULL,
  userName TEXT DEFAULT '',
  action TEXT NOT NULL,
  objectType TEXT DEFAULT '',
  objectId INTEGER DEFAULT NULL,
  oldValue TEXT DEFAULT '',
  newValue TEXT DEFAULT '',
  ipAddress TEXT DEFAULT '',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
--  المصروفات / المخزون / المشتريات / الموردين وحركة المخزون
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'أخرى',
  amount REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  date TEXT,
  createdBy TEXT DEFAULT 'admin',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT 'قطعة',
  minStock REAL DEFAULT 0,
  costPrice REAL DEFAULT 0,
  lastUpdated TEXT,
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  item TEXT DEFAULT '',
  quantity REAL DEFAULT 1,
  costPrice REAL DEFAULT 0,
  total REAL DEFAULT 0,
  supplier TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  date TEXT,
  createdBy TEXT DEFAULT 'admin',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  name TEXT DEFAULT '',
  updatedAt TEXT DEFAULT (datetime('now')),
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  productId INTEGER,
  productSyncId TEXT,
  quantity REAL DEFAULT 0,
  type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  productId INTEGER,
  productSyncId TEXT,
  ingredient TEXT DEFAULT '',
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waste_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  productId INTEGER,
  productSyncId TEXT,
  quantity REAL DEFAULT 0,
  reason TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  ingredientId INTEGER,
  name TEXT DEFAULT '',
  quantity REAL DEFAULT 0,
  minStock REAL DEFAULT 0,
  cause TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now')),
  resolvedAt TEXT
);

-- ------------------------------------------------------------
--  الفواتير + سجل المزامنة
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  syncId TEXT,
  invoiceNumber TEXT DEFAULT '',
  orderId INTEGER,
  orderSyncId TEXT,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paymentStatus TEXT DEFAULT 'unpaid' CHECK(paymentStatus IN ('unpaid','partial','paid','refunded')),
  paymentMethod TEXT DEFAULT 'cash',
  customerName TEXT DEFAULT '',
  customerPhone TEXT DEFAULT '',
  customersId INTEGER DEFAULT NULL,
  createdBy TEXT DEFAULT 'unknown',
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT DEFAULT '',
  startedAt TEXT DEFAULT (datetime('now')),
  inserted INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  conflicts INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  conflictDetail TEXT DEFAULT '[]',
  note TEXT DEFAULT ''
);

-- ------------------------------------------------------------
--  Retained tables (المراجع القديمة)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tables_store (
  id INTEGER PRIMARY KEY,
  number INTEGER,
  status TEXT DEFAULT 'available' CHECK(status IN ('available','occupied','reserved','cleaning','closed')),
  capacity INTEGER DEFAULT 4,
  currentOrder INTEGER,
  zone TEXT DEFAULT 'صالة',
  syncId TEXT,
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- عرض توافقي للجدول القديم 'tables' (لا يُنشأ إن وُجد جدول حقيقي)
CREATE VIEW IF NOT EXISTS tables AS SELECT * FROM tables_store;

-- ------------------------------------------------------------
--  الفهارس (Performance + sync)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_category ON products(categoryId);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
CREATE INDEX IF NOT EXISTS idx_order_items_productId ON order_items(productId);
CREATE INDEX IF NOT EXISTS idx_payments_orderId ON payments(orderId);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_refunds_orderId ON refunds(orderId);
CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_createdAt ON audit_logs(createdAt);
CREATE INDEX IF NOT EXISTS idx_audit_logs_objectType ON audit_logs(objectType);
CREATE INDEX IF NOT EXISTS idx_order_status_history_orderId ON order_status_history(orderId);
CREATE INDEX IF NOT EXISTS idx_orders_orderNumber ON orders(orderNumber);
CREATE INDEX IF NOT EXISTS idx_orders_paymentStatus ON orders(paymentStatus);
CREATE INDEX IF NOT EXISTS idx_orders_orderType ON orders(orderType);
CREATE INDEX IF NOT EXISTS idx_orders_syncId ON orders(syncId);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tableId ON orders(tableId);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_createdBy ON orders(createdBy);
CREATE INDEX IF NOT EXISTS idx_orders_tableId_status ON orders(tableId, status);
CREATE INDEX IF NOT EXISTS idx_order_items_syncId ON order_items(syncId);
CREATE INDEX IF NOT EXISTS idx_order_items_orderSyncId ON order_items(orderSyncId);
CREATE INDEX IF NOT EXISTS idx_invoices_syncId ON invoices(syncId);
CREATE INDEX IF NOT EXISTS idx_payments_syncId ON payments(syncId);
CREATE INDEX IF NOT EXISTS idx_payments_createdAt ON payments(createdAt);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_attendance_employeeId ON attendance(employeeId);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_shifts_employeeId ON shifts(employeeId);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- ============================================================
--  البيانات الافتراضية (seed) — نفس ما يساويه migrate() عند بدء السيرفر
-- ============================================================
-- المستخدم الافتراضي: admin / 123456 (يُجبَر على تغييرها)
-- INSERT INTO users (username, password, name, role, mustChangePassword) VALUES ('admin','123456','مدير النظام','admin',1);
-- طاولات 1..14 (صالة/VIP/خارجي)
-- طرق الدفع الافتراضية + ضريبة + تصنيفات + أصناف من المنيو (انظر db.ts)