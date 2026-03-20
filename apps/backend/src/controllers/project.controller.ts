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
  const { name, git_repository, branch, dockerfile_path, port, project_type, compose_file, env_vars, subdomain, waf_enabled } = req.body;
  const userId = req.userId!;

  if (!name || !git_repository) {
    return res.status(400).json({ error: 'Name and Git Repository are required' });
  }

  if (subdomain && !/^[a-z0-9-]+$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain must be lowercase alphanumeric with hyphens' });
  }

  const id = `prj_${nanoid(6)}`;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, git_repository, branch, dockerfile_path, port, user_id, project_type, compose_file, env_vars, subdomain, waf_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      waf_enabled ? 1 : 0
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
  const projects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(userId);
  res.json(projects);
}

export function getProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json(project);
}

import { composeDown, removeContainer, removeImage } from '../services/docker.service';
import path from 'path';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

export function deleteProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;

  // Get project first to determine type
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as any;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
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
        removeContainer(`papuyu-${id}`);
        removeImage(id);
      } catch (e) {
         console.warn(`Failed to remove container/image for ${id}`, e);
      }
    }
  } catch (error) {
    console.error('Error cleaning up resources:', error);
  }

  // Delete from DB
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  
  res.json({ message: 'Project deleted' });
}
