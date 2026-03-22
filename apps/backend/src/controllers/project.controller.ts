import { Request, Response } from 'express';
import { customAlphabet } from 'nanoid';
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6);
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';

import { execSync } from 'child_process';

export function getProjectEnv(req: AuthRequest, res: Response) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Fetching .env from: ${url}`);
  
  try {
    // Use curl instead of fetch for better compatibility inside container
    // -s: silent, -L: follow redirects
    const text = execSync(`curl -s -L "${url}"`, { timeout: 10000 }).toString();
    
    // Check if response is 404 (GitHub raw returns "404: Not Found" text usually)
    if (text.trim() === '404: Not Found') {
        throw new Error('File not found (404)');
    }

    // Simple parsing of .env content
    const envs: { key: string; value: string }[] = [];
    text.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
        if (match && !line.trim().startsWith('#')) {
            let value = match[2] || '';
            // Remove surrounding quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            envs.push({ key: match[1], value });
        }
    });
    res.json({ envs });
  } catch (err: any) {
    console.error(`Curl failed for ${url}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

export function createProject(req: AuthRequest, res: Response) {
  const { name, git_repository, branch, dockerfile_path, port, project_type, compose_file, env_vars, subdomain, waf_enabled, ram_limit } = req.body;
  const userId = req.userId!;

  if (!name || !git_repository) {
    return res.status(400).json({ error: 'Name and Git Repository are required' });
  }

  if (subdomain && !/^[a-z0-9-]+$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain must be lowercase alphanumeric with hyphens' });
  }

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
  let finalRamLimit = 0;

  if (user.role === 'admin') {
    finalRamLimit = ram_limit ? parseInt(ram_limit, 10) : 0;
  } else if (user.role === 'client') {
    finalRamLimit = 512; // Default Client limit
  } else {
    finalRamLimit = 256; // Default User limit
  }

  const id = `prj_${nanoid(6)}`;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, git_repository, branch, dockerfile_path, port, user_id, project_type, compose_file, env_vars, subdomain, waf_enabled, ram_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      name,
      git_repository,
      branch || 'main',
      dockerfile_path || 'Dockerfile',
      port || 80,
      userId,
      project_type || 'dockerfile',
      compose_file || 'docker-compose.yml',
      JSON.stringify(env_vars || []),
      subdomain || null,
      waf_enabled ? 1 : 0,
      finalRamLimit
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed: projects.subdomain')) {
        return res.status(400).json({ error: 'Subdomain is already taken' });
    }
    res.status(500).json({ error: err.message });
  }
}

export function listProjects(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
  
  let projects;
  if (user && user.role === 'admin') {
    projects = db.prepare(`
      SELECT p.*, u.email as user_email 
      FROM projects p 
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `).all();
  } else {
    projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }
  
  res.json(projects);
}

export function getProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;
  
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
  
  let project;
  if (user && user.role === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
  }
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json(project);
}

import { composeDown, removeContainer, removeImage } from '../services/docker.service';
import { deploymentQueue } from '../services/queue.service';
import path from 'path';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

export async function updateProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { ram_limit } = req.body;
  const userId = req.userId!;
  
  try {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
    
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update RAM limits' });
    }
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (ram_limit !== undefined) {
      const limit = parseInt(ram_limit, 10);
      db.prepare('UPDATE projects SET ram_limit = ? WHERE id = ?').run(limit, id);
      
      // Auto restart container by adding it to deployment queue
      // This will ensure Docker Compose or Dockerfile recreates the container with the new limit
      await deploymentQueue.add('deploy', { projectId: id, userId: project.user_id });
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('queued', id);
    }
    
    res.json({ message: 'Project updated and restarting to apply new limits' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export function deleteProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;

  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;

  // Get project first to determine type
  let project;
  if (user && user.role === 'admin') {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  } else {
    project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as any;
  }

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    // We need to use canonicalId for cleanup because container names use canonicalId
    const safeProjectId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    
    // Cleanup Docker resources
    if (project.project_type === 'compose') {
      const buildDir = path.join(BUILD_DIR, id);
      try {
        composeDown(id, buildDir, project.compose_file);
      } catch (e) {
        console.warn(`Failed to stop compose for ${id}`, e);
      }
    } else {
      try {
        removeContainer(`papuyu-${safeProjectId}`);
        removeImage(id); // removeImage internally uses canonicalId
      } catch (e) {
         console.warn(`Failed to remove container/image for ${id}`, e);
      }
    }
  } catch (error) {
    console.error('Error cleaning up resources:', error);
  }

  // Delete from DB
  if (user && user.role === 'admin') {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  } else {
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  }
  
  res.json({ message: 'Project deleted' });
}
