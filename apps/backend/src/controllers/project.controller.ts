import { Response } from 'express';
import { customAlphabet } from 'nanoid';
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6);
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { deploymentQueue } from '../services/queue.service';
import path from 'path';

import { execSync } from 'child_process';

const PROJECT_PUBLIC_COLUMNS = `
  projects.id as id,
  projects.name as name,
  projects.git_repository as git_repository,
  projects.branch as branch,
  projects.project_type as project_type,
  projects.dockerfile_path as dockerfile_path,
  projects.dockerfile_content as dockerfile_content,
  projects.compose_file as compose_file,
  projects.compose_source as compose_source,
  projects.compose_content as compose_content,
  projects.port as port,
  projects.env_vars as env_vars,
  projects.subdomain as subdomain,
  projects.waf_enabled as waf_enabled,
  projects.ram_limit as ram_limit,
  projects.dockerfile_source as dockerfile_source,
  projects.container_id as container_id,
  projects.status as status,
  projects.user_id as user_id,
  projects.created_at as created_at
`;

function isSafeProjectPath(filePath: string): boolean {
  if (!filePath || path.isAbsolute(filePath)) {
    return false;
  }

  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
  return normalized !== '..' && !normalized.startsWith('../');
}

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
  const {
    name,
    git_repository,
    branch,
    dockerfile_path,
    port,
    project_type,
    compose_file,
    env_vars,
    subdomain,
    waf_enabled,
    ram_limit,
    dockerfile_source,
    dockerfile_content,
    compose_source,
    compose_content,
  } = req.body;
  const userId = req.userId!;
  const userRole = req.userRole;
  const finalProjectType = project_type || 'dockerfile';
  const finalDockerfilePath = dockerfile_path || 'Dockerfile';
  const finalComposeFile = compose_file || 'docker-compose.yml';
  const finalDockerfileSource = dockerfile_source || 'repo';
  const finalDockerfileContent = typeof dockerfile_content === 'string' ? dockerfile_content.trim() : '';
  const finalComposeSource = compose_source || 'repo';
  const finalComposeContent = typeof compose_content === 'string' ? compose_content.trim() : '';
  const needsRepository = (
    (finalProjectType === 'dockerfile' && finalDockerfileSource === 'repo') ||
    (finalProjectType === 'compose' && finalComposeSource === 'repo')
  );

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  if (needsRepository && !git_repository) {
    return res.status(400).json({ error: 'Git Repository is required when using file from repo' });
  }

  if (subdomain && !/^[a-z0-9.-]+$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain must be lowercase alphanumeric with hyphens or dots' });
  }

  if (finalProjectType === 'dockerfile') {
    if (!isSafeProjectPath(finalDockerfilePath)) {
      return res.status(400).json({ error: 'Dockerfile path must be a safe relative path inside the repository' });
    }

    if (!['repo', 'upload', 'textarea'].includes(finalDockerfileSource)) {
      return res.status(400).json({ error: 'Invalid Dockerfile source' });
    }

    if (finalDockerfileSource !== 'repo' && !finalDockerfileContent) {
      return res.status(400).json({ error: 'Dockerfile content is required for upload or textarea source' });
    }
  }

  if (finalProjectType === 'compose' && !isSafeProjectPath(finalComposeFile)) {
    return res.status(400).json({ error: 'Compose file path must be a safe relative path inside the repository' });
  }

  if (finalProjectType === 'compose') {
    if (!['repo', 'upload', 'textarea'].includes(finalComposeSource)) {
      return res.status(400).json({ error: 'Invalid Compose source' });
    }

    if (finalComposeSource !== 'repo' && !finalComposeContent) {
      return res.status(400).json({ error: 'Compose content is required for upload or textarea source' });
    }
  }

  // Enforce RAM limits based on role
  let finalRamLimit = ram_limit ? parseInt(ram_limit, 10) : 0;
  if (userRole === 'user') {
    if (finalRamLimit === 0 || finalRamLimit > 256) finalRamLimit = 256;
  } else if (userRole === 'client') {
    if (finalRamLimit === 0 || finalRamLimit > 512) finalRamLimit = 512;
  }

  const id = `prj_${nanoid(6)}`;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, git_repository, branch, dockerfile_path, port, user_id,
        project_type, compose_file, env_vars, subdomain, waf_enabled, ram_limit,
        dockerfile_source, dockerfile_content, compose_source, compose_content
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      name,
      git_repository || '',
      branch || 'main',
      finalDockerfilePath,
      port || 80,
      userId,
      finalProjectType,
      finalComposeFile,
      JSON.stringify(env_vars || []),
      subdomain || null,
      waf_enabled ? 1 : 0,
      finalRamLimit,
      finalProjectType === 'dockerfile' ? finalDockerfileSource : 'repo',
      finalProjectType === 'dockerfile' && finalDockerfileSource !== 'repo' ? finalDockerfileContent : null,
      finalProjectType === 'compose' ? finalComposeSource : 'repo',
      finalProjectType === 'compose' && finalComposeSource !== 'repo' ? finalComposeContent : null
    );

    const project = db.prepare(`SELECT ${PROJECT_PUBLIC_COLUMNS} FROM projects WHERE id = ?`).get(id);
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
  const userRole = req.userRole;
  
  if (userRole === 'admin') {
    // Admin can see all projects
    const projects = db.prepare(`
      SELECT ${PROJECT_PUBLIC_COLUMNS}, users.email as user_email 
      FROM projects 
      LEFT JOIN users ON projects.user_id = users.id
    `).all();
    return res.json(projects);
  } else {
    const projects = db.prepare(`SELECT ${PROJECT_PUBLIC_COLUMNS} FROM projects WHERE user_id = ?`).all(userId);
    return res.json(projects);
  }
}

export function getProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  
  let project;
  if (userRole === 'admin') {
    project = db.prepare(`SELECT ${PROJECT_PUBLIC_COLUMNS} FROM projects WHERE id = ?`).get(id);
  } else {
    project = db.prepare(`SELECT ${PROJECT_PUBLIC_COLUMNS} FROM projects WHERE id = ? AND user_id = ?`).get(id, userId);
  }
  
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  res.json(project);
}

export async function updateProjectRam(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { ram_limit } = req.body;
  const userRole = req.userRole;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admins can edit RAM limits' });
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const newLimit = parseInt(ram_limit) || 0;

  try {
    db.prepare('UPDATE projects SET ram_limit = ? WHERE id = ?').run(newLimit, id);
    
    // Automatically trigger redeploy so the container is recreated with the new memory limit
    await deploymentQueue.add('deploy', { projectId: id, userId: project.user_id });
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('queued', id);

    res.json({ message: 'RAM limit updated and project is restarting', ram_limit: newLimit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

import { composeDown, removeContainer, removeImage } from '../services/docker.service';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

export function deleteProject(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;

  // Get project first to determine type
  let project;
  if (userRole === 'admin') {
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
  if (userRole === 'admin') {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  } else {
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  }
  
  res.json({ message: 'Project deleted' });
}
