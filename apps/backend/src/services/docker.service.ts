import { execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';

function canonicalId(raw: string): string {
  // lower-case, allow letters/digits/dash, collapse others to dash, trim length
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function validateSubdomain(s: string): void {
  const ok = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
  if (!ok) throw new Error('Invalid subdomain');
}

function runDocker(args: string[], opts?: { timeout?: number; stdio?: 'pipe' | 'inherit'; cwd?: string }): string {
  return execFileSync('docker', args, {
    timeout: opts?.timeout ?? 30_000,
    stdio: opts?.stdio ?? 'pipe',
    cwd: opts?.cwd
  }).toString();
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

export async function runContainer(projectId: string, port: number, subdomain?: string, onLog?: (msg: string) => void): Promise<string> {
  const safeProjectId = canonicalId(projectId);
  const imageName = `papuyu-${safeProjectId}:latest`;
  const containerName = `papuyu-${safeProjectId}`;

  // Stop & remove existing container if any
  try { 
    await execStream('docker', ['rm', '-f', containerName], {}, onLog); 
  } catch {}

  const domain = config.domain;
  if (subdomain) {
    validateSubdomain(subdomain);
  }
  const host = subdomain ? `${subdomain}.${domain}` : `${safeProjectId}.${domain}`;

  const labelArgs = [
    '--label', 'traefik.enable=true',
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.rule=Host(\`${host}\`)`,
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.service=papuyu-${safeProjectId}`,
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.entrypoints=websecure`,
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.tls=true`,
    '--label', `traefik.http.routers.papuyu-${safeProjectId}.tls.certresolver=myresolver`,
    '--label', `traefik.http.services.papuyu-${safeProjectId}.loadbalancer.server.port=${port}`,
    '--label', 'traefik.docker.network=papuyu-network'
  ];

  // Connect to papuyu-network and do NOT map host port
  const output = await execStream(
    'docker',
    ['run', '-d', '--name', containerName, '--network', 'papuyu-network', ...labelArgs, imageName],
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

function getComposeService(buildDir: string, composeFile: string, envPath: string): string {
  try {
      const filePath = resolveComposeFile(buildDir, composeFile);
      
      // Instead of relying purely on docker compose config which fails on invalid volume/network references,
      // we can try to parse the yaml file directly if possible, or fallback to parsing the file content manually.
      // A quick fallback is to read the file and extract service names using regex.
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Simple regex to find service names under 'services:'
      const servicesMatch = content.match(/^services:\s*\n((?:\s+[a-zA-Z0-9_-]+:\s*\n(?:(?!\s+[a-zA-Z0-9_-]+:\s*\n|\S).*\n)*)+)/m);
      let services: string[] = [];
      
      if (servicesMatch && servicesMatch[1]) {
         const servicesBlock = servicesMatch[1];
         const serviceNameRegex = /^\s{2}([a-zA-Z0-9_-]+):/gm;
         let match;
         while ((match = serviceNameRegex.exec(servicesBlock)) !== null) {
             services.push(match[1]);
         }
      }

      if (services.length === 0) {
          // Fallback to docker compose config if regex fails (though config might throw)
          const args = ['compose', '-p', 'papuyu-temp', '-f', filePath];
          if (fs.existsSync(envPath)) {
            args.push('--env-file', envPath);
          }
          args.push('config', '--services');
          
          const output = runDocker(args, { timeout: 5000 }).trim();
          services = output.split('\n').filter((s: string) => s.trim() !== '');
      }

      // Heuristic: Prefer services that look like web servers
      const priorities = ['nginx', 'web', 'app', 'frontend', 'server', 'api'];
      for (const p of priorities) {
        if (services.includes(p)) return p;
      }

      return services[0] || 'app'; // Return the first service
  } catch (e) {
      console.warn('Failed to get compose services, defaulting to "app"', e);
      return 'app';
  }
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

export async function composeUp(projectId: string, buildDir: string, composeFile: string, port?: number, subdomain?: string, onLog?: (msg: string) => void): Promise<void> {
  const safeProjectId = canonicalId(projectId);
  const projectName = `papuyu-${safeProjectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  const envPath = path.join(buildDir, '.env');
  
  const args = ['compose', '-p', projectName, '-f', filePath];

  let overridePath = '';
  if (port) {
      const serviceName = getComposeService(buildDir, composeFile, envPath);
      if (subdomain) {
        validateSubdomain(subdomain);
      }
      const host = subdomain ? `${subdomain}.${config.domain}` : `${safeProjectId}.${config.domain}`;
      const overrideContent = `
version: '3.8'
services:
  ${serviceName}:
    networks:
      - papuyu-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.papuyu-${safeProjectId}.rule=Host(\`${host}\`)"
      - "traefik.http.routers.papuyu-${safeProjectId}.service=papuyu-${safeProjectId}"
      - "traefik.http.routers.papuyu-${safeProjectId}.entrypoints=websecure"
      - "traefik.http.routers.papuyu-${safeProjectId}.tls=true"
      - "traefik.http.routers.papuyu-${safeProjectId}.tls.certresolver=myresolver"
      - "traefik.http.services.papuyu-${safeProjectId}.loadbalancer.server.port=${port}"
      - "traefik.docker.network=papuyu-network"

networks:
  papuyu-network:
    external: true
`;
      overridePath = path.join(buildDir, 'docker-compose.override.yml');
      fs.writeFileSync(overridePath, overrideContent);
      args.push('-f', overridePath);
      if (onLog) onLog(`Generated override file for service ${serviceName} with Traefik labels`);
      else console.log(`Generated override file for service ${serviceName} with Traefik labels`);
  }

  if (fs.existsSync(envPath)) {
    args.push('--env-file', envPath);
  }

  args.push('up', '-d', '--build');

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

export function composeStop(projectId: string, buildDir: string, composeFile: string): void {
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

export function composeStart(projectId: string, buildDir: string, composeFile: string): void {
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
