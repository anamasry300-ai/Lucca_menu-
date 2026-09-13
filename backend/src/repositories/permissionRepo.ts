import { execute, insert, queryAll, queryOne } from '../db.js';
import crypto from 'crypto';

export interface PermissionRow {
  id: number;
  action: string;
  description: string;
  limitValue: number;
  requiresApproval: number;
  autoExecute: number;
  minRole: string;
  updatedAt: string;
}

export function allPermissions(): PermissionRow[] {
  return queryAll('SELECT id, action, description, limitValue, requiresApproval, autoExecute, minRole, updatedAt FROM batman_permissions ORDER BY id').map((r) => ({
    id: Number(r.id),
    action: String(r.action),
    description: String(r.description),
    limitValue: Number(r.limitValue) || 0,
    requiresApproval: Number(r.requiresApproval) || 0,
    autoExecute: Number(r.autoExecute) || 0,
    minRole: String(r.minRole),
    updatedAt: String(r.updatedAt || ''),
  }));
}

export function getPermission(action: string): PermissionRow | undefined {
  const row = queryOne('SELECT id, action, description, limitValue, requiresApproval, autoExecute, minRole, updatedAt FROM batman_permissions WHERE action = ?', [action]);
  if (!row) return undefined;
  return {
    id: Number(row.id),
    action: String(row.action),
    description: String(row.description),
    limitValue: Number(row.limitValue) || 0,
    requiresApproval: Number(row.requiresApproval) || 0,
    autoExecute: Number(row.autoExecute) || 0,
    minRole: String(row.minRole),
    updatedAt: String(row.updatedAt || ''),
  };
}

export function updatePermission(id: number, fields: Partial<Omit<PermissionRow, 'id' | 'updatedAt'>>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.limitValue !== undefined) { sets.push('limitValue = ?'); vals.push(fields.limitValue); }
  if (fields.requiresApproval !== undefined) { sets.push('requiresApproval = ?'); vals.push(Number(fields.requiresApproval) ? 1 : 0); }
  if (fields.autoExecute !== undefined) { sets.push('autoExecute = ?'); vals.push(Number(fields.autoExecute) ? 1 : 0); }
  if (fields.minRole !== undefined) { sets.push('minRole = ?'); vals.push(fields.minRole); }
  if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
  if (sets.length === 0) return;
  sets.push("updatedAt = datetime('now')");
  execute(`UPDATE batman_permissions SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

// ===== سجل قرارات باتمان =====
export interface DecisionInput {
  action: string;
  requestText?: string;
  requestJson?: unknown;
  decision: string;
  reason?: string;
  actorRole?: string;
  actorName?: string;
  amount?: number;
  eventId?: string;
}

export function logDecision(input: DecisionInput): number {
  try {
    const eventId = input.eventId || crypto.randomUUID();
    const existing = queryOne('SELECT id FROM batman_decisions WHERE eventId = ?', [eventId]);
    if (existing) return Number(existing.id);
    return insert(
      `INSERT INTO batman_decisions (action, requestText, requestJson, decision, reason, actorRole, actorName, amount, eventId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.action,
        input.requestText || '',
        input.requestJson !== undefined ? JSON.stringify(input.requestJson) : '',
        input.decision,
        input.reason || '',
        input.actorRole || '',
        input.actorName || '',
        input.amount || 0,
        eventId,
      ],
    );
  } catch { return 0; }
}

export function queryDecisions(limit = 100, action?: string): Record<string, unknown>[] {
  if (action) {
    return queryAll('SELECT id, action, requestText, requestJson, decision, reason, actorRole, actorName, amount, eventId, createdAt FROM batman_decisions WHERE action = ? ORDER BY id DESC LIMIT ?', [action, limit]);
  }
  return queryAll('SELECT id, action, requestText, requestJson, decision, reason, actorRole, actorName, amount, eventId, createdAt FROM batman_decisions ORDER BY id DESC LIMIT ?', [limit]);
}

export function decisionStats(days = 7): Record<string, unknown>[] {
  return queryAll(
    "SELECT decision, COUNT(*) as count FROM batman_decisions WHERE createdAt >= datetime('now', ?) GROUP BY decision ORDER BY count DESC",
    [`-${days} days`],
  );
}