import { Router } from 'express';
import { listUsers, deleteUser } from '../controllers/user.controller';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/', listUsers);
router.delete('/:id', deleteUser);

export default router;
