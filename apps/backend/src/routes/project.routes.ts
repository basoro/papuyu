import { Router } from 'express';
import { createProject, listProjects, getProject, deleteProject, getProjectEnv, updateProject } from '../controllers/project.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/parse-env', getProjectEnv);
router.post('/', createProject);
router.get('/', listProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

export default router;
