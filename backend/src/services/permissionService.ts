import { allPermissions, getPermission, updatePermission, logDecision, queryDecisions, decisionStats } from '../repositories/permissionRepo.js';
import { roleHas } from '../auth.js';

export type Decision = 'executed' | 'blocked' | 'needs_approval' | 'under_threshold' | 'high_value_explicit_confirm';

export interface PermissionDecision {
  action: string;
  decision: Decision;
  reason: string;
  limitValue: number;
  requiresApproval: boolean;
  autoExecute: boolean;
  minRole: string;
  executorRole: string;
}

export function roleAtLeast(role: string, minRole: string): boolean {
  if (role === 'admin') return true;
  if (minRole === 'admin') return role === 'admin';
  if (minRole === 'manager') return role === 'manager' || role === 'admin';
  return true;
}

// هل يملك الدور صلاحية إجراء الخام؟ (ارتباط بمصفوفة باتمان)
export function canRoleAct(role: string, perm: string): boolean {
  return roleHas(role, perm) || role === 'admin';
}

// قرار واحد لتنفيذ إجراء بواسطة دور/مبلغ معيّن بحسب المصفوفة
export function decide(actorRole: string, action: string, amount?: number): PermissionDecision {
  const p = getPermission(action) || {
    id: 0, action, description: '', limitValue: 0, requiresApproval: 1, autoExecute: 0, minRole: 'manager', updatedAt: '',
  };
  const role = actorRole || 'cashier';

  // 1) الحارس الأساسي: دور أدنى من minRole لا يستطيع إطلاقاً
  if (!roleAtLeast(role, p.minRole)) {
    return {
      action, decision: 'blocked', reason: `هذا الإجراء يتطلب دور ${p.minRole} على الأقل`,
      limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
    };
  }

  // 2) مدير/أدمن: تنفيذ مباشر، إلا إذا اقترن الإجراء نفسه بدور أدمن فقط
  if (role === 'admin' || role === 'manager') {
    if (p.minRole === 'admin' && role !== 'admin') {
      return {
        action, decision: 'blocked', reason: 'هذا الإجراء للإدارة فقط',
        limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
      };
    }
    return {
      action, decision: 'executed', reason: 'دور مميز — تنفيذ مباشر',
      limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
    };
  }

  // 3) كاشير/أدوار دنيا: حسب الحد والتنفيذ التلقائي
  const value = Number(amount) || 0;
  const overLimit = p.limitValue > 0 && value > p.limitValue;
  if (overLimit) {
    return {
      action, decision: 'needs_approval', reason: `المبلغ ${value} يتجاوز الحد ${p.limitValue} — يتطلب موافقة`,
      limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
    };
  }
  if (!p.autoExecute) {
    return {
      action, decision: 'needs_approval', reason: 'الإجراء غير تلقائي للكاشير — يتطلب موافقة',
      limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
    };
  }
  return {
    action,
    decision: value > 0 && p.limitValue > 0 && value <= p.limitValue ? 'under_threshold' : 'executed',
    reason: 'ضمن الحد التلقائي',
    limitValue: p.limitValue, requiresApproval: !!p.requiresApproval, autoExecute: !!p.autoExecute, minRole: p.minRole, executorRole: role,
  };
}

export function getMatrix() {
  return allPermissions();
}

export function updateMatrixRow(id: number, fields: { limitValue?: number; requiresApproval?: boolean; autoExecute?: boolean; minRole?: string }) {
  updatePermission(id, {
    ...(fields.limitValue !== undefined ? { limitValue: fields.limitValue } : {}),
    ...(fields.requiresApproval !== undefined ? { requiresApproval: fields.requiresApproval ? 1 : 0 } : {}),
    ...(fields.autoExecute !== undefined ? { autoExecute: fields.autoExecute ? 1 : 0 } : {}),
    ...(fields.minRole !== undefined ? { minRole: fields.minRole } : {}),
  });
  return allPermissions();
}

export function recordDecision(input: Parameters<typeof logDecision>[0]) {
  return logDecision(input);
}

export function listDecisions(limit: number, action?: string) {
  return queryDecisions(limit, action);
}

export function decisionsStats(days: number) {
  return decisionStats(days);
}