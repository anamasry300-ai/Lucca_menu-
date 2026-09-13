import { Request, Response } from 'express';
import { runBackup, listBackups, listBackupLog } from '../backup.js';
import logger from '../logger.js';
import { AuthRequest } from '../auth.js';
import { recordDecision } from '../services/permissionService.js';

function actorNameFor(req: Request): { role: string; name: string } {
  const id = (req as AuthRequest).identity;
  if (!id) return { role: '', name: '' };
  if (id.kind === 'device') return { role: 'device', name: 'device' };
  return { role: id.role || '', name: id.username || '' };
}

export function backupList(_req: Request, res: Response): void {
  try {
    res.json({ backups: listBackups(), log: listBackupLog(50) });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
}

export function backupCreate(req: Request, res: Response): void {
  try {
    const result = runBackup({ manual: true });
    const actor = actorNameFor(req);
    recordDecision({ action: 'manual_backup', decision: 'executed', actorRole: actor.role, actorName: actor.name, reason: 'نسخة يدوية' });
    logger.info('backup_manual_trigger', { ...result, by: actor.name });
    res.json({ success: true, ...result });
  } catch (e: unknown) {
    logger.error('backup_manual_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}