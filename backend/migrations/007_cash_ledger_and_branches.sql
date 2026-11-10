-- ===== 007: دفتر الحركات النقدية (cash_movements) والفروع (branches) =====
-- الغرض: جعل cash_movements مصدر الحقيقة لحساب النقدية المتوقعة، وإضافة نطاق فرع (branch)
-- لتحكم الملكية على المصروفات والورديات وحركات الخزنة.
-- المبلغ يُخزّن بأصغر وحدة نقدية صحيحة (قرش مصري = 1/100 جنيه)، رقمًا صحيحًا:
--   value positif = تدفق داخل (إيداع/مبيع كاش)، value سالب = تدفق خارج (مصروف كاش/استرداد كاش).
-- لا يُعدّل هذا الملف أي جدول موجود سوى إضافة أعمدة branch_id آمنة (IF NOT EXISTS عبر ALTER TABLE محمي).
-- لا يُحذف أي بيانات.

-- جدول الفروع (النطاق الإداري)
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT DEFAULT '',
  code TEXT UNIQUE DEFAULT '',
  active INTEGER DEFAULT 1,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  syncId TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- فرع افتراضي واحد إن لم يكن هناك أي فرع (يحافظ على سلاسة قواعد البيانات الموجودة)
INSERT INTO branches (name, name_ar, code, active)
SELECT 'الفرع الرئيسي', 'الفرع الرئيسي', 'MAIN', 1
WHERE NOT EXISTS (SELECT 1 FROM branches);

-- دفتر الحركات النقدية — مصدر الحقيقة للرصيد المتوقع
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL DEFAULT 1,
  shift_date TEXT,                         -- تاريخ الوردية اليومية المرتبطة (yyyy-mm-dd)
  type TEXT NOT NULL CHECK(type IN ('in','out')),
  amount INTEGER NOT NULL,                 -- بالقرش (int). الموجِب داخل، السالب خارج يُخزّن كموجب ونوعه يحدّد الاتجاه، أو يُستخدم الإشارة مباشرةً
  direction TEXT NOT NULL DEFAULT 'in' CHECK(direction IN ('in','out')),
  reference_type TEXT NOT NULL DEFAULT 'manual', -- expense | payment | refund | opening | adjustment | reversal | manual
  reference_id INTEGER,
  idempotency_key TEXT UNIQUE,             -- منع تكرار الحركة عند إعادة الإرسال
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_by_user INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_branch_date ON cash_movements(branch_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_cash_movements_reference ON cash_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_idempotency ON cash_movements(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

-- تعديل الأعمدة على الجداول القائمة (إضافة branch_id إلى users / daily_shifts / expenses / cash_registers)
-- يُنفّذ بأمان في كود migrate() في src/db.ts باستخدام ALTER TABLE داخل try/catch، quindi لا يُكسر أي قاعدة قائمة.
-- قيد على مستوى قاعدة البيانات: لا أكثر من وردية يومية مفتوحة واحدة لكل فرع في نفس التاريخ.
-- هذا يضمن منع الازدواج حتى لو تزامنت طلبتا فتح من التطبيق في نفس اللحظة.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_daily_shift_per_branch
  ON daily_shifts(branch_id, date) WHERE status = 'open';
