import { Router } from 'express';
import { getSystemStats } from '../controllers/system.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/stats', getSystemStats);

export default router;
