import { Request, Response } from 'express';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { deploymentQueue } from '../services/queue.service';
import path from 'path';
import { 
  restartContainer, 
  stopContainer, 
  startContainer,
  composeRestart, 
  composeStop,
  composeStart,
} from '../services/docker.service';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

function logMessage(projectId: string, message: string, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare('INSERT INTO deployment_logs (project_id, message, level) VALUES (?, ?, ?)')
    .run(projectId, `[${timestamp}] ${message}`, level);
}

export async function deployProject(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  }

  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    // Add to queue
    await deploymentQueue.add('deploy', { projectId, userId });
    
    // Update status to queued
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('queued', projectId);
    logMessage(projectId, 'Deployment queued');

    res.json({ status: 'queued', message: 'Deployment added to queue' });
  } catch (err: any) {
    logMessage(projectId, `Queue failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
}

export function restartProject(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  }
  
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  try {
    if (project.project_type === 'compose') {
      const buildDir = path.join(BUILD_DIR, projectId);
      composeRestart(projectId, buildDir, project.compose_file);
      logMessage(projectId, 'Compose services restarted');
    } else {
      if (!project.container_id) return res.status(400).json({ error: 'Container not running' });
      restartContainer(`papuyu-${projectId}`);
      logMessage(projectId, 'Container restarted');
    }
    res.json({ message: 'Project restarted' });
  } catch (err: any) {
    logMessage(projectId, `Restart failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
}

export function startProject(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  }
  
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  try {
    if (project.project_type === 'compose') {
      const buildDir = path.join(BUILD_DIR, projectId);
      composeStart(projectId, buildDir, project.compose_file);
      logMessage(projectId, 'Compose services started');
    } else {
      startContainer(`papuyu-${projectId}`);
      logMessage(projectId, 'Container started');
    }
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', projectId);
    res.json({ message: 'Project started' });
  } catch (err: any) {
    logMessage(projectId, `Start failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
}

export function stopProject(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  }
  
  if (!project) return res.status(404).json({ error: 'Project not found' });
  
  try {
    if (project.project_type === 'compose') {
      const buildDir = path.join(BUILD_DIR, projectId);
      composeStop(projectId, buildDir, project.compose_file);
      logMessage(projectId, 'Compose services stopped');
    } else {
      stopContainer(`papuyu-${projectId}`);
      logMessage(projectId, 'Container stopped');
    }
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('stopped', projectId);
    res.json({ message: 'Project stopped' });
  } catch (err: any) {
    logMessage(projectId, `Stop failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
}

export function getLogs(req: AuthRequest, res: Response) {
  const { projectId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
  }
  
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const logs = db.prepare('SELECT * FROM deployment_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(projectId);
  res.json(logs);
}
