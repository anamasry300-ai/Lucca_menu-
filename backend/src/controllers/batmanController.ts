import { Request, Response } from 'express';
import { getMatrix, updateMatrixRow, decide, recordDecision, listDecisions, decisionsStats } from '../services/permissionService.js';
import { AuthRequest } from '../auth.js';
import logger from '../logger.js';

function actorNameFor(req: Request): { role: string; name: string } {
  const id = (req as AuthRequest).identity;
  if (!id) return { role: '', name: '' };
  if (id.kind === 'device') return { role: 'device', name: 'device' };
  return { role: id.role || '', name: id.username || '' };
}

// مصفوفة الصلاحيات (للإدارة فقط)
export function matrix(req: Request, res: Response): void {
  try {
    res.json({ permissions: getMatrix() });
  } catch (e: unknown) {
    logger.error('batman_matrix_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function updateMatrix(req: Request, res: Response): void {
  try {
    const id = Number(req.params.id);
    const { limitValue, requiresApproval, autoExecute, minRole } = req.body || {};
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'id غير صالح' }); return; }
    updateMatrixRow(id, {
      limitValue: limitValue !== undefined ? Number(limitValue) : undefined,
      requiresApproval: requiresApproval !== undefined ? !!requiresApproval : undefined,
      autoExecute: autoExecute !== undefined ? !!autoExecute : undefined,
      minRole: minRole !== undefined ? String(minRole) : undefined,
    });
    const actor = actorNameFor(req);
    recordDecision({
      action: 'update_permission', decision: 'executed', actorRole: actor.role, actorName: actor.name,
      reason: `تعديل مصفوفة صلاحية #${id}`, requestJson: { id, limitValue, requiresApproval, autoExecute, minRole },
    });
    res.json({ success: true, permissions: getMatrix() });
  } catch (e: unknown) {
    logger.error('batman_matrix_update_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// سجل قرارات باتمان — عرضاً للوحة التحكم
export function decisions(req: Request, res: Response): void {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const action = req.query.action ? String(req.query.action) : undefined;
    res.json({ decisions: listDecisions(limit, action) });
  } catch (e: unknown) {
    logger.error('batman_decisions_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function stats(req: Request, res: Response): void {
  try {
    const days = Math.min(Number(req.query.days) || 7, 90);
    res.json({ stats: decisionsStats(days) });
  } catch (e: unknown) {
    logger.error('batman_stats_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// نقطة قرار للواجهة/المحرك: هل يُنفَّذ الإجراء أم يحاجج؟ (حسب المصفوفة فقط — لا تسجيل تلقائي هنا)
// الدور يُشتق من الهوية الحقيقية لجلسات المستخدمين (يُتجاهل ما يُمرَّر في الـ body)؛
// أجهزة الـ device (مفتاح API) تُعلن دورها المحلي لأن الهوية لا تحمل دوراً.
export function checkDecision(req: Request, res: Response): void {
  try {
    const { action, role, amount } = req.body || {};
    if (!action) { res.status(400).json({ error: 'action مطلوب' }); return; }
    const id = (req as AuthRequest).identity;
    const effectiveRole = id && id.kind === 'user' ? (id.role || 'cashier') : String(role || 'cashier');
    const d = decide(effectiveRole, String(action), Number(amount) || 0);
    res.json({ ...d, executorRole: effectiveRole });
  } catch (e: unknown) {
    logger.error('batman_check_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// مصفوفة مصغّرة لأي هوية مصادقة — يستخدمها المحرك لتحديث الـ cache المحلي (وليس للإدارة)
export function publicMatrix(req: Request, res: Response): void {
  try {
    const rows = getMatrix().map((p) => ({
      action: p.action,
      description: p.description,
      limitValue: p.limitValue,
      requiresApproval: !!p.requiresApproval,
      autoExecute: !!p.autoExecute,
      minRole: p.minRole,
      updatedAt: p.updatedAt,
    }));
    res.json({ permissions: rows, syncedAt: Date.now() });
  } catch (e: unknown) {
    logger.error('batman_matrix_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// تسجيل قرار (يُستدعى من واجهة باتمان لإثراء سجل القرارات)
export function record(req: Request, res: Response): void {
  try {
    const { action, requestText, requestJson, decision, reason, amount, eventId } = req.body || {};
    if (!action || !decision) { res.status(400).json({ error: 'action و decision مطلوبان' }); return; }
    const actor = actorNameFor(req);
    const id = recordDecision({
      action: String(action),
      requestText: requestText ? String(requestText) : '',
      requestJson,
      decision: String(decision),
      reason: reason ? String(reason) : '',
      actorRole: actor.role,
      actorName: actor.name,
      amount: Number(amount) || 0,
      eventId: eventId ? String(eventId) : undefined,
    });
    res.json({ success: true, id });
  } catch (e: unknown) {
    logger.error('batman_record_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}