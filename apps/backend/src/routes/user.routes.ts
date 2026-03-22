import { Router } from 'express';
import { listUsers, deleteUser, updateUserRole } from '../controllers/user.controller';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/', listUsers);
router.delete('/:id', deleteUser);
router.put('/:id/role', updateUserRole);

export default router;
