import { Router } from 'express';
import { authRequired, requirePasswordChanged, requireRole } from '../auth.js';
import { backupList, backupCreate } from '../controllers/adminController.js';

const router = Router();

router.use(authRequired as any);
router.use(requirePasswordChanged as any);

// النسخ الاحتياطي: إدارة فقط
router.get('/backups', requireRole('admin') as any, backupList as any);
router.post('/backups', requireRole('admin') as any, backupCreate as any);

export default router;