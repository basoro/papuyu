import { Router } from 'express';
import { deployProject, restartProject, stopProject, startProject } from '../controllers/deploy.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/deploy/:projectId', deployProject);
router.post('/restart/:projectId', restartProject);
router.post('/stop/:projectId', stopProject);
router.post('/start/:projectId', startProject);

export default router;
