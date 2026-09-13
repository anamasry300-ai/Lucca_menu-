-- ===== 002: Batman decision audit log =====
-- سجل مفصّل لكل قرار تفرّدي صادر من باتمان: ماذا أراد المستخدم، ماذا قرر السجل، ومَن المستخدم ودوره.
CREATE TABLE IF NOT EXISTS batman_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT DEFAULT '',
  requestText TEXT DEFAULT '',
  requestJson TEXT DEFAULT '',
  decision TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  actorRole TEXT DEFAULT '',
  actorName TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batman_decisions_createdAt ON batman_decisions(createdAt);
CREATE INDEX IF NOT EXISTS idx_batman_decisions_action ON batman_decisions(action);