import { execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';


function validateSubdomain(s: string): void {
  const ok = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?$/.test(s);
  if (!ok) throw new Error('Invalid subdomain or domain format');
}

import { SHARED_DATABASE_NETWORK, canonicalId } from './constants';

function runDocker(args: string[], opts?: { timeout?: number; stdio?: 'pipe' | 'inherit'; cwd?: string }): string {
  return execFileSync('docker', args, {
    timeout: opts?.timeout ?? 30_000,
    stdio: opts?.stdio ?? 'pipe',
    cwd: opts?.cwd
  }).toString();
}

export function ensureDockerNetwork(networkName: string): void {
  try {
    runDocker(['network', 'inspect', networkName], { timeout: 15_000 });
  } catch {
    runDocker(['network', 'create', networkName], { timeout: 30_000 });
  }
}

async function connectContainerToNetworks(containerName: string, networks: string[], onLog?: (msg: string) => void) {
  for (const networkName of networks) {
    ensureDockerNetwork(networkName);
    try {
      await execStream('docker', ['network', 'connect', networkName, containerName], {}, onLog);
    } catch (error: any) {
      const message = String(error?.message || '');
      if (!message.includes('already exists')) {
        throw error;
      }
    }
  }
}

function execStream(command: string, args: string[], options: any, onLog?: (msg: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { ...options, shell: false });
    
    let output = '';

    proc.stdout?.on('data', (data) => {
      const str = data.toString();
      output += str;
      if (onLog) {
         str.split('\n').filter(Boolean).forEach((line: string) => onLog(line));
      }
    });

    proc.stderr?.on('data', (data) => {
      const str = data.toString();
      output += str;
      if (onLog) {
         str.split('\n').filter(Boolean).forEach((line: string) => onLog(line));
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Command failed with code ${code}`));
    });
    
    proc.on('error', (err) => reject(err));
  });
}

export async function buildImage(projectId: string, buildDir: string, dockerfilePath: string, onLog?: (msg: string) => void): Promise<void> {
  const safeProjectId = canonicalId(projectId);
  const imageName = `papuyu-${safeProjectId}:latest`;
  // Ensure the Dockerfile path is absolute relative to the build directory
  const absoluteDockerfilePath = path.join(buildDir, dockerfilePath);
  
  // Read .env file if exists to construct build-args
  const envPath = path.join(buildDir, '.env');
  const buildArgsArray: string[] = [];
  
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const lines = envContent.split('\n');
      
      const parsedArgs = lines
        .filter((line: string) => line.trim() !== '' && !line.startsWith('#'))
        .map((line: string) => {
          const [key, ...rest] = line.split('=');
          if (key && rest.length > 0) {
            const value = rest.join('='); // Rejoin value in case it contained =
            return { key: key.trim(), value: value.trim() };
          }
          return null;
        })
        .filter((arg: any): arg is {key: string, value: string} => arg !== null);
        
      if (parsedArgs.length > 0) {
        for (const arg of parsedArgs) {
          buildArgsArray.push('--build-arg', `${arg.key}=${arg.value}`);
        }
        if (onLog) onLog(`Detected ${parsedArgs.length} environment variables, passing as build-args`);
        else console.log(`Detected ${parsedArgs.length} environment variables, passing as build-args`);
      }
    } catch (e) {
      if (onLog) onLog(`Failed to parse .env for build-args: ${e}`);
      else console.warn('Failed to parse .env for build-args', e);
    }
  }

  await execStream(
    'docker',
    ['build', '-t', imageName, '-f', absoluteDockerfilePath, ...buildArgsArray, buildDir],
    { cwd: buildDir }, 
    onLog
  );
}

export async function runContainer(projectId: string, port: number, subdomain?: string, wafEnabled?: boolean, ramLimitMB?: number, onLog?: (msg: string) => void, extraNetworks: string[] = [], baseDomain?: string): Promise<string> {
  const safeProjectId = canonicalId(projectId);
  const containerName = `papuyu-${safeProjectId}`;
  const imageName = `papuyu-${safeProjectId}`;

  try {
    // Remove existing container if any
    await execStream('docker', ['rm', '-f', containerName], {}, onLog); 
  } catch {}

  // Host rule for Traefik 
  // Uses baseDomain if provided, otherwise config.domain which defaults to nip.io IP fallback or the actual domain from .env
  const domain = baseDomain || config.domain;
  if (subdomain) {
    validateSubdomain(subdomain);
  }
  const host = subdomain 
    ? (subdomain.includes('.') ? subdomain : `${subdomain}.${domain}`) 
    : `${safeProjectId}.${domain}`;

  const labelArgs = [
    '--label', 'traefik.enable=true',
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.rule=Host(\`${host}\`)`,
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.service=papuyu-${safeProjectId}`,
    '--label', `traefik.http.services.papuyu-${safeProjectId}.loadbalancer.server.port=${port}`,
    '--label', `traefik.docker.network=${SHARED_DATABASE_NETWORK}`
  ];

  // Optional HTTPS configurations based on global env
  if (process.env.TRAEFIK_HTTPS_ENABLED === 'true') {
    labelArgs.push(
      '--label', `traefik.http.routers.papuyu-${safeProjectId}.entrypoints=web,websecure`,
      '--label', `traefik.http.routers.papuyu-${safeProjectId}.tls=true`,
      '--label', `traefik.http.routers.papuyu-${safeProjectId}.tls.certresolver=myresolver`
    );
  } else {
    labelArgs.push('--label', `traefik.http.routers.papuyu-${safeProjectId}.entrypoints=web`);
  }

  if (wafEnabled) {
    labelArgs.push(
      '--label', `traefik.http.middlewares.waf-${safeProjectId}.plugin.traefik-modsecurity-plugin.modSecurityUrl=http://modsecurity:8080`,
      '--label', `traefik.http.middlewares.waf-${safeProjectId}.plugin.traefik-modsecurity-plugin.maxBodySize=52428800`,
      '--label', `traefik.http.routers.papuyu-${safeProjectId}.middlewares=waf-${safeProjectId}`
    );
  }

  const uniqueNetworks = Array.from(new Set([
    ...(extraNetworks.filter(Boolean)),
    SHARED_DATABASE_NETWORK,
  ]));
  for (const networkName of uniqueNetworks) {
    ensureDockerNetwork(networkName);
  }

  const primaryNetwork = uniqueNetworks[0];
  const additionalNetworks = uniqueNetworks.slice(1);

  const createArgs = ['create', '--name', containerName, '--network', primaryNetwork];
  
  if (ramLimitMB && ramLimitMB > 0) {
    createArgs.push('--memory', `${ramLimitMB}m`);
    // Optional: Also set swap limit to prevent swapping out to disk, usually equal to memory or slightly larger
    createArgs.push('--memory-swap', `${ramLimitMB}m`);
    if (onLog) onLog(`Applying RAM limit: ${ramLimitMB}MB`);
  }

  createArgs.push(...labelArgs, imageName);

  const output = await execStream(
    'docker',
    createArgs,
    {},
    onLog
  );

  if (additionalNetworks.length > 0) {
    await connectContainerToNetworks(containerName, additionalNetworks, onLog);
  }

  await execStream(
    'docker',
    ['start', containerName],
    {},
    onLog
  );

  return output.trim(); // container ID
}

export function stopContainer(containerName: string): void {
  try {
    runDocker(['stop', containerName], { timeout: 30_000 });
  } catch (e) {
    console.warn(`Failed to stop container ${containerName}`, e);
  }
}

export function startContainer(containerName: string): void {
  try {
    runDocker(['start', containerName], { timeout: 30_000 });
  } catch (e) {
    console.warn(`Failed to start container ${containerName}`, e);
    throw e;
  }
}

export function restartContainer(containerName: string): void {
  runDocker(['restart', containerName], { timeout: 30_000 });
}

export function getContainerLogs(containerName: string, tail = 100): string {
  return runDocker(['logs', '--tail', String(tail), containerName], { timeout: 10_000 });
}

export function removeContainer(containerName: string): void {
  try { runDocker(['rm', '-f', containerName]); } catch {}
}

export function removeImage(projectId: string): void {
  const safeProjectId = canonicalId(projectId);
  try { runDocker(['rmi', `papuyu-${safeProjectId}:latest`]); } catch {}
}

// --- Docker Compose ---

function resolveComposeFile(buildDir: string, composeFile: string): string {
  let filePath = path.join(buildDir, composeFile);
  
  if (fs.existsSync(filePath)) return filePath;
  
  // Try alternative extensions if default not found
  if (composeFile.endsWith('.yml')) {
    const yamlPath = filePath.replace(/\.yml$/, '.yaml');
    if (fs.existsSync(yamlPath)) return yamlPath;
  } else if (composeFile.endsWith('.yaml')) {
    const ymlPath = filePath.replace(/\.yaml$/, '.yml');
    if (fs.existsSync(ymlPath)) return ymlPath;
  }
  
  return filePath; // Return original if neither exists (let docker fail with clear error)
}

function getAllComposeServices(buildDir: string, composeFile: string, envPath: string): string[] {
  try {
      const filePath = resolveComposeFile(buildDir, composeFile);
      
      // Primary method: Use docker compose config --services
      // This is the most accurate way to get actual service names
      try {
          const args = ['compose', '-p', 'papuyu-temp', '-f', filePath];
          if (fs.existsSync(envPath)) {
            args.push('--env-file', envPath);
          }
          args.push('config', '--services');
          
          const output = runDocker(args, { timeout: 5000 }).trim();
          if (output) {
              return output.split('\n').map(s => s.trim()).filter(Boolean);
          }
      } catch (configError) {
          // If docker compose config fails (e.g. due to missing env vars or invalid refs),
          // we fall back to manual regex parsing.
          console.warn('docker compose config --services failed, falling back to regex', configError);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const servicesMatch = content.match(/^services:\s*\n((?:\s+[a-zA-Z0-9_-]+:\s*\n(?:(?!\s+[a-zA-Z0-9_-]+:\s*\n|\S).*\n)*)+)/m);
      let services: string[] = [];
      
      if (servicesMatch && servicesMatch[1]) {
         const servicesBlock = servicesMatch[1];
         // Service names are typically indented by 2 spaces and end with a colon
         const serviceNameRegex = /^  ([a-zA-Z0-9_-]+):/gm;
         let match;
         while ((match = serviceNameRegex.exec(servicesBlock)) !== null) {
             const sName = match[1];
             // Skip extension fields (x-...) and hidden services (...)
             if (!sName.startsWith('x-') && !sName.startsWith('.')) {
                services.push(sName);
             }
         }
      }

      return services;
  } catch (e) {
      console.warn('Failed to get compose services', e);
      return [];
  }
}

function getPrimaryService(services: string[]): string {
    const priorities = ['nginx', 'web', 'app', 'frontend', 'server', 'api'];
    for (const p of priorities) {
      if (services.includes(p)) return p;
    }
    return services[0] || 'app';
}

export function injectEnvVars(buildDir: string, envVars: { key: string; value: string }[]): void {
  if (!envVars || envVars.length === 0) return;

  const envPath = path.join(buildDir, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  // Ensure newline at the end if content exists
  if (envContent && !envContent.endsWith('\n')) {
    envContent += '\n';
  }

  envVars.forEach(({ key, value }) => {
    // Regex to replace existing key
    // We use a more specific regex to match "KEY=VALUE" exactly, avoiding partial matches
    const regex = new RegExp(`^${key}=.*`, 'm');
    
    if (regex.test(envContent)) {
      console.log(`Replacing env var ${key} in ${envPath}`);
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      console.log(`Appending env var ${key} to ${envPath}`);
      envContent += `${key}=${value}\n`;
    }
  });

  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log(`Updated .env file at ${envPath}`);
}

export function replacePortInCompose(buildDir: string, composeFile: string, targetPort: number): void {
  const filePath = resolveComposeFile(buildDir, composeFile);
  if (!fs.existsSync(filePath)) return;

  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Check if ports definition uses a variable (e.g. ${PORT}:80 or $PORT:80)
    const variableMatch = content.match(/-\s*['"]?\$({?)([A-Z0-9_]+)(}?)['"]?:(\d+)/);
    
    if (variableMatch) {
      // It uses a variable! Let's update the .env file instead of replacing yaml content
      const varName = variableMatch[2]; // e.g. APP_PORT
      console.log(`Detected variable ${varName} for port mapping in compose file`);
      
      const envPath = path.join(buildDir, '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }
      
      if (envContent && !envContent.endsWith('\n')) envContent += '\n';
      
      // Replace or append the variable in .env
      const regex = new RegExp(`^${varName}=.*`, 'm');
      // For Traefik setups, we want to avoid host port conflicts.
      // We set the host port variable to 0 (ephemeral/random) so Docker assigns a free port.
      // We assume this variable is primarily used for the HOST side of the mapping.
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${varName}=0`);
      } else {
        envContent += `${varName}=0\n`;
      }
      
      fs.writeFileSync(envPath, envContent, 'utf-8');
      
    } else {
      // Fallback: Replace host port mapping directly in yaml if no variable detected
      // Matches: - "8080:80" or - 8080:80
      // We replace the HOST port with 0 (random) and ensure the CONTAINER port is set to targetPort
      content = content.replace(/(\s*-\s*"?)(?:[\d\.]+:)?\d+(:)(\d+)/g, `$10$2${targetPort}`);
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Still check for generic PORT variable just in case
    const envPath = path.join(buildDir, '.env');
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (/^PORT=\d+/m.test(envContent)) {
            // If PORT is used, it's often the internal port. We should probably set it to targetPort.
            // But if it's used for host mapping... it's ambiguous. 
            // Let's assume PORT env var usually dictates the INTERNAL listening port of the app.
            envContent = envContent.replace(/^PORT=\d+/gm, `PORT=${targetPort}`);
            fs.writeFileSync(envPath, envContent, 'utf-8');
        }
    }
    
  } catch (error) {
    console.error(`Failed to replace port in compose/env file:`, error);
  }
}

export function replacePortInDockerfile(buildDir: string, dockerfilePath: string, targetPort: number): void {
  const filePath = path.join(buildDir, dockerfilePath);
  if (!fs.existsSync(filePath)) return;

  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Replace EXPOSE <port>
    content = content.replace(/EXPOSE\s+\d+/g, `EXPOSE ${targetPort}`);
    
    // Replace ENV PORT=<port>
    content = content.replace(/ENV\s+PORT[=\s]\d+/g, `ENV PORT=${targetPort}`);
    
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`Failed to replace port in Dockerfile:`, error);
  }
}

export async function composeUp(projectId: string, buildDir: string, composeFile: string, port?: number, subdomain?: string, wafEnabled?: boolean, ramLimitMB?: number, onLog?: (msg: string) => void, extraNetworks: string[] = [], baseDomain?: string): Promise<void> {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  const envPath = path.join(buildDir, '.env');
  
  const args = ['compose', '-p', projectName, '-f', filePath];

  let overridePath = '';
  const allServices = getAllComposeServices(buildDir, composeFile, envPath);
  
  if (allServices.length > 0) {
      const primaryService = getPrimaryService(allServices);
      if (subdomain) {
        validateSubdomain(subdomain);
      }
      
      const domain = baseDomain || config.domain;
      const host = subdomain 
        ? (subdomain.includes('.') ? subdomain : `${subdomain}.${domain}`) 
        : `${safeProjectId}.${domain}`;
      
      let wafLabels = '';
      if (wafEnabled) {
        wafLabels = `
      - "traefik.http.middlewares.waf-${safeProjectId}.plugin.traefik-modsecurity-plugin.modSecurityUrl=http://modsecurity:8080"
      - "traefik.http.middlewares.waf-${safeProjectId}.plugin.traefik-modsecurity-plugin.maxBodySize=52428800"
      - "traefik.http.routers.papuyu-${safeProjectId}.middlewares=waf-${safeProjectId}"`;
      }

      let tlsLabels = '';
      if (process.env.TRAEFIK_HTTPS_ENABLED === 'true') {
        tlsLabels = `
      - "traefik.http.routers.papuyu-${safeProjectId}.entrypoints=web,websecure"
      - "traefik.http.routers.papuyu-${safeProjectId}.tls=true"
      - "traefik.http.routers.papuyu-${safeProjectId}.tls.certresolver=myresolver"`;
      } else {
        tlsLabels = `\n      - "traefik.http.routers.papuyu-${safeProjectId}.entrypoints=web"`;
      }

      let deployBlock = '';
      if (ramLimitMB && ramLimitMB > 0) {
        deployBlock = `
    deploy:
      resources:
        limits:
          memory: ${ramLimitMB}M`;
      }

      const externalNetworks = Array.from(new Set(extraNetworks.filter(n => n && n !== SHARED_DATABASE_NETWORK)));
      
      // Ensure all networks exist before up
      ensureDockerNetwork(SHARED_DATABASE_NETWORK);
      for (const networkName of externalNetworks) {
        ensureDockerNetwork(networkName);
      }

      const extraNetworkList = externalNetworks.map((networkName) => `\n      - ${networkName}`).join('');
      const extraNetworkDefinitions = externalNetworks.map((networkName) => `
  ${networkName}:
    external: true`).join('');

      // Build services section for override
      const servicesOverride = allServices.map(s => {
        const isPrimary = s === primaryService;
        const labels = isPrimary && port ? `
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.papuyu-${safeProjectId}.rule=Host(\`${host}\`)"
      - "traefik.http.routers.papuyu-${safeProjectId}.service=papuyu-${safeProjectId}"
      - "traefik.http.services.papuyu-${safeProjectId}.loadbalancer.server.port=${port}"
      - "traefik.docker.network=${SHARED_DATABASE_NETWORK}"${tlsLabels}${wafLabels}` : '';
        
        const deploy = isPrimary ? deployBlock : '';

        // We force all services to use the shared papuyu-network as their default
        // to avoid "all predefined address pools have been fully subnetted" errors.
        return `
  ${s}:
    networks:
      - default${extraNetworkList}${labels}${deploy}`;
      }).join('');

      const overrideContent = `
version: '3.8'
services: ${servicesOverride}

networks:
  default:
    external: true
    name: ${SHARED_DATABASE_NETWORK}
${extraNetworkDefinitions}
`;
      overridePath = path.join(buildDir, 'docker-compose.override.yml');
      fs.writeFileSync(overridePath, overrideContent);
      args.push('-f', overridePath);
      if (onLog) onLog(`Generated override file for ${allServices.length} services with network attachments`);
  }

  if (fs.existsSync(envPath)) {
    args.push('--env-file', envPath);
  }

  // Pull latest images before building/upping to ensure we have the latest base images
  try {
    const pullArgs = ['compose', '-p', projectName, '-f', filePath];
    if (overridePath) pullArgs.push('-f', overridePath);
    if (fs.existsSync(envPath)) pullArgs.push('--env-file', envPath);
    pullArgs.push('pull');
    
    if (onLog) onLog(`Pulling latest images for compose services...`);
    await execStream('docker', pullArgs, { timeout: 300_000, cwd: buildDir }, onLog);
  } catch (e) {
    if (onLog) onLog(`Warning: Failed to pull some images, continuing with build/up...`);
  }

  // Use --force-recreate to guarantee containers are restarted with new code/volumes
  args.push('up', '-d', '--build', '--force-recreate');

  await execStream(
    'docker',
    args,
    { timeout: 600_000, cwd: buildDir },
    onLog
  );
}

export function composeDown(projectId: string, buildDir: string, composeFile: string): void {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  // Down first to remove network and containers
  try {
    runDocker(['compose', '-p', projectName, '-f', filePath, 'down', '--rmi', 'all', '--volumes', '--remove-orphans'], { timeout: 60_000 });
  } catch (e) {
    console.warn(`Compose down failed, trying to force cleanup`, e);
    // Force cleanup if down fails (e.g. file deleted)
    try {
        const output = runDocker(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${projectName}`]);
        const containers = output.trim().split('\n');
        if (containers.length > 0 && containers[0] !== '') {
            runDocker(['rm', '-f', ...containers]);
        }
    } catch {}
  }
}

export function composeStop(projectId: string, _buildDir: string, _composeFile: string): void {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  
  try {
    const output = runDocker(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${projectName}`]);
    const containers = output.trim().split('\n');
    if (containers.length > 0 && containers[0] !== '') {
      runDocker(['stop', ...containers]);
    }
  } catch (e) {
    console.warn(`Fallback stop failed for compose project ${projectName}`, e);
  }
}

export function composeStart(projectId: string, _buildDir: string, _composeFile: string): void {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  
  try {
    const output = runDocker(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${projectName}`]);
    const containers = output.trim().split('\n');
    if (containers.length > 0 && containers[0] !== '') {
      runDocker(['start', ...containers]);
    } else {
      throw new Error('No containers found for this project');
    }
  } catch (e) {
    console.warn(`Failed to start compose project ${projectName}`, e);
    throw e;
  }
}

export function composeRestart(projectId: string, buildDir: string, composeFile: string): void {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  runDocker(['compose', '-p', projectName, '-f', filePath, 'restart'], { timeout: 60_000 });
}

export function getComposeLogs(projectId: string, buildDir: string, composeFile: string, tail = 100): string {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  return runDocker(['compose', '-p', projectName, '-f', filePath, 'logs', '--tail', String(tail)], { timeout: 10_000 });
}
