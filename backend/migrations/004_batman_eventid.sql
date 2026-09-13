-- ===== 004: معرّف فريد لقطعية تسجيل القرارات (idempotency) =====
-- eventId: معرّف يرسله المحرك لكل قرار ويثبت عليه أي retry من outbox محلي —
-- يضمن ألا يتكرر تسجيل نفس القرار في سجل باتمان.
ALTER TABLE batman_decisions ADD COLUMN eventId TEXT DEFAULT '';
UPDATE batman_decisions SET eventId = 'legacy-' || id WHERE eventId = '' OR eventId IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_batman_decisions_eventId ON batman_decisions(eventId);