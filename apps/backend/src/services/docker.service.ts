import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';

export function buildImage(projectId: string, buildDir: string, dockerfilePath: string): void {
  const imageName = `papuyu-${projectId}:latest`;
  // Ensure the Dockerfile path is absolute relative to the build directory
  const absoluteDockerfilePath = path.join(buildDir, dockerfilePath);
  
  execSync(
    `docker build -t ${imageName} -f ${absoluteDockerfilePath} ${buildDir}`,
    { timeout: 300_000, stdio: 'pipe' }
  );
}

export function runContainer(projectId: string, port: number, subdomain?: string): string {
  const imageName = `papuyu-${projectId}:latest`;
  const containerName = `papuyu-${projectId}`;

  // Stop & remove existing container if any
  try { execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' }); } catch {}

  const domain = config.domain;
  // Sanitize projectId for DNS (replace _ with -)
  const safeProjectId = projectId.replace(/_/g, '-');
  const host = subdomain ? `${subdomain}.${domain}` : `${safeProjectId}.${domain}`;

  const labels = [
    `--label "traefik.enable=true"`,
    `--label "traefik.http.routers.papuyu-${projectId}.rule=Host(\`${host}\`)"`,
    `--label "traefik.http.routers.papuyu-${projectId}.service=papuyu-${projectId}"`,
    `--label "traefik.http.routers.papuyu-${projectId}.entrypoints=websecure"`,
    `--label "traefik.http.routers.papuyu-${projectId}.tls=true"`,
    `--label "traefik.http.routers.papuyu-${projectId}.tls.certresolver=myresolver"`,
    `--label "traefik.http.services.papuyu-${projectId}.loadbalancer.server.port=${port}"`,
    `--label "traefik.docker.network=papuyu-network"`
  ].join(' ');

  // Connect to papuyu-network and do NOT map host port
  const output = execSync(
    `docker run -d --name ${containerName} --network papuyu-network ${labels} ${imageName}`,
    { timeout: 30_000 }
  ).toString().trim();

  return output; // container ID
}

export function stopContainer(containerName: string): void {
  execSync(`docker stop ${containerName}`, { timeout: 30_000 });
}

export function restartContainer(containerName: string): void {
  execSync(`docker restart ${containerName}`, { timeout: 30_000 });
}

export function getContainerLogs(containerName: string, tail = 100): string {
  return execSync(
    `docker logs --tail ${tail} ${containerName}`,
    { timeout: 10_000 }
  ).toString();
}

export function removeContainer(containerName: string): void {
  try { execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' }); } catch {}
}

export function removeImage(projectId: string): void {
  try { execSync(`docker rmi papuyu-${projectId}:latest`, { stdio: 'pipe' }); } catch {}
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
      const envFlag = fs.existsSync(envPath) ? `--env-file ${envPath}` : '';
      // We use the project name 'papuyu-temp' just for config parsing to avoid warnings
      const output = execSync(`docker compose -p papuyu-temp -f ${filePath} ${envFlag} config --services`, { timeout: 5000, stdio: 'pipe' }).toString().trim();
      const services = output.split('\n').filter(s => s.trim() !== '');

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

export function composeUp(projectId: string, buildDir: string, composeFile: string, port?: number, subdomain?: string): void {
  const projectName = `papuyu-${projectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  const envPath = path.join(buildDir, '.env');
  
  const envFlag = fs.existsSync(envPath) ? `--env-file ${envPath}` : '';

  let overrideFlag = '';
  if (port) {
      const serviceName = getComposeService(buildDir, composeFile, envPath);
      // Sanitize projectId for DNS (replace _ with -)
      const safeProjectId = projectId.replace(/_/g, '-');
      const host = subdomain ? `${subdomain}.${config.domain}` : `${safeProjectId}.${config.domain}`;
      const overrideContent = `
version: '3.8'
services:
  ${serviceName}:
    networks:
      - papuyu-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.papuyu-${projectId}.rule=Host(\`${host}\`)"
      - "traefik.http.routers.papuyu-${projectId}.service=papuyu-${projectId}"
      - "traefik.http.routers.papuyu-${projectId}.entrypoints=websecure"
      - "traefik.http.routers.papuyu-${projectId}.tls=true"
      - "traefik.http.routers.papuyu-${projectId}.tls.certresolver=myresolver"
      - "traefik.http.services.papuyu-${projectId}.loadbalancer.server.port=${port}"
      - "traefik.docker.network=papuyu-network"

networks:
  papuyu-network:
    external: true
`;
      const overridePath = path.join(buildDir, 'docker-compose.override.yml');
      fs.writeFileSync(overridePath, overrideContent);
      overrideFlag = `-f ${overridePath}`;
      console.log(`Generated override file for service ${serviceName} with Traefik labels`);
  }

  execSync(
    `docker compose -p ${projectName} -f ${filePath} ${overrideFlag} ${envFlag} up -d --build`,
    { timeout: 600_000, stdio: 'pipe' }
  );
}

export function composeDown(projectId: string, buildDir: string, composeFile: string): void {
  const projectName = `papuyu-${projectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  // Down first to remove network and containers
  try {
    execSync(
        `docker compose -p ${projectName} -f ${filePath} down --rmi all --volumes --remove-orphans`,
        { timeout: 60_000, stdio: 'pipe' }
    );
  } catch (e) {
    console.warn(`Compose down failed, trying to force cleanup`, e);
    // Force cleanup if down fails (e.g. file deleted)
    try {
        const containers = execSync(`docker ps -a -q --filter "label=com.docker.compose.project=${projectName}"`).toString().trim().split('\n');
        if (containers.length > 0 && containers[0] !== '') {
            execSync(`docker rm -f ${containers.join(' ')}`);
        }
    } catch {}
  }
}

export function composeStop(projectId: string, buildDir: string, composeFile: string): void {
  const projectName = `papuyu-${projectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  execSync(
    `docker compose -p ${projectName} -f ${filePath} stop`,
    { timeout: 60_000, stdio: 'pipe' }
  );
}

export function composeRestart(projectId: string, buildDir: string, composeFile: string): void {
  const projectName = `papuyu-${projectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  execSync(
    `docker compose -p ${projectName} -f ${filePath} restart`,
    { timeout: 60_000, stdio: 'pipe' }
  );
}

export function getComposeLogs(projectId: string, buildDir: string, composeFile: string, tail = 100): string {
  const projectName = `papuyu-${projectId}`.toLowerCase();
  const filePath = resolveComposeFile(buildDir, composeFile);
  
  return execSync(
    `docker compose -p ${projectName} -f ${filePath} logs --tail ${tail}`,
    { timeout: 10_000 }
  ).toString();
}
