import { Request, Response } from 'express';
import {
  getSalesReport, getExpensesReport, getInventoryReport, getEmployeesReport, getSuppliersReport,
  prevDateRange, todayCompact,
} from '../services/reportService.js';
import { reportSheets, buildXlsx, buildPdf, ExportFormat } from '../services/exportService.js';
import { logDecision } from '../repositories/permissionRepo.js';
import logger from '../logger.js';
import { AuthRequest } from '../auth.js';

// دقة نطاق زمني: period (today/yesterday/week/month/custom) أو from/to صريحين
function resolveRange(req: Request): { from: string; to: string } {
  const q = req.query as Record<string, string | undefined>;
  const today = todayCompact();
  if (q.from && q.to) return { from: q.from.slice(0, 10), to: q.to.slice(0, 10) };
  const period = (q.period || 'today').toLowerCase();
  const d = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (period === 'yesterday') {
    const y = new Date(d.getTime() - 86400000);
    return { from: iso(y), to: iso(y) };
  }
  if (period === 'week') {
    const start = new Date(d); start.setDate(d.getDate() - 6);
    return { from: iso(start), to: today };
  }
  if (period === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    return { from: iso(start), to: today };
  }
  return { from: today, to: today };
}

function actorNameFor(req: Request): { role: string; name: string } {
  const id = (req as AuthRequest).identity;
  if (!id) return { role: '', name: '' };
  if (id.kind === 'device') return { role: 'device', name: 'device' };
  return { role: id.role || '', name: id.username || '' };
}

// التقارير: بعض الحقول (الأرباح) للإدارة فقط
function includeProfit(req: Request): boolean {
  const id = (req as AuthRequest).identity;
  return !!id && id.kind === 'user' && id.role === 'admin';
}

export function salesReport(req: Request, res: Response): void {
  try {
    const { from, to } = resolveRange(req);
    const group = String(req.query.group || 'day');
    const report = getSalesReport(from, to, group, includeProfit(req));
    logDecision({ action: 'view_sales_report', decision: 'executed', actorRole: actorNameFor(req).role, actorName: actorNameFor(req).name });
    res.json(report);
  } catch (e: unknown) {
    logger.error('reports_sales_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function expensesReport(req: Request, res: Response): void {
  try {
    const { from, to } = resolveRange(req);
    const report = getExpensesReport(from, to);
    logDecision({ action: 'view_expenses_report', decision: 'executed', actorRole: actorNameFor(req).role, actorName: actorNameFor(req).name });
    res.json(report);
  } catch (e: unknown) {
    logger.error('reports_expenses_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function inventoryReport(_req: Request, res: Response): void {
  try {
    res.json(getInventoryReport());
  } catch (e: unknown) {
    logger.error('reports_inventory_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function employeesReport(req: Request, res: Response): void {
  try {
    const { from, to } = resolveRange(req);
    res.json(getEmployeesReport(from, to));
  } catch (e: unknown) {
    logger.error('reports_employees_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

export function suppliersReport(req: Request, res: Response): void {
  try {
    const { from, to } = resolveRange(req);
    res.json(getSuppliersReport(from, to));
  } catch (e: unknown) {
    logger.error('reports_suppliers_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// تصدير تقرير PDF/XLSX — يُرسل كملف تحميل
export async function exportReport(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.params.type || 'sales');
    const format = (String(req.query.format || 'xlsx').toLowerCase()) as ExportFormat;
    if (format !== 'xlsx' && format !== 'pdf') {
      res.status(400).json({ error: 'format يجب أن يكون xlsx أو pdf' }); return;
    }
    const { from, to } = resolveRange(req);

    let data: Record<string, any>;
    switch (type) {
      case 'sales': data = getSalesReport(from, to, String(req.query.group || 'day'), includeProfit(req)); break;
      case 'expenses': data = getExpensesReport(from, to); break;
      case 'inventory': data = getInventoryReport(); break;
      case 'employees': data = getEmployeesReport(from, to); break;
      case 'suppliers': data = getSuppliersReport(from, to); break;
      default: res.status(400).json({ error: 'type غير معروف' }); return;
    }

    const { title, sheets } = reportSheets(type, data);
    if (sheets.length === 0) { res.status(400).json({ error: 'لا توجد بيانات للتصدير' }); return; }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `lucca-${type}-report-${stamp}.${format}`;

    const actor = actorNameFor(req);
    logDecision({ action: `export_${type}_report`, decision: 'executed', actorRole: actor.role, actorName: actor.name, reason: `تصدير ${format}` });

    if (format === 'xlsx') {
      const buffer = buildXlsx(sheets);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
      return;
    }

    const pdf = await buildPdf(title, sheets.map((s) => ({ heading: s.name, table: s })));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdf));
  } catch (e: unknown) {
    logger.error('reports_export_error', { error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
}

// فترة سابقة مساعدة للواجهة (حساب سريع)
export function previousPeriod(req: Request, res: Response): void {
  try {
    const from = String(req.query.from || todayCompact());
    const to = String(req.query.to || from);
    res.json({ range: { from, to }, previous: prevDateRange(from, to) });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
}