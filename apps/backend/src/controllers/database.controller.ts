import { Response } from 'express';
import { customAlphabet } from 'nanoid';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config/env';
import {
  buildManagedDatabaseContainerName,
  buildManagedDatabaseVolumeName,
  provisionManagedMysqlDatabase,
  removeManagedDatabase,
  SHARED_DATABASE_NETWORK,
  waitForManagedDatabaseHealthy,
} from '../services/managed-db.service';
import { decryptSecret, encryptSecret, generateRandomSecret } from '../utils/secrets';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6);

const DATABASE_PUBLIC_COLUMNS = `
  managed_databases.id as id,
  managed_databases.name as name,
  managed_databases.engine as engine,
  managed_databases.version as version,
  managed_databases.db_name as db_name,
  managed_databases.username as username,
  managed_databases.host as host,
  managed_databases.port as port,
  managed_databases.public_access_enabled as public_access_enabled,
  managed_databases.public_subdomain as public_subdomain,
  managed_databases.public_port as public_port,
  managed_databases.public_tls_enabled as public_tls_enabled,
  managed_databases.public_allowed_ips as public_allowed_ips,
  managed_databases.status as status,
  managed_databases.user_id as user_id,
  managed_databases.created_at as created_at,
  users.email as owner_email,
  (
    SELECT COUNT(*)
    FROM project_database_attachments
    WHERE project_database_attachments.database_id = managed_databases.id
  ) as attachment_count
`;

function normalizeDatabaseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function normalizePublicSubdomain(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function isValidPublicSubdomain(value: string): boolean {
  return /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?$/.test(value);
}

function resolvePublicHost(subdomain?: string | null): string | null {
  if (!subdomain) {
    return null;
  }

  return subdomain.includes('.') ? subdomain : `${subdomain}.${config.domain}`;
}

function validatePublicAccessSettings(options: {
  databaseId?: string;
  publicAccessEnabled: boolean;
  publicSubdomain?: string | null;
  publicAllowedIps?: unknown;
}) {
  const { databaseId, publicAccessEnabled, publicSubdomain, publicAllowedIps } = options;
  const normalizedPublicSubdomain = publicAccessEnabled ? normalizePublicSubdomain(String(publicSubdomain || '')) : null;
  const allowedIps = publicAccessEnabled ? parseAllowedIps(publicAllowedIps) : [];

  if (publicAccessEnabled) {
    if (!normalizedPublicSubdomain || !isValidPublicSubdomain(normalizedPublicSubdomain)) {
      return { error: 'Valid public_subdomain is required when public access is enabled' };
    }

    const existingProject = db.prepare('SELECT id FROM projects WHERE subdomain = ?').get(normalizedPublicSubdomain) as any;
    if (existingProject) {
      return { error: 'Public subdomain is already used by a project' };
    }

    const existingDatabase = databaseId
      ? db.prepare('SELECT id FROM managed_databases WHERE public_subdomain = ? AND id != ?').get(normalizedPublicSubdomain, databaseId) as any
      : db.prepare('SELECT id FROM managed_databases WHERE public_subdomain = ?').get(normalizedPublicSubdomain) as any;

    if (existingDatabase) {
      return { error: 'Public subdomain is already used by another managed database' };
    }
  }

  return {
    normalizedPublicSubdomain,
    publicHost: resolvePublicHost(normalizedPublicSubdomain),
    allowedIps,
  };
}

function parseAllowedIps(value: unknown): string[] {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join('\n') : String(value);
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeAllowedIps(entries: string[]): string | null {
  return entries.length > 0 ? entries.join(',') : null;
}

function withComputedPublicFields<T extends Record<string, any>>(database: T): T & { public_host: string | null } {
  return {
    ...database,
    public_access_enabled: Boolean(database.public_access_enabled),
    public_tls_enabled: database.public_tls_enabled == null ? true : Boolean(database.public_tls_enabled),
    public_allowed_ips_list: parseAllowedIps(database.public_allowed_ips),
    public_host: resolvePublicHost(database.public_subdomain),
  };
}

function getDatabaseForUser(databaseId: string, userId: number, userRole?: string) {
  if (userRole === 'admin') {
    return db
      .prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id WHERE managed_databases.id = ?`)
      .get(databaseId) as any;
  }

  return db
    .prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id WHERE managed_databases.id = ? AND managed_databases.user_id = ?`)
    .get(databaseId, userId) as any;
}

function getProjectForUser(projectId: string, userId: number, userRole?: string) {
  if (userRole === 'admin') {
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  }

  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as any;
}

function getManagedDatabaseRowForUser(databaseId: string, userId: number, userRole?: string) {
  if (userRole === 'admin') {
    return db.prepare('SELECT * FROM managed_databases WHERE id = ?').get(databaseId) as any;
  }

  return db.prepare('SELECT * FROM managed_databases WHERE id = ? AND user_id = ?').get(databaseId, userId) as any;
}

function getAttachmentsByDatabaseIds(databaseIds: string[]) {
  if (databaseIds.length === 0) {
    return new Map<string, any[]>();
  }

  const placeholders = databaseIds.map(() => '?').join(', ');
  const attachments = db.prepare(`
    SELECT
      project_database_attachments.database_id as database_id,
      project_database_attachments.id as id,
      project_database_attachments.alias as alias,
      projects.id as project_id,
      projects.name as project_name
    FROM project_database_attachments
    INNER JOIN projects ON projects.id = project_database_attachments.project_id
    WHERE project_database_attachments.database_id IN (${placeholders})
    ORDER BY project_database_attachments.created_at DESC
  `).all(...databaseIds) as any[];

  const attachmentsByDatabaseId = new Map<string, any[]>();
  for (const attachment of attachments) {
    const list = attachmentsByDatabaseId.get(attachment.database_id) || [];
    list.push({
      id: attachment.id,
      alias: attachment.alias,
      project_id: attachment.project_id,
      project_name: attachment.project_name,
    });
    attachmentsByDatabaseId.set(attachment.database_id, list);
  }

  return attachmentsByDatabaseId;
}

export function listManagedDatabases(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const userRole = req.userRole;

  const rows = userRole === 'admin'
    ? db.prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id ORDER BY managed_databases.created_at DESC`).all()
    : db.prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id WHERE managed_databases.user_id = ? ORDER BY managed_databases.created_at DESC`).all(userId);

  const attachmentsByDatabaseId = getAttachmentsByDatabaseIds(rows.map((row: any) => row.id));
  res.json(rows.map((row: any) => ({
    ...withComputedPublicFields(row),
    attachments: attachmentsByDatabaseId.get(row.id) || [],
  })));
}

export function getManagedDatabase(req: AuthRequest, res: Response) {
  const database = getDatabaseForUser(req.params.id, req.userId!, req.userRole);
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  const attachments = getAttachmentsByDatabaseIds([req.params.id]).get(req.params.id) || [];

  res.json({ ...withComputedPublicFields(database), attachments });
}

export function createManagedDatabase(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const {
    name,
    engine = 'mysql',
    version = '8.0',
    db_name,
    username,
    public_access_enabled,
    public_subdomain,
    public_allowed_ips,
  } = req.body || {};

  if (!name || !db_name || !username) {
    return res.status(400).json({ error: 'name, db_name, and username are required' });
  }

  if (engine !== 'mysql') {
    return res.status(400).json({ error: 'Only mysql is supported in phase 1' });
  }

  const normalizedName = normalizeDatabaseName(String(name));
  if (!normalizedName) {
    return res.status(400).json({ error: 'Invalid database name' });
  }

  const publicAccessEnabled = Boolean(public_access_enabled);
  const publicAccessValidation = validatePublicAccessSettings({
    publicAccessEnabled,
    publicSubdomain: public_subdomain,
    publicAllowedIps: public_allowed_ips,
  });
  if ('error' in publicAccessValidation) {
    const message = publicAccessValidation.error || 'Invalid public access settings';
    return res.status(message.includes('already used') ? 409 : 400).json({ error: message });
  }
  const normalizedPublicSubdomain = publicAccessValidation.normalizedPublicSubdomain;

  const databaseId = `db_${nanoid()}`;
  const rootPassword = generateRandomSecret(28);
  const userPassword = generateRandomSecret(24);
  const containerName = buildManagedDatabaseContainerName(databaseId);
  const volumeName = buildManagedDatabaseVolumeName(databaseId);
  const host = containerName;
  const publicHost = publicAccessValidation.publicHost;

  try {
    db.prepare(`
      INSERT INTO managed_databases (
        id, name, engine, version, db_name, username, encrypted_password, root_password,
        host, port, container_name, volume_name, network_name, public_access_enabled, public_subdomain,
        public_port, public_tls_enabled, public_allowed_ips, status, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      databaseId,
      normalizedName,
      engine,
      String(version),
      String(db_name),
      String(username),
      encryptSecret(userPassword),
      encryptSecret(rootPassword),
      host,
      3306,
      containerName,
      volumeName,
      SHARED_DATABASE_NETWORK,
      publicAccessEnabled ? 1 : 0,
      normalizedPublicSubdomain,
      config.traefikMysqlPublicPort,
      1,
      serializeAllowedIps(publicAccessValidation.allowedIps),
      'provisioning',
      userId
    );

    const created = getDatabaseForUser(databaseId, userId, req.userRole);
    res.status(201).json({
      ...withComputedPublicFields(created),
      credentials: {
        host,
        port: 3306,
        database: String(db_name),
        username: String(username),
        password: userPassword,
      },
      public_credentials: publicAccessEnabled && publicHost ? {
        host: publicHost,
        port: config.traefikMysqlPublicPort,
        tls_required: true,
        allowed_ips: publicAccessValidation.allowedIps,
      } : null,
    });

    void (async () => {
      try {
        await provisionManagedMysqlDatabase({
          version: String(version),
          dbName: String(db_name),
          username: String(username),
          userPassword,
          rootPassword,
          containerName,
          volumeName,
          networkName: SHARED_DATABASE_NETWORK,
          publicAccessEnabled,
          publicHost,
          publicAllowedIps: publicAccessValidation.allowedIps,
        });
        await waitForManagedDatabaseHealthy(containerName);
        db.prepare('UPDATE managed_databases SET status = ? WHERE id = ?').run('running', databaseId);
      } catch (error: any) {
        console.error(`Managed database provisioning failed for ${databaseId}:`, error);
        db.prepare('UPDATE managed_databases SET status = ? WHERE id = ?').run('failed', databaseId);
      }
    })();

    return;
  } catch (error: any) {
    db.prepare('UPDATE managed_databases SET status = ? WHERE id = ?').run('failed', databaseId);
    return res.status(500).json({ error: error.message || 'Failed to create managed database' });
  }
}

export function updateManagedDatabasePublicAccess(req: AuthRequest, res: Response) {
  const database = getManagedDatabaseRowForUser(req.params.id, req.userId!, req.userRole);
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  if (database.engine !== 'mysql') {
    return res.status(400).json({ error: 'Public access update is only supported for mysql in this phase' });
  }

  const publicAccessEnabled = Boolean(req.body?.public_access_enabled);
  const validation = validatePublicAccessSettings({
    databaseId: req.params.id,
    publicAccessEnabled,
    publicSubdomain: req.body?.public_subdomain,
    publicAllowedIps: req.body?.public_allowed_ips,
  });
  if ('error' in validation) {
    const message = validation.error || 'Invalid public access settings';
    return res.status(message.includes('already used') ? 409 : 400).json({ error: message });
  }

  db.prepare(`
    UPDATE managed_databases
    SET public_access_enabled = ?, public_subdomain = ?, public_port = ?, public_tls_enabled = ?, public_allowed_ips = ?, status = ?
    WHERE id = ?
  `).run(
    publicAccessEnabled ? 1 : 0,
    validation.normalizedPublicSubdomain,
    config.traefikMysqlPublicPort,
    1,
    serializeAllowedIps(validation.allowedIps),
    'provisioning',
    req.params.id
  );

  const updated = getDatabaseForUser(req.params.id, req.userId!, req.userRole);
  res.json(withComputedPublicFields(updated));

  void (async () => {
    try {
      await provisionManagedMysqlDatabase({
        version: String(database.version),
        dbName: String(database.db_name),
        username: String(database.username),
        userPassword: decryptSecret(database.encrypted_password),
        rootPassword: decryptSecret(database.root_password),
        containerName: database.container_name,
        volumeName: database.volume_name,
        networkName: database.network_name || SHARED_DATABASE_NETWORK,
        publicAccessEnabled,
        publicHost: validation.publicHost,
        publicAllowedIps: validation.allowedIps,
      });
      await waitForManagedDatabaseHealthy(database.container_name);
      db.prepare('UPDATE managed_databases SET status = ? WHERE id = ?').run('running', req.params.id);
    } catch (error: any) {
      console.error(`Managed database public access update failed for ${req.params.id}:`, error);
      db.prepare('UPDATE managed_databases SET status = ? WHERE id = ?').run('failed', req.params.id);
    }
  })();
}

export function attachManagedDatabase(req: AuthRequest, res: Response) {
  const { project_id, alias = 'primary' } = req.body || {};
  if (!project_id) {
    return res.status(400).json({ error: 'project_id is required' });
  }

  const database = getDatabaseForUser(req.params.id, req.userId!, req.userRole);
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  const project = getProjectForUser(String(project_id), req.userId!, req.userRole);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const normalizedAlias = String(alias).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').slice(0, 32) || 'primary';

  try {
    db.prepare(`
      INSERT INTO project_database_attachments (project_id, database_id, alias)
      VALUES (?, ?, ?)
    `).run(String(project_id), req.params.id, normalizedAlias);
  } catch (error: any) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Database already attached to this project' });
    }

    return res.status(500).json({ error: 'Failed to attach database to project' });
  }

  res.json({
    ok: true,
    env_preview: {
      DB_HOST: database.host,
      DB_PORT: String(database.port),
      DB_NAME: database.db_name,
      DB_USER: database.username,
      DB_PASSWORD: decryptSecret(
        (db.prepare('SELECT encrypted_password FROM managed_databases WHERE id = ?').get(req.params.id) as any).encrypted_password
      ),
    }
  });
}

export function detachManagedDatabase(req: AuthRequest, res: Response) {
  const database = getDatabaseForUser(req.params.id, req.userId!, req.userRole);
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  const { project_id } = req.body || {};
  if (!project_id) {
    return res.status(400).json({ error: 'project_id is required' });
  }

  const project = getProjectForUser(String(project_id), req.userId!, req.userRole);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  db.prepare('DELETE FROM project_database_attachments WHERE database_id = ? AND project_id = ?').run(req.params.id, String(project_id));
  res.json({ ok: true });
}

export function deleteManagedDatabase(req: AuthRequest, res: Response) {
  const database = db.prepare('SELECT * FROM managed_databases WHERE id = ?').get(req.params.id) as any;
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  if (req.userRole !== 'admin' && database.user_id !== req.userId) {
    return res.status(404).json({ error: 'Database not found' });
  }

  const attachmentCount = db.prepare('SELECT COUNT(*) as count FROM project_database_attachments WHERE database_id = ?').get(req.params.id) as any;
  if (attachmentCount.count > 0) {
    return res.status(400).json({ error: 'Detach the database from all projects before deleting it' });
  }

  try {
    removeManagedDatabase(database.container_name, database.volume_name);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to remove managed database container' });
  }

  db.prepare('DELETE FROM managed_databases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}
