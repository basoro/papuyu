import { execFileSync } from 'child_process';
import { canonicalId } from './docker.service';

export const SHARED_DATABASE_NETWORK = 'papuyu-services-network';

function runDocker(args: string[], timeout = 60_000): string {
  return execFileSync('docker', args, {
    timeout,
    stdio: 'pipe'
  }).toString();
}

export function buildManagedDatabaseContainerName(id: string): string {
  return `papuyu-db-${canonicalId(id)}`;
}

export function buildManagedDatabaseVolumeName(id: string): string {
  return `papuyu-db-data-${canonicalId(id)}`;
}

export function ensureSharedDatabaseNetwork(networkName = SHARED_DATABASE_NETWORK) {
  try {
    runDocker(['network', 'inspect', networkName], 15_000);
  } catch {
    runDocker(['network', 'create', networkName], 30_000);
  }
}

function ensureVolume(volumeName: string) {
  try {
    runDocker(['volume', 'inspect', volumeName], 15_000);
  } catch {
    runDocker(['volume', 'create', volumeName], 30_000);
  }
}

export function provisionManagedMysqlDatabase(options: {
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

  ensureSharedDatabaseNetwork(networkName);
  ensureVolume(volumeName);

  try {
    runDocker(['rm', '-f', containerName], 30_000);
  } catch {}

  runDocker([
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

export function waitForManagedDatabaseHealthy(containerName: string, timeoutMs = 120_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = runDocker([
        'inspect',
        '-f',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        containerName
      ], 15_000).trim();

      if (health === 'healthy' || health === 'running') {
        return;
      }

      if (health === 'unhealthy' || health === 'exited' || health === 'dead') {
        throw new Error(`Managed database container became ${health}`);
      }
    } catch (error) {
      throw error;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
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
