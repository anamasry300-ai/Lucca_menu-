-- ===== 003: Backup log =====
-- يسجّل النسخ الاحتياطي التلقائي (03:00) واليدوي — وضع الملف وحجمه وحالته للعرض في لوحة التحكم.
CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT DEFAULT '',
  sizeBytes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  note TEXT DEFAULT '',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backup_log_createdAt ON backup_log(createdAt);