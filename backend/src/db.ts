import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lucca.db');

let _db: SqlJsDatabase | null = null;

export function getDb(): SqlJsDatabase {
  if (_db) return _db;
  throw new Error('Database not initialized. Call initDb() first.');
}

export async function initDb(): Promise<SqlJsDatabase> {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();
  let buffer: Buffer | undefined;
  try { buffer = fs.readFileSync(DB_PATH); } catch { /* new db */ }
  _db = new SQL.Database(buffer);

  migrate(_db);
  saveDb();
  return _db;
}

export function saveDb() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function closeDb() {
  if (_db) { saveDb(); _db.close(); _db = null; }
}

// Helper: run a SELECT and return all rows as objects
export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a SELECT and return first row
export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

// Helper: run INSERT/UPDATE/DELETE, return changes info
export function execute(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const db = getDb();
  db.run(sql, params);
  saveDb();
  // sql.js's getRowsModified and getInsertId don't exist directly
  // We need to track them
  return { changes: 0, lastInsertRowid: 0 };
}

// Custom tracked execution
let _lastInsertId = 0;

export function insert(sql: string, params: unknown[] = []): number {
  const db = getDb();
  db.run(sql, params);
  saveDb();
  // Get the last insert id by querying sqlite_sequence or max(id)
  const tableMatch = sql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+`?(\w+)`?/i);
  if (tableMatch) {
    const table = tableMatch[1];
    const row = queryOne(`SELECT MAX(id) as max_id FROM \`${table}\``);
    _lastInsertId = (row?.max_id as number) || 0;
  }
  return _lastInsertId;
}

export function getLastInsertId(): number {
  return _lastInsertId;
}

// Transaction helpers
export function beginTransaction(): void {
  getDb().run('BEGIN');
}

export function commitTransaction(): void {
  getDb().run('COMMIT');
  saveDb();
}

export function rollbackTransaction(): void {
  getDb().run('ROLLBACK');
}

function migrate(db: SqlJsDatabase) {
  db.run('PRAGMA foreign_keys = ON;');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT DEFAULT '',
      role TEXT DEFAULT 'cashier',
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tables_store (
      id INTEGER PRIMARY KEY,
      number INTEGER,
      status TEXT DEFAULT 'available' CHECK(status IN ('available','occupied','reserved','cleaning','closed')),
      capacity INTEGER DEFAULT 4,
      currentOrder INTEGER,
      zone TEXT DEFAULT 'صالة'
    );

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
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
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
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (categoryId) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS product_modifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL DEFAULT 0,
      sortOrder INTEGER DEFAULT 0,
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_variations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL DEFAULT 0,
      sku TEXT DEFAULT '',
      sortOrder INTEGER DEFAULT 0,
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ar TEXT DEFAULT '',
      name_en TEXT DEFAULT '',
      type TEXT DEFAULT 'cash' CHECK(type IN ('cash','card','wallet','bank','other')),
      icon TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS taxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      appliesTo TEXT DEFAULT 'all' CHECK(appliesTo IN ('all','products','orders')),
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

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
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId INTEGER,
      name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unitPrice REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      discountType TEXT DEFAULT 'percent',
      tax REAL DEFAULT 0,
      modifiers TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_preparation','ready','served','cancelled')),
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      status TEXT NOT NULL,
      changedBy TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (orderId) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      invoiceId INTEGER,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'cash',
      paymentMethodId INTEGER DEFAULT NULL,
      reference TEXT DEFAULT '',
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','refunded','void')),
      createdBy TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (orderId) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      paymentId INTEGER,
      amount REAL NOT NULL,
      reason TEXT DEFAULT '',
      type TEXT DEFAULT 'full' CHECK(type IN ('full','partial','item')),
      createdBy TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (orderId) REFERENCES orders(id)
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
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      name TEXT DEFAULT '',
      visits INTEGER DEFAULT 1,
      lastVisit TEXT,
      totalSpent REAL DEFAULT 0,
      marketingOptIn INTEGER DEFAULT 0,
      preferredChannel TEXT DEFAULT 'cashier',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT 'قطعة',
      minStock REAL DEFAULT 0,
      costPrice REAL DEFAULT 0,
      lastUpdated TEXT,
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
      createdAt TEXT DEFAULT (datetime('now')),
      createdBy TEXT DEFAULT 'admin'
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'موظف',
      salary REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
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
      FOREIGN KEY (employeeId) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'أخرى',
      amount REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      date TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      createdBy TEXT DEFAULT 'admin'
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employeeId INTEGER DEFAULT 0,
      date TEXT,
      startTime TEXT,
      endTime TEXT,
      hoursWorked REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      notes TEXT DEFAULT ''
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
      notes TEXT DEFAULT ''
    );

    -- Backward compatibility: rename old tables_store references
    -- The old 'tables' table name is preserved via a view for backward compatibility
  `);

  // Create backward-compatible view for 'tables' if tables_store exists but tables doesn't
  try {
    const tableCheck = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name='tables'");
    const storeCheck = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name='tables_store'");
    if (tableCheck.length === 0 && storeCheck.length > 0) {
      db.run("CREATE VIEW IF NOT EXISTS tables AS SELECT * FROM tables_store");
    }
  } catch { /* views may already exist */ }

  // Migrate old tables data to tables_store if needed
  try {
    const storeCheck = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name='tables_store'");
    if (storeCheck.length > 0) {
      const storeCount = queryAll("SELECT COUNT(*) as c FROM tables_store");
      if (storeCount[0] && storeCount[0].c === 0) {
        // Try to migrate from old 'tables' table
        try {
          const oldTables = queryAll("SELECT * FROM tables");
          if (oldTables.length > 0) {
            for (const t of oldTables) {
              const cols = Object.keys(t);
              const vals = cols.map(k => t[k]);
              const placeholders = cols.map(() => '?').join(', ');
              db.run(`INSERT OR IGNORE INTO tables_store (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${placeholders})`, vals);
            }
          }
        } catch { /* old table may not exist */ }
      }
    }
  } catch { /* migration may not be needed */ }

  // Create indexes for new tables
  try {
    db.run("CREATE INDEX IF NOT EXISTS idx_products_category ON products(categoryId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)");
    db.run("CREATE INDEX IF NOT EXISTS idx_products_available ON products(available)");
    db.run("CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_order_items_productId ON order_items(productId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_payments_orderId ON payments(orderId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method)");
    db.run("CREATE INDEX IF NOT EXISTS idx_refunds_orderId ON refunds(orderId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)");
    db.run("CREATE INDEX IF NOT EXISTS idx_audit_logs_createdAt ON audit_logs(createdAt)");
    db.run("CREATE INDEX IF NOT EXISTS idx_order_status_history_orderId ON order_status_history(orderId)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_orderNumber ON orders(orderNumber)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_paymentStatus ON orders(paymentStatus)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_orderType ON orders(orderType)");
  } catch { /* indexes may already exist */ }

  // Migrations: add missing columns to existing tables
  try {
    try { db.run("ALTER TABLE products ADD COLUMN components TEXT DEFAULT '[]'"); } catch { /* already exists */ }
    try { db.run("ALTER TABLE products ADD COLUMN badge TEXT DEFAULT ''"); } catch { /* already exists */ }
  } catch { /* migrations may not be needed */ }

  // Performance indexes
  try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_tableId ON orders(tableId)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_createdBy ON orders(createdBy)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_tableId_status ON orders(tableId, status)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_payments_createdAt ON payments(createdAt)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_attendance_employeeId ON attendance(employeeId)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_shifts_employeeId ON shifts(employeeId)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_objectType ON audit_logs(objectType)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name)'); } catch {}

  // Seed default admin user
  const users = queryAll('SELECT COUNT(*) as c FROM users');
  if (users.length === 0 || users[0].c === 0) {
    db.run('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)', ['admin', '123456', 'مدير النظام', 'admin']);
  }

  // Seed default tables (1-14)
  const storeCheck = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name='tables_store'");
  if (storeCheck.length > 0) {
    const tables = queryAll('SELECT COUNT(*) as c FROM tables_store');
    if (tables.length === 0 || tables[0].c === 0) {
      for (let i = 1; i <= 14; i++) {
        const zone = i <= 7 ? 'صالة' : i <= 11 ? 'VIP' : 'خارجي';
        db.run('INSERT INTO tables_store (id, number, status, capacity, zone) VALUES (?, ?, ?, ?, ?)', [i, i, 'available', i <= 7 ? 4 : 6, zone]);
      }
    }
  }

  // Seed default payment methods
  const pmCount = queryAll('SELECT COUNT(*) as c FROM payment_methods');
  if (pmCount.length === 0 || pmCount[0].c === 0) {
    const defaultMethods = [
      ['كاش', 'Cash', 'cash', '💵', 1],
      ['فيزا', 'Visa', 'card', '💳', 2],
      ['ماستركارد', 'Mastercard', 'card', '💳', 3],
      ['انستاباي', 'InstaPay', 'wallet', '📱', 4],
      ['فودافون كاش', 'Vodafone Cash', 'wallet', '📱', 5],
      ['تحويل بنكي', 'Bank Transfer', 'bank', '🏦', 6],
      ['محفظة', 'Wallet', 'wallet', '👛', 7],
      ['أخرى', 'Other', 'other', '💰', 8],
    ];
    for (const [name, name_en, type, icon, sort] of defaultMethods) {
      db.run('INSERT INTO payment_methods (name, name_en, type, icon, sortOrder) VALUES (?, ?, ?, ?, ?)', [name, name_en, type, icon, sort]);
    }
  }

  // Seed default taxes
  const taxCount = queryAll('SELECT COUNT(*) as c FROM taxes');
  if (taxCount.length === 0 || taxCount[0].c === 0) {
    db.run('INSERT INTO taxes (name, rate, active, appliesTo) VALUES (?, ?, ?, ?)', ['ضريبة القيمة المضافة', 14, 1, 'all']);
  }

  // Seed default categories from menu data
  const catCount = queryAll('SELECT COUNT(*) as c FROM categories');
  if (catCount.length === 0 || catCount[0].c === 0) {
    const defaultCategories = [
      ['القهوة المختصه', 'specialty', '☕', 1],
      ['قسم القهوة', 'coffee', '☕', 2],
      ['مشروبات ساخنة', 'hot', '🫖', 3],
      ['القهوة المثلجة', 'iced', '🧊', 4],
      ['ميلك شيك', 'milkshake', '🥤', 5],
      ['عصائر فريش', 'juice', '🍹', 6],
      ['سموزي', 'smoothie', '🥭', 7],
      ['مشروبات صودا', 'soda', '🍋', 8],
      ['مشروبات غازية وطاقة', 'cans', '🥫', 9],
      ['الحلويات', 'desserts', '🍰', 10],
      ['الفطور', 'breakfast', '🥪', 11],
      ['البيتزا', 'pizza', '🍕', 12],
      ['الإضافات', 'addons', '➕', 13],
      ['مشروبات شتوية', 'winter', '🍂', 14],
    ];
    for (const [name, name_en, icon, sort] of defaultCategories) {
      db.run('INSERT INTO categories (name, name_en, icon, sortOrder) VALUES (?, ?, ?, ?)', [name, name_en, icon, sort]);
    }
  }

  // Seed default products from menu data (if products table is empty)
  const prodCount = queryAll('SELECT COUNT(*) as c FROM products');
  if (prodCount.length === 0 || prodCount[0].c === 0) {
    // Get categories to map names to IDs
    const cats = queryAll('SELECT id, name_en FROM categories');
    const catMap = {};
    for (const c of cats) { catMap[c.name_en] = c.id; }

    // Menu data mapping - import from the embedded menu
    const menuItems = {
      'specialty': [
        ['V60', 80], ['آيس دريب', 80], ['قهوة اليوم', 50], ['Aeropress', 75], ['French Press', 70]
      ],
      'coffee': [
        ['إسبريسو', 45], ['إسبريسو دبل', 70], ['قهوة تركي', 35], ['قهوة فرنساوي', 65],
        ['قهوة بندق', 70], ['ميكاتو', 50], ['ميكاتو دبل', 80], ['موكا', 75],
        ['وايت موكا', 75], ['لاتيه', 85], ['كابتشينو', 85], ['كورتادو', 75],
        ['نسكافيه', 70], ['هوت شوكليت', 70], ['هوت شوكليت نوتيلا', 80], ['فلات وايت', 80]
      ],
      'hot': [
        ['شاي', 35], ['شاي كرك', 50], ['شاي أخضر', 35], ['ميكس أعشاب', 50],
        ['شاي بالبن', 50], ['أعشاب', 35], ['هوت سيدر', 50]
      ],
      'iced': [
        ['آيس كوفي', 80], ['آيس لاتيه', 85], ['آيس موكا', 90],
        ['آيس وايت موكا', 90], ['فرابتشينو', 95], ['فرابيه كلاسيك', 85], ['فرابيه فروت', 95]
      ],
      'milkshake': [
        ['ميلك شيك شوكولاتة', 90], ['ميلك شيك فانيليا', 90], ['ميلك شيك فراولة', 90],
        ['ميلك شيك مانجو', 90], ['ميلك شيك نوتيلا', 100], ['ميلك شيك أوريو', 110],
        ['ميلك شيك كراميل', 90], ['ميلك شيك ميكس شوكليت', 120]
      ],
      'juice': [
        ['مانجو', 90], ['فراولة', 80], ['جوافة', 75], ['برتقال', 75],
        ['ليمون', 70], ['ليمون بالنعناع', 75], ['كيوي', 90]
      ],
      'smoothie': [
        ['سموزي مانجو', 75], ['سموزي فراولة', 75], ['سموزي كوكتيل', 75],
        ['سموزي كيوي', 85], ['سموزي موز', 75]
      ],
      'soda': [
        ['موهيتو', 75], ['موهيتو فليفر', 100], ['بينا كولادا', 75], ['ميكس لوكا', 80],
        ['جيلي كولا', 75], ['صن شاين', 75], ['صن رايز', 75], ['شيري كولا', 75],
        ['ميكس بيري', 80], ['بلو بيري فراولة', 75], ['باشون أناناس', 75], ['ريدبول فليفر', 120]
      ],
      'cans': [
        ['بيبسي', 35], ['سفن أب', 35], ['ميرندا', 35], ['ريد بول', 85],
        ['تويست', 35], ['فيروز', 40], ['بيريل', 50], ['مياه', 10]
      ],
      'desserts': [
        ['وافل كلاسيك', 80], ['وافل شوكليت', 140], ['سان سيباستيان', 70],
        ['مولتن', 80], ['براونيز', 80], ['كوكيز', 40], ['أم علي', 90],
        ['وافل فورسيزون', 120], ['وافل بابل', 85], ['وافل فواكه', 110],
        ['تشيز كيك', 90], ['موس جالاكسي', 100], ['ريد فالفيت', 95]
      ],
      'breakfast': [
        ['توست ميكس جبن (نصف)', 30], ['توست ميكس جبن (كامل)', 60],
        ['توست بسطرمة (نصف)', 35], ['توست بسطرمة (كامل)', 70],
        ['توست روزبيف (نصف)', 35], ['توست روزبيف (كامل)', 70],
        ['توست رومي مدخن (نصف)', 35], ['توست رومي مدخن (كامل)', 70],
        ['توست كفيار (نصف)', 50], ['توست كفيار (كامل)', 100],
        ['ساندويتش ميكس جبن', 25], ['ساندويتش بسطرمة', 30],
        ['كرواسون', 65], ['شباتا', 65], ['باجيت', 65]
      ],
      'pizza': [
        ['بيتزا سي فود', 250], ['بيتزا سلامي', 170], ['بيتزا رانش', 200],
        ['بيتزا دجاج', 200], ['بيتزا مارجريتا', 150], ['بيتزا تشيكن باربكيو', 180],
        ['بيتزا اسبايسي رانش', 190], ['بيتزا سوبر سوبريم', 220]
      ],
      'addons': [
        ['جبن', 15], ['شيكولاتة', 15], ['مكسرات', 20], ['نوتيلا', 25], ['كارت', 5], ['طاولة', 20]
      ],
      'winter': [
        ['سحلب', 85], ['سحلب نوتيلا', 90], ['حمص الشام', 80], ['بليلة', 85],
        ['شاي كرك', 50], ['قرفة', 50], ['ينسون', 40], ['زنجبيل', 40], ['بابونج', 40]
      ]
    };

    for (const [catKey, items] of Object.entries(menuItems)) {
      const catId = catMap[catKey];
      if (!catId) continue;
      items.forEach(([name, price], idx) => {
        db.run('INSERT INTO products (name, categoryId, price, sortOrder) VALUES (?, ?, ?, ?)', [name, catId, price, idx + 1]);
      });
    }
  }

  saveDb();
}
