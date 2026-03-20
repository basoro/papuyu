import { Router } from 'express';
import { getSystemStats, getDockerOverview, getDockerContainers, performContainerAction } from '../controllers/system.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/stats', getSystemStats);
router.get('/docker/overview', getDockerOverview);
router.get('/docker/containers', getDockerContainers);
router.post('/docker/containers/:id/:action', performContainerAction);

export default router;
