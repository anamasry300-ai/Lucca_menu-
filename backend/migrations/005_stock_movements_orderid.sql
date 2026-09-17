-- ===== 005: ربط حركات المخزون بالطلب (orderId) — أساس إلغاء الخصم وضد الازدواج =====
-- يسمح أن يتراجع الخصم الناتج عن checkout عند الإلغاء (void) مرة واحدة فقط،
-- ويُستخدم لتخطي أي إعادة خصم مكررة لنفس الطلب (idempotency على مستوى الحركة).
ALTER TABLE stock_movements ADD COLUMN orderId INTEGER;
CREATE INDEX IF NOT EXISTS idx_stock_movements_orderId ON stock_movements(orderId);