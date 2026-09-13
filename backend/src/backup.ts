import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb, queryAll } from './db.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const BACKUP_HOUR = parseInt(process.env.BACKUP_HOUR || '3', 10); // 03:00
const BACKUP_MINUTE = parseInt(process.env.BACKUP_MINUTE || '0', 10);
const KEEP_BACKUPS = parseInt(process.env.KEEP_BACKUPS || '30', 10);

export { BACKUP_DIR, KEEP_BACKUPS };

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// نسخة احتياطية فورية من قاعدة sqlite — VACUUM INTO يكتب نسخة كاملة متسقة على القرص
// (يجمع حتى التغييرات غير المكتملة في WAL) من دون تحميل القاعدة في الذاكرة.
export function runBackup({ manual = false, note = '' } = {}): { file: string; sizeBytes: number } {
  const db = getDb();
  const filename = `lucca-backup-${stamp()}.db`;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filePath = path.join(BACKUP_DIR, filename);
  db.prepare('VACUUM INTO ?').run(filePath);
  const sizeBytes = fs.statSync(filePath).size;

  try {
    db.run('INSERT INTO backup_log (file, sizeBytes, status, note) VALUES (?, ?, ?, ?)', [
      filename, sizeBytes, 'ok', manual ? 'يدوي' : (note || 'تلقائي 03:00'),
    ]);
  } catch { /* السجل غير متاح — النسخة نفسها نجحت */ }

  pruneOldBackups();

  logger.info('backup_created', { file: filename, sizeBytes, manual });
  return { file: filename, sizeBytes };
}

// حذف النسخ الأقدم — الإبقاء على آخر KEEP_BACKUPS نسخة فقط
export function pruneOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .sort()
      .reverse();
    for (const f of files.slice(KEEP_BACKUPS)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      logger.info('backup_pruned', { file: f });
    }
  } catch (e) {
    logger.error('backup_prune_failed', { error: (e as Error).message });
  }
}

export function listBackups(): { file: string; sizeBytes: number; createdAt: string }[] {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  } catch { return []; }
}

export function listBackupLog(limit = 50): Record<string, unknown>[] {
  try {
    return queryAll('SELECT id, file, sizeBytes, status, note, createdAt FROM backup_log ORDER BY id DESC LIMIT ?', [limit]);
  } catch { return []; }
}

// جدولة نسخة يومية عند (ساعة/دقيقة) محدّدين — فحص كل دقيقة (بديل لا يتطلب cron على Windows)
let _timer: NodeJS.Timeout | null = null;
export function startBackupScheduler() {
  if (_timer) return;
  const now = new Date();
  const next = new Date();
  next.setHours(BACKUP_HOUR, BACKUP_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  const msUntil = next.getTime() - now.getTime();
  logger.info('backup_scheduler_started', { nextRun: next.toISOString(), keepBackups: KEEP_BACKUPS });

  const scheduleNext = () => {
    const n2 = new Date();
    const nxt = new Date();
    nxt.setHours(BACKUP_HOUR, BACKUP_MINUTE, 0, 0);
    if (nxt.getTime() <= n2.getTime()) nxt.setDate(nxt.getDate() + 1);
    _timer = setTimeout(() => {
      try {
        runBackup();
        logger.info('backup_automatic_done');
      } catch (e) {
        logger.error('backup_automatic_failed', { error: (e as Error).message });
      }
      scheduleNext();
    }, nxt.getTime() - Date.now());
  };

  _timer = setTimeout(() => {
    try {
      runBackup();
    } catch (e) {
      logger.error('backup_automatic_failed', { error: (e as Error).message });
    }
    scheduleNext();
  }, msUntil);
}

export function stopBackupScheduler() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}