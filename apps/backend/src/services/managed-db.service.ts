import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { canonicalId } from './docker.service';

export const SHARED_DATABASE_NETWORK = 'papuyu-services-network';
const execFileAsync = promisify(execFile);

function runDocker(args: string[], timeout = 60_000): string {
  return execFileSync('docker', args, {
    timeout,
    stdio: 'pipe'
  }).toString();
}

async function runDockerAsync(args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, {
    timeout,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

export function buildManagedDatabaseContainerName(id: string): string {
  return `papuyu-db-${canonicalId(id)}`;
}

export function buildManagedDatabaseVolumeName(id: string): string {
  return `papuyu-db-data-${canonicalId(id)}`;
}

export async function ensureSharedDatabaseNetwork(networkName = SHARED_DATABASE_NETWORK) {
  try {
    await runDockerAsync(['network', 'inspect', networkName], 15_000);
  } catch {
    await runDockerAsync(['network', 'create', networkName], 30_000);
  }
}

async function ensureVolume(volumeName: string) {
  try {
    await runDockerAsync(['volume', 'inspect', volumeName], 15_000);
  } catch {
    await runDockerAsync(['volume', 'create', volumeName], 30_000);
  }
}

export async function provisionManagedMysqlDatabase(options: {
  id: string;
  version: string;
  dbName: string;
  username: string;
  userPassword: string;
  rootPassword: string;
  containerName: string;
  volumeName: string;
  networkName?: string;
}) {
  const {
    version,
    dbName,
    username,
    userPassword,
    rootPassword,
    containerName,
    volumeName,
    networkName = SHARED_DATABASE_NETWORK,
  } = options;

  await ensureSharedDatabaseNetwork(networkName);
  await ensureVolume(volumeName);

  try {
    await runDockerAsync(['rm', '-f', containerName], 30_000);
  } catch {}

  await runDockerAsync([
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    networkName,
    '--network-alias',
    containerName,
    '-e',
    `MYSQL_ROOT_PASSWORD=${rootPassword}`,
    '-e',
    `MYSQL_DATABASE=${dbName}`,
    '-e',
    `MYSQL_USER=${username}`,
    '-e',
    `MYSQL_PASSWORD=${userPassword}`,
    '--health-cmd',
    `mysqladmin ping -h 127.0.0.1 -p${rootPassword} || exit 1`,
    '--health-interval',
    '10s',
    '--health-timeout',
    '5s',
    '--health-retries',
    '12',
    '--health-start-period',
    '40s',
    '-v',
    `${volumeName}:/var/lib/mysql`,
    `mysql:${version}`,
    '--default-authentication-plugin=mysql_native_password',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
    '--skip-name-resolve',
    '--max_connections=200'
  ], 120_000);
}

export async function waitForManagedDatabaseHealthy(containerName: string, timeoutMs = 120_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = (await runDockerAsync([
        'inspect',
        '-f',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        containerName
      ], 15_000)).trim();

      if (health === 'healthy' || health === 'running') {
        return;
      }

      if (health === 'unhealthy' || health === 'exited' || health === 'dead') {
        throw new Error(`Managed database container became ${health}`);
      }
    } catch (error) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error('Timed out while waiting for managed database to become healthy');
}

export function removeManagedDatabase(containerName: string, volumeName: string) {
  try {
    runDocker(['rm', '-f', containerName], 30_000);
  } catch {}

  try {
    runDocker(['volume', 'rm', '-f', volumeName], 30_000);
  } catch {}
}
