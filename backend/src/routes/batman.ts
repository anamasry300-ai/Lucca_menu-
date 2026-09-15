import { Router } from 'express';
import { authRequired, requirePasswordChanged, requireRole } from '../auth.js';
import { matrix, updateMatrix, decisions, stats, checkDecision, record, publicMatrix } from '../controllers/batmanController.js';

const router = Router();

// نقطة القرار والتسجيل: متاحة لأي هوية مصادقة (يستخدمها المحرك والواجهة)
router.post('/check', authRequired as any, requirePasswordChanged as any, checkDecision as any);
router.post('/record', authRequired as any, requirePasswordChanged as any, record as any);

// مصفوفة مصغّرة لمواكبة القواعد محلياً على الأجهزة (مصادقة فقط — ليست إدارة)
router.get('/matrix', authRequired as any, requirePasswordChanged as any, publicMatrix as any);

// مصفوفة الصلاحيات وسجل القرارات: للإدارة فقط
router.get('/permissions', authRequired as any, requirePasswordChanged as any, requireRole('admin') as any, matrix as any);
router.put('/permissions/:id', authRequired as any, requirePasswordChanged as any, requireRole('admin') as any, updateMatrix as any);
router.get('/decisions', authRequired as any, requirePasswordChanged as any, requireRole('admin') as any, decisions as any);
router.get('/stats', authRequired as any, requirePasswordChanged as any, requireRole('admin') as any, stats as any);

export default router;