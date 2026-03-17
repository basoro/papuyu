import { Router } from 'express';
import { deployProject, restartProject, stopProject } from '../controllers/deploy.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/deploy/:projectId', deployProject);
router.post('/restart/:projectId', restartProject);
router.post('/stop/:projectId', stopProject);

export default router;
