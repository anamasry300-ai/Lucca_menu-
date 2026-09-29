import crypto from 'crypto';
import { badRequest } from '../errors.js';
import { canRoleAct, decide, recordDecision } from './permissionService.js';
import { decisionByEventId, updateDecisionResult } from '../repositories/permissionRepo.js';
import * as catalog from './catalogService.js';
import * as inventory from './inventoryService.js';
import * as expense from './expenseService.js';
import * as purchase from './purchaseService.js';
import * as attendance from './attendanceService.js';
import * as shift from './shiftService.js';

export interface DecisionActor {
  role: string;
  name?: string;
}

export interface DecisionActionDescriptor {
  name: string;
  description: string;
  permission: string;
  matrixAction: string;
  requiresConfirmation: boolean;
  auditAction: string;
  readOnly: boolean;
  inputSchema: Record<string, string>;
}

interface DecisionAction extends DecisionActionDescriptor {
  amountOf: (p: Record<string, unknown>) => number;
  handler: (p: Record<string, unknown>) => unknown;
}

export interface ApproveOptions {
  eventId?: string;
  requestText?: string;
  explicitConfirm?: boolean;
}

const num = (v: unknown): number => Number(v) || 0;

const reqId = (p: Record<string, unknown>): number => {
  const id = num(p.id);
  if (!Number.isFinite(id) || id <= 0) throw badRequest('معرف (id) غير صالح');
  return id;
};

const withoutId = (p: Record<string, unknown>): Record<string, unknown> => {
  const copy = { ...p };
  delete copy.id;
  return copy;
};

const str = (v: unknown): string | undefined => (v == null || String(v) === '' ? undefined : String(v));

const ACTIONS: Record<string, DecisionAction> = {
  create_table: {
    name: 'create_table',
    description: 'إضافة طاولة جديدة',
    permission: 'tables.write',
    matrixAction: 'create_table',
    requiresConfirmation: false,
    auditAction: 'tables.create',
    readOnly: false,
    inputSchema: { number: 'number', status: 'string', capacity: 'number', zone: 'string' },
    amountOf: () => 0,
    handler: (p) => catalog.createTable(p as never),
  },
  update_table: {
    name: 'update_table',
    description: 'تعديل طاولة',
    permission: 'tables.write',
    matrixAction: 'update_table',
    requiresConfirmation: false,
    auditAction: 'tables.update',
    readOnly: false,
    inputSchema: { id: 'number', status: 'string', capacity: 'number', zone: 'string' },
    amountOf: () => 0,
    handler: (p) => catalog.updateTable(reqId(p), withoutId(p)),
  },
  delete_table: {
    name: 'delete_table',
    description: 'حذف طاولة',
    permission: 'tables.write',
    matrixAction: 'delete_table',
    requiresConfirmation: true,
    auditAction: 'tables.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.deleteTable(reqId(p)),
  },
  create_category: {
    name: 'create_category',
    description: 'إضافة قسم (فئة منتجات)',
    permission: 'categories.write',
    matrixAction: 'create_category',
    requiresConfirmation: false,
    auditAction: 'categories.create',
    readOnly: false,
    inputSchema: { name: 'string', color: 'string', icon: 'string', sortOrder: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.createCategory(p as never),
  },
  update_category: {
    name: 'update_category',
    description: 'تعديل قسم',
    permission: 'categories.write',
    matrixAction: 'update_category',
    requiresConfirmation: false,
    auditAction: 'categories.update',
    readOnly: false,
    inputSchema: { id: 'number', name: 'string', color: 'string', icon: 'string', sortOrder: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.updateCategory(reqId(p), withoutId(p)),
  },
  delete_category: {
    name: 'delete_category',
    description: 'حذف قسم (فارغ)',
    permission: 'categories.write',
    matrixAction: 'delete_category',
    requiresConfirmation: true,
    auditAction: 'categories.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.deleteCategory(reqId(p)),
  },
  create_product: {
    name: 'create_product',
    description: 'إضافة منتج',
    permission: 'products.write',
    matrixAction: 'create_product',
    requiresConfirmation: false,
    auditAction: 'products.create',
    readOnly: false,
    inputSchema: { name: 'string', price: 'number', cost: 'number', categoryId: 'number', taxRate: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.createProduct(p as never),
  },
  update_product: {
    name: 'update_product',
    description: 'تعديل منتج (تغيير السعر مقيد بموافقة مدير)',
    permission: 'products.write',
    matrixAction: 'update_price',
    requiresConfirmation: true,
    auditAction: 'products.update',
    readOnly: false,
    inputSchema: { id: 'number', name: 'string', price: 'number', cost: 'number', categoryId: 'number', available: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.updateProduct(reqId(p), withoutId(p)),
  },
  delete_product: {
    name: 'delete_product',
    description: 'حذف منتج',
    permission: 'products.write',
    matrixAction: 'delete_product',
    requiresConfirmation: true,
    auditAction: 'products.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.deleteProduct(reqId(p)),
  },
  set_product_recipes: {
    name: 'set_product_recipes',
    description: 'تحديث وصفة (مكوّنات) منتج',
    permission: 'products.write',
    matrixAction: 'set_product_recipes',
    requiresConfirmation: false,
    auditAction: 'products.recipes',
    readOnly: false,
    inputSchema: { id: 'number', recipes: 'array' },
    amountOf: () => 0,
    handler: (p) => catalog.setProductRecipes(reqId(p), Array.isArray(p.recipes) ? p.recipes as never[] : []),
  },
  create_payment_method: {
    name: 'create_payment_method',
    description: 'إضافة وسيلة دفع',
    permission: 'payments.write',
    matrixAction: 'create_payment_method',
    requiresConfirmation: false,
    auditAction: 'payments.create',
    readOnly: false,
    inputSchema: { name: 'string', type: 'string', icon: 'string', sortOrder: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.createPaymentMethod(p as never),
  },
  update_payment_method: {
    name: 'update_payment_method',
    description: 'تعديل وسيلة دفع',
    permission: 'payments.write',
    matrixAction: 'update_payment_method',
    requiresConfirmation: false,
    auditAction: 'payments.update',
    readOnly: false,
    inputSchema: { id: 'number', name: 'string', type: 'string', icon: 'string', sortOrder: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.updatePaymentMethod(reqId(p), withoutId(p)),
  },
  delete_payment_method: {
    name: 'delete_payment_method',
    description: 'حذف وسيلة دفع',
    permission: 'payments.write',
    matrixAction: 'delete_payment_method',
    requiresConfirmation: true,
    auditAction: 'payments.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => catalog.deletePaymentMethod(reqId(p)),
  },
  create_expense: {
    name: 'create_expense',
    description: 'تسجيل مصروف — المبالغ فوق الحد تحتاج اعتماداً',
    permission: 'expenses.write',
    matrixAction: 'add_expense',
    requiresConfirmation: true,
    auditAction: 'expenses.create',
    readOnly: false,
    inputSchema: { amount: 'number', description: 'string', category: 'string', paymentMethod: 'string' },
    amountOf: (p) => num(p.amount),
    handler: (p) => expense.createExpense(p as never),
  },
  remove_expense: {
    name: 'remove_expense',
    description: 'حذف / ترحيل مصروف',
    permission: 'expenses.write',
    matrixAction: 'remove_expense',
    requiresConfirmation: true,
    auditAction: 'expenses.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => expense.removeExpense(reqId(p)),
  },
  create_purchase: {
    name: 'create_purchase',
    description: 'تسجيل عملية شراء من مورد — المبالغ فوق الحد تحتاج موافقة مدير',
    permission: 'purchases.write',
    matrixAction: 'add_purchase',
    requiresConfirmation: true,
    auditAction: 'purchases.create',
    readOnly: false,
    inputSchema: { name: 'string', quantity: 'number', costPrice: 'number', total: 'number', supplier: 'string', date: 'string' },
    amountOf: (p) => (num(p.total) > 0 ? num(p.total) : num(p.quantity) * num(p.costPrice)),
    handler: (p) => purchase.createPurchase(p),
  },
  remove_purchase: {
    name: 'remove_purchase',
    description: 'حذف عملية شراء/ترحيل عمليات الشراء',
    permission: 'purchases.write',
    matrixAction: 'remove_purchase',
    requiresConfirmation: true,
    auditAction: 'purchases.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => purchase.removePurchase(reqId(p)),
  },
  create_stock_item: {
    name: 'create_stock_item',
    description: 'إضافة صنف مخزون جديد',
    permission: 'inventory.write',
    matrixAction: 'create_stock_item',
    requiresConfirmation: false,
    auditAction: 'inventory.create',
    readOnly: false,
    inputSchema: { name: 'string', quantity: 'number', unit: 'string', minStock: 'number', costPrice: 'number' },
    amountOf: () => 0,
    handler: (p) => inventory.createStockItem(p as never),
  },
  update_stock_item: {
    name: 'update_stock_item',
    description: 'تعديل بيانات صنف مخزون',
    permission: 'inventory.write',
    matrixAction: 'update_stock_item',
    requiresConfirmation: false,
    auditAction: 'inventory.update',
    readOnly: false,
    inputSchema: { id: 'number', name: 'string', unit: 'string', minStock: 'number', costPrice: 'number' },
    amountOf: () => 0,
    handler: (p) => inventory.updateStockItem(reqId(p), withoutId(p)),
  },
  delete_stock_item: {
    name: 'delete_stock_item',
    description: 'حذف صنف مخزون',
    permission: 'inventory.write',
    matrixAction: 'delete_stock_item',
    requiresConfirmation: true,
    auditAction: 'inventory.delete',
    readOnly: false,
    inputSchema: { id: 'number' },
    amountOf: () => 0,
    handler: (p) => inventory.removeStockItem(reqId(p)),
  },
  adjust_stock: {
    name: 'adjust_stock',
    description: 'جرد/تسوية كمية صنف',
    permission: 'inventory.write',
    matrixAction: 'adjust_stock',
    requiresConfirmation: true,
    auditAction: 'inventory.adjust',
    readOnly: false,
    inputSchema: { id: 'number', delta: 'number', notes: 'string' },
    amountOf: () => 0,
    handler: (p) => inventory.adjustStock(reqId(p), num(p.delta), str(p.notes)),
  },
  record_waste: {
    name: 'record_waste',
    description: 'تسجيل هالك (تالف) من الصنف',
    permission: 'inventory.write',
    matrixAction: 'record_waste',
    requiresConfirmation: true,
    auditAction: 'inventory.waste',
    readOnly: false,
    inputSchema: { id: 'number', quantity: 'number', reason: 'string' },
    amountOf: () => 0,
    handler: (p) => inventory.recordWaste(reqId(p), num(p.quantity), str(p.reason)),
  },
  check_in: {
    name: 'check_in',
    description: 'تسجيل حضور موظف',
    permission: 'attendance.write',
    matrixAction: 'check_in',
    requiresConfirmation: false,
    auditAction: 'attendance.check_in',
    readOnly: false,
    inputSchema: { employeeId: 'number', date: 'string' },
    amountOf: () => 0,
    handler: (p) => attendance.checkIn(reqId(p), { date: str(p.date), createdAt: str(p.createdAt) }),
  },
  check_out: {
    name: 'check_out',
    description: 'تسجيل انصراف موظف',
    permission: 'attendance.write',
    matrixAction: 'check_out',
    requiresConfirmation: false,
    auditAction: 'attendance.check_out',
    readOnly: false,
    inputSchema: { employeeId: 'number', date: 'string' },
    amountOf: () => 0,
    handler: (p) => attendance.checkOut(reqId(p), { date: str(p.date), createdAt: str(p.createdAt) }),
  },
  open_daily_shift: {
    name: 'open_daily_shift',
    description: 'فتح وردية (رصيد افتتاحي)',
    permission: 'shifts.write',
    matrixAction: 'open_daily_shift',
    requiresConfirmation: false,
    auditAction: 'shifts.open',
    readOnly: false,
    inputSchema: { date: 'string', openingBalance: 'number' },
    amountOf: (p) => num(p.openingBalance),
    handler: (p) => shift.openDailyShift(String(p.date || ''), num(p.openingBalance)),
  },
  close_daily_shift: {
    name: 'close_daily_shift',
    description: 'إقفال وردية (إيصال فعلي)',
    permission: 'shifts.write',
    matrixAction: 'close_daily_shift',
    requiresConfirmation: true,
    auditAction: 'shifts.close',
    readOnly: false,
    inputSchema: { date: 'string', actualCash: 'number', notes: 'string' },
    amountOf: (p) => num(p.actualCash),
    handler: (p) => shift.closeDailyShift(String(p.date || ''), num(p.actualCash), str(p.notes)),
  },
  open_employee_shift: {
    name: 'open_employee_shift',
    description: 'بدء وردية موظف (حضور تشغيلي)',
    permission: 'shifts.write',
    matrixAction: 'open_employee_shift',
    requiresConfirmation: false,
    auditAction: 'shifts.employee_open',
    readOnly: false,
    inputSchema: { employeeId: 'number', date: 'string', notes: 'string' },
    amountOf: () => 0,
    handler: (p) => shift.startEmployeeShift(p.employeeId, str(p.date), str(p.notes)),
  },
  close_employee_shift: {
    name: 'close_employee_shift',
    description: 'إنهاء وردية موظف (انصراف تشغيلي)',
    permission: 'shifts.write',
    matrixAction: 'close_employee_shift',
    requiresConfirmation: false,
    auditAction: 'shifts.employee_close',
    readOnly: false,
    inputSchema: { employeeId: 'number', notes: 'string' },
    amountOf: () => 0,
    handler: (p) => shift.endEmployeeShift(p.employeeId, str(p.notes)),
  },
};

export function listActions(): DecisionActionDescriptor[] {
  return Object.keys(ACTIONS).map((name) => {
    const a = ACTIONS[name];
    return {
      name: a.name,
      description: a.description,
      permission: a.permission,
      matrixAction: a.matrixAction,
      requiresConfirmation: a.requiresConfirmation,
      auditAction: a.auditAction,
      readOnly: a.readOnly,
      inputSchema: a.inputSchema,
    };
  });
}

export function approve(actionName: string, actor: DecisionActor, params: Record<string, unknown> = {}, opts: ApproveOptions = {}): Record<string, unknown> {
  const action = ACTIONS[actionName];
  if (!action) throw badRequest(`إجراء غير مسجل في طبقة القرار: ${actionName}`);
  const role = actor.role || 'cashier';
  const actorName = actor.name || role;
  const amount = action.amountOf(params || {});
  const eventId = opts.eventId || crypto.randomUUID();
  const audit = {
    action: action.auditAction,
    requestText: opts.requestText || '',
    requestJson: params || {},
    actorRole: role,
    actorName,
    amount,
    eventId,
  };

  const existing = decisionByEventId(eventId);
  if (existing && String(existing.decision) === 'executed') {
    return { action: actionName, decision: 'executed', executed: false, alreadyExecuted: true, reason: 'نُفِّذ مسبقاً (eventId مكرر)', eventId };
  }

  if (!canRoleAct(role, action.permission)) {
    recordDecision({ ...audit, decision: 'blocked', reason: `دور ${role} يفتقد صلاحية ${action.permission}` });
    return { action: actionName, decision: 'blocked', executed: false, reason: `دور ${role} يفتقد صلاحية ${action.permission}`, eventId };
  }

  const d = decide(role, action.matrixAction, amount);

  if (d.decision === 'blocked') {
    recordDecision({ ...audit, decision: 'blocked', reason: d.reason });
    return { action: actionName, decision: 'blocked', executed: false, reason: d.reason, eventId };
  }

  if (d.decision === 'needs_approval' && !opts.explicitConfirm) {
    recordDecision({ ...audit, decision: 'needs_approval', reason: d.reason });
    return { action: actionName, decision: 'needs_approval', executed: false, reason: d.reason, eventId, requiresApproval: true, limitValue: d.limitValue, amount };
  }

  const confirmed = d.decision === 'needs_approval' && !!opts.explicitConfirm;
  const reason = confirmed ? `تأكيد صريح موثق — ${d.reason}` : d.reason;
  const result = action.handler(params || {});

  if (existing) updateDecisionResult(Number(existing.id), 'executed', reason);
  else recordDecision({ ...audit, decision: 'executed', reason });

  return { action: actionName, decision: 'executed', executed: true, confirmed, reason, eventId, amount, requiresApproval: false, result };
}