import { Router, Request, Response } from 'express';
import { authRequired, requirePermission, AuthRequest } from '../auth.js';
import {
  getSalesSummary, getProfitAndLoss, getCashDrawer, getInventorySummary,
  getPurchaseSummary, getOperatingExpenses, getFinancialReportForPeriod,
} from '../services/accountingService.js';
import { getOrdersPage, getOrder } from '../services/salesService.js';
import { getExpensesPage, getExpenseSummary, createExpense, removeExpense } from '../services/expenseService.js';
import { getPurchasesPage, getSuppliers, getPurchaseSummary as purchaseSummaryService, createPurchase, removePurchase } from '../services/purchaseService.js';
import {
  getStockPage, getMovementsPage, getProductsPage, getStockValue,
  createStockItem, updateStockItem, removeStockItem, adjustStock, recordWaste,
} from '../services/inventoryService.js';
import {
  getSalesReport, getExpensesReport, getInventoryReport, getEmployeesReport, getSuppliersReport, todayCompact,
} from '../services/reportService.js';
import {
  createCategory, updateCategory, deleteCategory, getCategories,
  createTable, updateTable, deleteTable,
  createProduct, updateProduct, deleteProduct, getProductRecipes, setProductRecipes,
  createPaymentMethod, updatePaymentMethod, deletePaymentMethod, getPaymentMethods,
} from '../services/catalogService.js';
import { checkIn as attendanceCheckIn, checkOut as attendanceCheckOut } from '../services/attendanceService.js';
import { openDailyShift, closeDailyShift } from '../services/shiftService.js';
import { DomainError } from '../errors.js';
import { allEmployees } from '../repositories/employeeRepo.js';
import { allTables, tablesSummary, dailyShiftsBetween } from '../repositories/tablesRepo.js';
import logger from '../logger.js';

const router = Router();

// مركز التحكم الموحد — قراءة فقط (read-only). كل المسارات تتطلب مصادقة + reports.read.
// أرباح الإدارة فقط (admin). المدير/المحاسب يرى بقية المؤشرات بلا أرباح.
router.use(authRequired as any);
router.use(requirePermission('reports.read') as any);

const num = (v: unknown): number => Number(v) || 0;

function isAdmin(req: Request): boolean {
  const id = (req as AuthRequest).identity;
  return !!id && id.kind === 'user' && id.role === 'admin';
}

function actorNameFor(req: Request): { role: string; name: string } {
  const id = (req as AuthRequest).identity;
  if (!id) return { role: '', name: '' };
  if (id.kind === 'device') return { role: 'device', name: 'device' };
  return { role: id.role || '', name: id.username || '' };
}

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

function wire(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try { fn(req, res); }
    catch (e: unknown) { logger.error('cc_error', { error: (e as Error).message }); res.status(500).json({ error: (e as Error).message }); }
  };
}

// مُغلِّف الكتابة: DomainError → حالة HTTP صحيحة، وأي خطأ آخر → 500.
function wireWrite(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try { fn(req, res); }
    catch (e: unknown) {
      if (e instanceof DomainError) { res.status(e.status).json({ error: e.message }); return; }
      logger.error('cc_write_error', { error: (e as Error).message });
      res.status(500).json({ error: (e as Error).message });
    }
  };
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new DomainError(400, 'المعرف غير صالح');
  return id;
}

// GET /api/cc — لوحة معلومات بلا بيانات حساسة
router.get('/', wire((req, res) => {
  const admin = isAdmin(req);
  res.json({
    service: 'lucca-control-center',
    version: 3,
    readonly: true,
    scope: admin ? 'admin' : 'reports-only',
    writes: {
      enabled: true,
      endpoints: [
        '/tables', '/categories', '/products', '/products/:id/recipes', '/payment-methods',
        '/expenses', '/purchases', '/stock', '/stock/:id/adjust', '/stock/waste',
        '/attendance/check-in', '/attendance/check-out', '/shifts/open', '/shifts/close',
      ],
    },
    endpoints: [
      '/dashboard', '/orders', '/orders/:id', '/expenses', '/purchases',
      '/stock', '/movements', '/products', '/tables', '/employees',
      '/suppliers', '/reports/:type', '/system/health', '/batman',
    ],
  });
}));

// GET /api/cc/dashboard?from&to|period — مؤشرات المركز (الأرباح للإدارة فقط)
router.get('/dashboard', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const admin = isAdmin(req);
  const sales = getSalesSummary(from, to);
  const expenses = getOperatingExpenses(from, to);
  const purchases = getPurchaseSummary(from, to);
  const cash = getCashDrawer(from, to);
  const pl = admin ? getProfitAndLoss(from, to) : {
    netSales: sales.netSales, cogs: null, grossProfit: null,
    operatingExpenses: expenses.total, operatingProfit: null,
    currency: 'SYP',
    completeness: { netSales: 'complete', cogs: 'unavailable', grossProfit: 'unavailable', operatingProfit: 'unavailable' },
  };
  res.json({
    range: { from, to },
    sales,
    profitAndLoss: pl,
    expenses: { total: expenses.total, count: expenses.count, cash: expenses.cash, byCategory: expenses.byCategory },
    purchases,
    cash,
    inventory: getInventorySummary(),
    financial: admin ? getFinancialReportForPeriod(from, to) : null,
  });
}));

// GET /api/cc/orders?from&to|period&page&pageSize&status&paymentStatus&orderType&q
router.get('/orders', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const q = req.query as Record<string, string | undefined>;
  res.json(getOrdersPage({
    from, to,
    page: q.page ? num(q.page) : 1,
    pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
    status: q.status, paymentStatus: q.paymentStatus, orderType: q.orderType, q: q.q,
  }));
}));

// GET /api/cc/orders/:id — تفاصيل طلب
router.get('/orders/:id', wire((req, res) => {
  const order = getOrder(num(req.params.id));
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json(order);
}));

// GET /api/cc/expenses?from&to|period&page&pageSize&category
router.get('/expenses', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const q = req.query as Record<string, string | undefined>;
  const summary = getExpenseSummary({ from, to });
  res.json({
    summary,
    page: getExpensesPage({
      from, to,
      page: q.page ? num(q.page) : 1,
      pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
      category: q.category,
    }),
  });
}));

// GET /api/cc/purchases?from&to|period&page&pageSize
router.get('/purchases', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const q = req.query as Record<string, string | undefined>;
  res.json({
    summary: purchaseSummaryService({ from, to }),
    page: getPurchasesPage({
      from, to,
      page: q.page ? num(q.page) : 1,
      pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
    }),
  });
}));

// GET /api/cc/stock?page&pageSize&q&status
router.get('/stock', wire((req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({
    totalValue: getStockValue(),
    page: getStockPage({
      page: q.page ? num(q.page) : 1,
      pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
      q: q.q, status: q.status,
    }),
  });
}));

// GET /api/cc/movements?from&to|period&page&pageSize&productId
router.get('/movements', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const q = req.query as Record<string, string | undefined>;
  res.json(getMovementsPage({
    from, to,
    productId: q.productId ? num(q.productId) : undefined,
    page: q.page ? num(q.page) : 1,
    pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
  }));
}));

// GET /api/cc/products?page&pageSize&q&categoryId
router.get('/products', wire((req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(getProductsPage({
    page: q.page ? num(q.page) : 1,
    pageSize: q.pageSize ? Math.min(200, num(q.pageSize)) : 50,
    q: q.q,
    categoryId: q.categoryId ? num(q.categoryId) : undefined,
  }));
}));

// GET /api/cc/products/:id/recipes — وصفات منتج (كانت مفقودة من القراءة)
router.get('/products/:id/recipes', wire((req, res) => {
  res.json({ rows: getProductRecipes(idParam(req)) });
}));

// GET /api/cc/categories — كان مفقوداً من القراءة
router.get('/categories', wire((_req, res) => {
  res.json({ rows: getCategories() });
}));

// GET /api/cc/payment-methods — كان مفقوداً من القراءة
router.get('/payment-methods', wire((_req, res) => {
  res.json({ rows: getPaymentMethods() });
}));

// GET /api/cc/tables — الطاولات (قراءة + ملخص الحالات)
router.get('/tables', wire((req, res) => {
  res.json({ rows: allTables(), summary: tablesSummary() });
}));

// GET /api/cc/employees — عرض الموظفين فقط (بلا بيانات حساسة)
router.get('/employees', wire((req, res) => {
  res.json({ rows: allEmployees() });
}));

// GET /api/cc/suppliers
router.get('/suppliers', wire((req, res) => {
  res.json({ rows: getSuppliers() });
}));

// GET /api/cc/cash/daily?from&to|period — الشيفات اليومية
router.get('/cash/daily', wire((req, res) => {
  const { from, to } = resolveRange(req);
  res.json({ rows: dailyShiftsBetween(from, to) });
}));

// GET /api/cc/reports/:type?from&to|period&group — تقارير canonical (الأرباح للإدارة فقط)
router.get('/reports/:type', wire((req, res) => {
  const { from, to } = resolveRange(req);
  const admin = isAdmin(req);
  const type = String(req.params.type).toLowerCase();
  switch (type) {
    case 'sales': res.json(getSalesReport(from, to, String(req.query.group || 'day'), admin)); return;
    case 'expenses': res.json(getExpensesReport(from, to)); return;
    case 'inventory': res.json(getInventoryReport()); return;
    case 'employees': res.json(getEmployeesReport(from, to)); return;
    case 'suppliers': res.json(getSuppliersReport(from, to)); return;
    default: res.status(400).json({ error: 'type يجب أن يكون sales|expenses|inventory|employees|suppliers' }); return;
  }
}));

// GET /api/cc/system/health — صحة read-only بلا أي secret
router.get('/system/health', wire((_req, res) => {
  res.json({ status: 'ok', db: 'ok', time: new Date().toISOString(), uptimeSec: Math.round(process.uptime()), service: 'lucca-backend' });
}));

// GET /api/cc/batman — واجهة الذكاء الاصطناعي: قراءة/عرض فقط في المركز (الكتابة من واجهة باتمان)
router.get('/batman', wire((_req, res) => {
  res.json({ status: 'readonly', note: 'الذكاء الاصطناعي للقراءة فقط هنا — للكتابة/أسئلة الدردشة استخدم واجهة باتمان المخصصة.', actor: 'placeholder' });
}));

// ============ كتابة Tier 1: الطاولات (tables.write) ============
router.post('/tables', requirePermission('tables.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(createTable({
    number: b.number, status: b.status, capacity: b.capacity, currentOrder: b.currentOrder, zone: b.zone,
  }));
}));

router.put('/tables/:id', requirePermission('tables.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.json(updateTable(idParam(req), {
    number: b.number, status: b.status, capacity: b.capacity, currentOrder: b.currentOrder, zone: b.zone,
  }));
}));

router.delete('/tables/:id', requirePermission('tables.write') as any, wireWrite((req, res) => {
  res.json(deleteTable(idParam(req)));
}));

// ============ كتابة Tier 1: الأقسام (categories.write) ============
router.post('/categories', requirePermission('categories.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(createCategory({
    name: b.name, name_ar: b.name_ar, name_en: b.name_en, icon: b.icon, color: b.color,
    image: b.image, sortOrder: b.sortOrder, active: b.active,
  }));
}));

router.put('/categories/:id', requirePermission('categories.write') as any, wireWrite((req, res) => {
  res.json(updateCategory(idParam(req), req.body || {}));
}));

router.delete('/categories/:id', requirePermission('categories.write') as any, wireWrite((req, res) => {
  res.json(deleteCategory(idParam(req)));
}));

// ============ كتابة Tier 1: المنتجات + الوصفات (products.write) ============
router.post('/products', requirePermission('products.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(createProduct({
    name: b.name, name_ar: b.name_ar, name_en: b.name_en, sku: b.sku, categoryId: b.categoryId,
    price: b.price, cost: b.cost, taxRate: b.taxRate, image: b.image, description: b.description,
    components: b.components, available: b.available, productType: b.productType, sortOrder: b.sortOrder,
    recipes: b.recipes,
  }));
}));

router.put('/products/:id', requirePermission('products.write') as any, wireWrite((req, res) => {
  const { recipes, ...fields } = req.body || {};
  res.json(updateProduct(idParam(req), fields, recipes));
}));

router.delete('/products/:id', requirePermission('products.write') as any, wireWrite((req, res) => {
  res.json(deleteProduct(idParam(req)));
}));

router.put('/products/:id/recipes', requirePermission('products.write') as any, wireWrite((req, res) => {
  const recipes = (req.body || {}).recipes;
  if (!Array.isArray(recipes)) throw new DomainError(400, 'recipes يجب أن تكون مصفوفة');
  res.json({ rows: setProductRecipes(idParam(req), recipes) });
}));

// ============ كتابة Tier 1: طرق الدفع (payments.write) ============
router.post('/payment-methods', requirePermission('payments.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(createPaymentMethod({
    name: b.name, name_ar: b.name_ar, name_en: b.name_en, type: b.type, icon: b.icon, active: b.active, sortOrder: b.sortOrder,
  }));
}));

router.put('/payment-methods/:id', requirePermission('payments.write') as any, wireWrite((req, res) => {
  res.json(updatePaymentMethod(idParam(req), req.body || {}));
}));

router.delete('/payment-methods/:id', requirePermission('payments.write') as any, wireWrite((req, res) => {
  res.json(deletePaymentMethod(idParam(req)));
}));

// ============ كتابة Tier 2: المصروفات (expenses.write) ============
router.post('/expenses', requirePermission('expenses.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  const amount = num(b.amount);
  if (amount <= 0) throw new DomainError(400, 'المبلغ يجب أن يكون أكبر من صفر');
  const actor = actorNameFor(req);
  const id = createExpense({
    amount, description: b.description, category: b.category, paymentMethod: b.paymentMethod,
    createdBy: actor.role === 'device' ? actor.name : actor.name,
  });
  res.status(201).json({ id, created: true });
}));

router.delete('/expenses/:id', requirePermission('expenses.write') as any, wireWrite((req, res) => {
  const ok = removeExpense(idParam(req));
  if (!ok) throw new DomainError(404, 'المصروف غير موجود');
  res.json({ deleted: true });
}));

// ============ كتابة Tier 2: المشتريات (purchases.write) ============
router.post('/purchases', requirePermission('purchases.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  const actor = actorNameFor(req);
  res.status(201).json(createPurchase({
    name: b.name, item: b.item, quantity: b.quantity, costPrice: b.costPrice, total: b.total,
    supplier: b.supplier, notes: b.notes, date: b.date, createdBy: actor.name,
  }));
}));

router.delete('/purchases/:id', requirePermission('purchases.write') as any, wireWrite((req, res) => {
  res.json(removePurchase(idParam(req)));
}));

// ============ كتابة Tier 2: المخزون (inventory.write) ============
router.post('/stock', requirePermission('inventory.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(createStockItem({
    name: b.name, quantity: b.quantity, unit: b.unit, minStock: b.minStock, costPrice: b.costPrice,
  }));
}));

router.put('/stock/:id', requirePermission('inventory.write') as any, wireWrite((req, res) => {
  res.json(updateStockItem(idParam(req), req.body || {}));
}));

router.delete('/stock/:id', requirePermission('inventory.write') as any, wireWrite((req, res) => {
  res.json(removeStockItem(idParam(req)));
}));

router.post('/stock/:id/adjust', requirePermission('inventory.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.json(adjustStock(idParam(req), Number(b.delta), b.notes));
}));

router.post('/stock/waste', requirePermission('inventory.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.json(recordWaste(num(b.productId), Number(b.quantity), b.reason));
}));

// ============ كتابة Tier 2: الحضور والانصراف (attendance.write) ============
router.post('/attendance/check-in', requirePermission('attendance.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(attendanceCheckIn(num(b.employeeId), { date: b.date, createdAt: b.createdAt }));
}));

router.post('/attendance/check-out', requirePermission('attendance.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.json(attendanceCheckOut(num(b.employeeId), { date: b.date, createdAt: b.createdAt }));
}));

// ============ كتابة Tier 2: الورديات اليومية (shifts.write) ============
router.post('/shifts/open', requirePermission('shifts.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.status(201).json(openDailyShift(String(b.date), Number(b.openingBalance)));
}));

router.post('/shifts/close', requirePermission('shifts.write') as any, wireWrite((req, res) => {
  const b = req.body || {};
  res.json(closeDailyShift(String(b.date), Number(b.actualCash), b.notes));
}));

export default router;