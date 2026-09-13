-- ===== 001: Batman permission matrix =====
-- مصفوفة صلاحيات/حدود باتمان. كل صف = إجراء + ما يعتبر "قيمة عالية" (حد) + هل يتطلب تأكيداً/موافقة.
-- التحديثات هنا تُطبَّق عند كل تشغيل (INSERT OR IGNORE) ثم تُدار من لوحة التحكم عبر PUT /api/batman/permissions.
CREATE TABLE IF NOT EXISTS batman_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  limitValue REAL DEFAULT 0,
  requiresApproval INTEGER DEFAULT 0,
  autoExecute INTEGER DEFAULT 1,
  minRole TEXT DEFAULT 'cashier',
  updatedAt TEXT DEFAULT (datetime('now'))
);

-- القيم الافتراضية المعتمدة (قرارات التصميم):
--   add_expense   : ≤ 500 ل.س يعمل تلقائياً للكاشير — ما فوقه يتطلب تأكيداً صريحاً موثقاً
--   add_purchase  : ≥ 1000 ل.س يتطلب موافقة مدير
--   record_invoice: ≤ 1000 ل.س يعمل تلقائياً
--   update_price  : دائماً للمدير/الإدارة (حد 0 → لا كاشير)
--   delete_employee: دائماً للمدير/الإدارة
--   view_net_profit: تقارير الأرباح الصافية للإدارة فقط
INSERT OR IGNORE INTO batman_permissions (action, description, limitValue, requiresApproval, autoExecute, minRole) VALUES
  ('add_expense', 'تسجيل مصروف — حتى 500 ل.س تلقائي للكاشير، وما فوقه يتطلب تأكيداً صريحاً', 500, 1, 1, 'cashier'),
  ('add_purchase', 'تسجيل مشتريات/فاتورة مورد — 1000 ل.س أو أكثر يتطلب موافقة مدير', 1000, 1, 1, 'cashier'),
  ('record_invoice', 'تسجيل فاتورة يدوية (بيع خارجي) — حتى 1000 ل.س تلقائي', 1000, 1, 1, 'cashier'),
  ('update_price', 'تعديل سعر صنف — محدود للمدير/الإدارة دائماً', 0, 1, 0, 'manager'),
  ('delete_employee', 'حذف موظف — محدود للمدير/الإدارة دائماً', 0, 1, 0, 'manager'),
  ('view_net_profit', 'تصفير/عرض تقارير الأرباح الصافية — الإدارة فقط', 0, 1, 0, 'admin'),
  ('view_reports', 'عرض التقارير — مدير/إدارة', 0, 0, 1, 'manager');