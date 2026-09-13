import { Router } from 'express';
import { authRequired, requirePermission } from '../auth.js';
import {
  salesReport, expensesReport, inventoryReport, employeesReport, suppliersReport, exportReport, previousPeriod,
} from '../controllers/reportsController.js';

const router = Router();

// كل مسارات التقارير تتطلب مصادقة + صلاحية قراءة التقارير
// (مقيّد بمسار /reports حتى لا يعترض طلبات /api/batman و /api/admin القادمة بمفتاح device)
router.use('/reports', authRequired as any);
router.use('/reports', requirePermission('reports.read') as any);

router.get('/reports/sales', salesReport as any);
router.get('/reports/expenses', expensesReport as any);
router.get('/reports/inventory', inventoryReport as any);
router.get('/reports/employees', employeesReport as any);
router.get('/reports/suppliers', suppliersReport as any);
router.get('/reports/previous', previousPeriod as any);

// تصدير: ملف xlsx أو pdf (GET ‪?format=xlsx|pdf‬)
router.get('/reports/:type/export', exportReport as any);

export default router;