import { Worker, Queue, Job } from 'bullmq';
import { Server } from 'socket.io';
import IORedis from 'ioredis';
import { config } from '../config/env';
import db from '../db/database';
import fs from 'fs';
import path from 'path';
import { cloneRepository, prepareBuildDirectory } from './git.service';
import { 
  buildImage, 
  runContainer, 
  composeUp, 
  replacePortInCompose, 
  replacePortInDockerfile, 
  injectEnvVars 
} from './docker.service';
import { SHARED_DATABASE_NETWORK } from './constants';
import { decryptSecret } from '../utils/secrets';

const connection = new IORedis({
  host: config.redisHost,
  port: config.redisPort,
  maxRetriesPerRequest: null,
});

export const deploymentQueue = new Queue('deployment-queue', { connection: connection as any });

let io: Server;

export function initSocket(socketIo: Server) {
  io = socketIo;
}

function logMessage(projectId: string, message: string, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logEntry = `[${timestamp}] ${message}`;
  
  db.prepare('INSERT INTO deployment_logs (project_id, message, level) VALUES (?, ?, ?)')
    .run(projectId, logEntry, level);
  
  if (io) {
    io.to(`project-${projectId}`).emit('log', { message: logEntry, level });
  }
}

function writeCustomDockerfile(buildDir: string, dockerfilePath: string, dockerfileContent: string) {
  const targetPath = path.join(buildDir, dockerfilePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, dockerfileContent, 'utf-8');
}

function writeCustomComposeFile(buildDir: string, composeFile: string, composeContent: string) {
  const targetPath = path.join(buildDir, composeFile);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, composeContent, 'utf-8');
}

function getManagedDatabaseEnvVars(projectId: string): { envVars: Array<{ key: string; value: string }>; networks: string[] } {
  const attachments = db.prepare(`
    SELECT
      project_database_attachments.alias as alias,
      managed_databases.engine as engine,
      managed_databases.host as host,
      managed_databases.port as port,
      managed_databases.db_name as db_name,
      managed_databases.username as username,
      managed_databases.encrypted_password as encrypted_password,
      managed_databases.network_name as network_name
    FROM project_database_attachments
    INNER JOIN managed_databases ON managed_databases.id = project_database_attachments.database_id
    WHERE project_database_attachments.project_id = ?
    ORDER BY project_database_attachments.created_at ASC
  `).all(projectId) as any[];

  if (attachments.length === 0) {
    return { envVars: [], networks: [] };
  }

  const envVars: Array<{ key: string; value: string }> = [];
  const networks = new Set<string>();

  for (const attachment of attachments) {
    const password = decryptSecret(attachment.encrypted_password);
    const alias = String(attachment.alias || 'primary')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'PRIMARY';

    if (attachment.network_name) {
      networks.add(String(attachment.network_name));
    } else {
      networks.add(SHARED_DATABASE_NETWORK);
    }

    if (attachment.engine === 'mysql') {
      if (alias === 'PRIMARY') {
        envVars.push(
          { key: 'DB_HOST', value: String(attachment.host) },
          { key: 'DB_PORT', value: String(attachment.port) },
          { key: 'DB_NAME', value: String(attachment.db_name) },
          { key: 'DB_USER', value: String(attachment.username) },
          { key: 'DB_PASSWORD', value: password },
          { key: 'MYSQL_HOST', value: String(attachment.host) },
          { key: 'MYSQL_PORT', value: String(attachment.port) },
          { key: 'MYSQL_DATABASE', value: String(attachment.db_name) },
          { key: 'MYSQL_USER', value: String(attachment.username) },
          { key: 'MYSQL_PASSWORD', value: password },
        );
      } else {
        envVars.push(
          { key: `${alias}_HOST`, value: String(attachment.host) },
          { key: `${alias}_PORT`, value: String(attachment.port) },
          { key: `${alias}_NAME`, value: String(attachment.db_name) },
          { key: `${alias}_USER`, value: String(attachment.username) },
          { key: `${alias}_PASSWORD`, value: password },
        );
      }
    }
  }

  return { envVars, networks: Array.from(networks) };
}

const worker = new Worker('deployment-queue', async (job: Job) => {
  const { projectId, userId } = job.data;
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('Project not found');

  try {
    // Update status
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('building', projectId);
    if (io) io.emit('project-update', { id: projectId, status: 'building' });

    logMessage(projectId, `Starting deployment job for ${project.name}...`);
    let buildDir = '';
    const needsRepository = (
      (project.project_type === 'dockerfile' && project.dockerfile_source === 'repo') ||
      (project.project_type === 'compose' && project.compose_source === 'repo')
    );

    if (needsRepository) {
      logMessage(projectId, `Cloning ${project.git_repository}...`);
      buildDir = await cloneRepository(projectId, project.git_repository, project.branch, (msg) => logMessage(projectId, msg));
      logMessage(projectId, 'Repository cloned successfully');
    } else {
      buildDir = prepareBuildDirectory(projectId);
      logMessage(projectId, 'Using generated build workspace without repository clone');
    }

    const managedDbInjection = getManagedDatabaseEnvVars(projectId);

    // Step 1.5: Inject Env Vars
    if (project.env_vars || managedDbInjection.envVars.length > 0) {
      try {
        const envVars = project.env_vars ? JSON.parse(project.env_vars) : [];
        const mergedEnvVars = [...envVars, ...managedDbInjection.envVars];
        injectEnvVars(buildDir, mergedEnvVars);
        logMessage(projectId, `Injected ${mergedEnvVars.length} environment variables`);
      } catch (e) {
        console.error('Failed to parse env_vars', e);
      }
    }

    let containerId = '';

    if (project.project_type === 'compose') {
       if (project.compose_source && project.compose_source !== 'repo' && project.compose_content) {
         writeCustomComposeFile(buildDir, project.compose_file, project.compose_content);
         logMessage(projectId, `Custom Compose file written to ${project.compose_file}`);
       }

       // Replace Port in Compose
       if (project.port) {
         replacePortInCompose(buildDir, project.compose_file, project.port);
         logMessage(projectId, `Injected host port ${project.port} into compose file`);
       }

       // Docker Compose Logic
       logMessage(projectId, `Starting Docker Compose with ${project.compose_file}...`);
       await composeUp(projectId, buildDir, project.compose_file, project.port, project.subdomain || undefined, project.waf_enabled === 1, project.ram_limit || 0, (msg: string) => logMessage(projectId, msg), managedDbInjection.networks);
       logMessage(projectId, 'Docker Compose services started');
       containerId = 'compose-group';

    } else {
      if (project.dockerfile_source && project.dockerfile_source !== 'repo' && project.dockerfile_content) {
        writeCustomDockerfile(buildDir, project.dockerfile_path, project.dockerfile_content);
        logMessage(projectId, `Custom Dockerfile written to ${project.dockerfile_path}`);
      }

      // Replace Port in Dockerfile
      if (project.port) {
        replacePortInDockerfile(buildDir, project.dockerfile_path, project.port);
        logMessage(projectId, `Injected EXPOSE ${project.port} into Dockerfile`);
      }

      // Dockerfile Logic
      logMessage(projectId, `Building Docker image papuyu-${projectId}:latest...`);
      await buildImage(projectId, buildDir, project.dockerfile_path, (msg) => logMessage(projectId, msg));
      logMessage(projectId, 'Docker image built successfully');
  
      logMessage(projectId, `Starting container on port ${project.port}...`);
      containerId = await runContainer(projectId, project.port, project.subdomain || undefined, project.waf_enabled === 1, project.ram_limit || 0, (msg: string) => logMessage(projectId, msg), managedDbInjection.networks);
      logMessage(projectId, `Container running: ${containerId.substring(0, 12)}`);
    }

    db.prepare('UPDATE projects SET status = ?, container_id = ? WHERE id = ?')
      .run('running', containerId.substring(0, 12), projectId);
    
    if (io) io.emit('project-update', { id: projectId, status: 'running', container_id: containerId.substring(0, 12) });
    
    // Add finishing logs with SSL delay notice
    logMessage(projectId, '=======================================================', 'info');
    logMessage(projectId, '🚀 DEPLOYMENT COMPLETED SUCCESSFULLY!', 'success');
    logMessage(projectId, '=======================================================', 'info');
    logMessage(projectId, '⏳ Please wait up to 1-2 minutes for Traefik to provision the SSL certificate from Let\'s Encrypt.', 'info');
    logMessage(projectId, '🌐 Your application will be accessible securely via HTTPS shortly.', 'info');

  } catch (err: any) {
    logMessage(projectId, `Deploy failed: ${err.message}`, 'error');
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('failed', projectId);
    if (io) io.emit('project-update', { id: projectId, status: 'failed' });
    throw err;
  }
}, { connection: connection as any });

worker.on('completed', (job: Job) => {
  console.log(`Job ${job.id} completed!`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.log(`Job ${job?.id} failed with ${err.message}`);
});
