import { Router, Request, Response } from 'express';
import { getDb, saveDb, queryAll, queryOne } from '../db.js';
import { authRequired, AuthRequest } from '../auth.js';

const router = Router();

router.use(authRequired as any);

function adminish(req: AuthRequest): boolean {
  const id = req.identity;
  return !!id && (id.role === 'admin' || id.role === 'manager');
}
function requireAdminish(req: Request, res: Response): boolean {
  if (!adminish(req as AuthRequest)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}
// قراءة الإعدادات: مسموحة للإداري/المدير/مفتاح الجهاز (تطبيق يحتاج إعدادات)، لا للكاشير/المطبخ
function requireSettingsRead(req: Request, res: Response): boolean {
  const id = (req as AuthRequest).identity;
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  if (id.role === 'admin' || id.role === 'manager' || id.role === 'device') return true;
  res.status(403).json({ error: 'Forbidden' }); return false;
}

// === DAILY SHIFTS (cash management, separate from per-employee) ===

router.get('/daily-shifts', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const rows = queryAll('SELECT * FROM daily_shifts ORDER BY date DESC');
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/daily-shifts/:date', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const row = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [req.params.date]);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/daily-shifts', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const data = req.body;
    if (!data.date) { res.status(400).json({ error: 'date is required' }); return; }
    const db = getDb();
    const stmt = db.prepare(`INSERT OR REPLACE INTO daily_shifts
      (date, openingBalance, status, openedAt, closedAt, actualCash, expectedCash, difference, cashSales, cardSales, totalSales, totalExpenses, orderCount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.bind([
      data.date,
      data.openingBalance ?? 0,
      data.status ?? 'open',
      data.openedAt || null,
      data.closedAt || null,
      data.actualCash ?? null,
      data.expectedCash ?? null,
      data.difference ?? null,
      data.cashSales ?? null,
      data.cardSales ?? null,
      data.totalSales ?? null,
      data.totalExpenses ?? null,
      data.orderCount ?? 0,
      data.notes || ''
    ]);
    stmt.step();
    stmt.free();
    saveDb();
    const created = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [data.date]);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.put('/daily-shifts/:date', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const data = req.body;
    const date = req.params.date;
    const existing = queryOne('SELECT * FROM daily_shifts WHERE date = ?', [date]);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const merged = { ...existing, ...data, date };
    const db = getDb();
    const stmt = db.prepare(`INSERT OR REPLACE INTO daily_shifts
      (date, openingBalance, status, openedAt, closedAt, actualCash, expectedCash, difference, cashSales, cardSales, totalSales, totalExpenses, orderCount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.bind([
      merged.date,
      merged.openingBalance ?? 0,
      merged.status ?? 'open',
      merged.openedAt || null,
      merged.closedAt || null,
      merged.actualCash ?? null,
      merged.expectedCash ?? null,
      merged.difference ?? null,
      merged.cashSales ?? null,
      merged.cardSales ?? null,
      merged.totalSales ?? null,
      merged.totalExpenses ?? null,
      merged.orderCount ?? 0,
      merged.notes || ''
    ]);
    stmt.step();
    stmt.free();
    saveDb();
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/daily-shifts/:date', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const db = getDb();
    db.run('DELETE FROM daily_shifts WHERE date = ?', [req.params.date]);
    saveDb();
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// === SETTINGS ===

router.get('/settings', (req: Request, res: Response) => {
  if (!requireSettingsRead(req, res)) return;
  try {
    const rows = queryAll('SELECT * FROM settings');
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/settings/:key', (req: Request, res: Response) => {
  if (!requireSettingsRead(req, res)) return;
  try {
    const row = queryOne('SELECT * FROM settings WHERE key = ?', [req.params.key]);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  if (!requireAdminish(req, res)) return;
  try {
    const { key, value } = req.body;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    const db = getDb();
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value ?? '']);
    saveDb();
    const created = queryOne('SELECT * FROM settings WHERE key = ?', [key]);
    res.status(201).json(created);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
