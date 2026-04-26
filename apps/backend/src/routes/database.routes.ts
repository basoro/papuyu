import { Router } from 'express';
import {
  attachManagedDatabase,
  createManagedDatabase,
  deleteManagedDatabase,
  detachManagedDatabase,
  getManagedDatabase,
  listManagedDatabases,
} from '../controllers/database.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', listManagedDatabases);
router.post('/', createManagedDatabase);
router.get('/:id', getManagedDatabase);
router.post('/:id/attach', attachManagedDatabase);
router.post('/:id/detach', detachManagedDatabase);
router.delete('/:id', deleteManagedDatabase);

export default router;
