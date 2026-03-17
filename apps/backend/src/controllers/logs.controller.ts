import { Request, Response } from 'express';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { getContainerLogs } from '../services/docker.service';

export function getDeploymentLogs(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const logs = db.prepare('SELECT * FROM deployment_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(projectId);
  res.json(logs);
}

export function getRuntimeLogs(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  try {
    const logs = getContainerLogs(`papuyu-${projectId}`);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch container logs' });
  }
}
