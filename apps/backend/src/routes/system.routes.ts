import { Router } from 'express';
import { getSystemStats, getDockerOverview, getDockerContainers, performContainerAction, pruneDockerSystem, getWafStats, updateRestartPolicy } from '../controllers/system.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/stats', getSystemStats);
router.get('/docker/overview', getDockerOverview);
router.get('/docker/containers', getDockerContainers);
router.post('/docker/containers/:id/:action', performContainerAction);
router.post('/docker/prune', pruneDockerSystem);
router.post('/docker/containers/:id/restart-policy', updateRestartPolicy);
router.get('/waf/stats', getWafStats);

export default router;
