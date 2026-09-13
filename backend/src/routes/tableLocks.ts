import { Router, Request, Response } from 'express';
import { getDb, queryOne } from '../db.js';
import { authRequired } from '../auth.js';

// ===== Phase 2: Advisory table locks (تنسيق متعدد الأجهزة) =====
// قفل استشاري لكل طاولة: يحميه جهاز واحد فقط حتى انتهاء الصلاحية (60 ثانية) أو التحرير الصريح.
// لا يمنع القراءة أبداً (المطبخ يعمل دائماً) — فقط يمنع عمليتين للفتح/التعديل/التحصيل على نفس الطاولة.
const router = Router();

const LOCK_TTL_SECONDS = 60;

function pruneExpiredLocks(): void {
  try {
    getDb().run(`DELETE FROM table_locks WHERE locked_at < datetime('now', '-${LOCK_TTL_SECONDS} seconds')`);
  } catch { /* الجدول قد لا يوجد في قاعدة قديمة جداً */ }
}

function isRealTableId(id: string): boolean {
  return !!id && /^\d+$/.test(id);
}

// حالة القفل الحالية (transparency للشاشات الأخرى)
router.get('/:tableId/lock', authRequired, (req: Request, res: Response) => {
  try {
    const tableId = String(req.params.tableId || '');
    if (!isRealTableId(tableId)) { res.status(400).json({ error: 'tableId must be a numeric dined-in table' }); return; }
    pruneExpiredLocks();
    const current = queryOne('SELECT * FROM table_locks WHERE table_id = ?', [tableId]) as Record<string, unknown> | undefined;
    if (!current || !current.locked_by_device) { res.json({ locked: false, tableId }); return; }
    res.json({ locked: true, tableId, holder: current.locked_by_device, lockedAt: current.locked_at, orderId: current.order_id ?? null });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// اكتساب القفل: نفس الجهاز → تجديد وقت الانتهاء؛ جهاز آخر → 409 مع بيانات الحامل
router.post('/:tableId/lock', authRequired, (req: Request, res: Response) => {
  try {
    const tableId = String(req.params.tableId || '');
    if (!isRealTableId(tableId)) { res.status(400).json({ error: 'tableId must be a numeric dined-in table' }); return; }
    const deviceId = String((req.body || {}).deviceId || '');
    if (!deviceId) { res.status(400).json({ error: 'deviceId is required' }); return; }
    const orderId = (req.body || {}).orderId != null ? (Number((req.body || {}).orderId) || null) : null;

    const db = getDb();
    pruneExpiredLocks();
    const current = queryOne('SELECT * FROM table_locks WHERE table_id = ?', [tableId]) as Record<string, unknown> | undefined;

    if (current && current.locked_by_device && current.locked_by_device !== deviceId) {
      res.status(409).json({
        error: 'الطاولة محمية بجهاز آخر',
        holder: current.locked_by_device,
        lockedAt: current.locked_at,
        orderId: current.order_id ?? null,
      });
      return;
    }

    if (current) {
      db.run("UPDATE table_locks SET locked_at = datetime('now'), order_id = ? WHERE table_id = ?", [orderId, tableId]);
    } else {
      db.run('INSERT INTO table_locks (table_id, locked_by_device, order_id) VALUES (?, ?, ?)', [tableId, deviceId, orderId]);
    }

    const after = queryOne('SELECT * FROM table_locks WHERE table_id = ?', [tableId]) as Record<string, unknown>;
    res.json({ ok: true, tableId, holder: after.locked_by_device, lockedAt: after.locked_at });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// تحرير القفل: حصري للحامل (يستخدمه المحرك عند انتهاء التحصيل/الفتح)
router.post('/:tableId/unlock', authRequired, (req: Request, res: Response) => {
  try {
    const tableId = String(req.params.tableId || '');
    if (!tableId) { res.status(400).json({ error: 'tableId is required' }); return; }
    const deviceId = String((req.body || {}).deviceId || '');
    if (!deviceId) { res.status(400).json({ error: 'deviceId is required' }); return; }

    const current = queryOne('SELECT * FROM table_locks WHERE table_id = ?', [tableId]) as Record<string, unknown> | undefined;
    if (!current || !current.locked_by_device) { res.json({ ok: true, wasLocked: false }); return; }

    if (deviceId !== current.locked_by_device) {
      res.status(409).json({ error: 'القفل حصري للجهاز الحامل', holder: current.locked_by_device, lockedAt: current.locked_at });
      return;
    }

    getDb().run('DELETE FROM table_locks WHERE table_id = ?', [tableId]);
    res.json({ ok: true, wasLocked: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;