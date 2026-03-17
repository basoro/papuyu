import { Router } from 'express';
import { getDeploymentLogs, getRuntimeLogs } from '../controllers/logs.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/:projectId', getDeploymentLogs);
router.get('/runtime/:projectId', getRuntimeLogs);

export default router;
