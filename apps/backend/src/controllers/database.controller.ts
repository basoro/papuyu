import { Response } from 'express';
import { customAlphabet } from 'nanoid';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
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

export function listManagedDatabases(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const userRole = req.userRole;

  const rows = userRole === 'admin'
    ? db.prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id ORDER BY managed_databases.created_at DESC`).all()
    : db.prepare(`SELECT ${DATABASE_PUBLIC_COLUMNS} FROM managed_databases LEFT JOIN users ON users.id = managed_databases.user_id WHERE managed_databases.user_id = ? ORDER BY managed_databases.created_at DESC`).all(userId);

  res.json(rows);
}

export function getManagedDatabase(req: AuthRequest, res: Response) {
  const database = getDatabaseForUser(req.params.id, req.userId!, req.userRole);
  if (!database) {
    return res.status(404).json({ error: 'Database not found' });
  }

  const attachments = db.prepare(`
    SELECT project_database_attachments.id, project_database_attachments.alias, projects.id as project_id, projects.name as project_name
    FROM project_database_attachments
    INNER JOIN projects ON projects.id = project_database_attachments.project_id
    WHERE project_database_attachments.database_id = ?
    ORDER BY project_database_attachments.created_at DESC
  `).all(req.params.id);

  res.json({ ...database, attachments });
}

export function createManagedDatabase(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const { name, engine = 'mysql', version = '8.0', db_name, username } = req.body || {};

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

  const databaseId = `db_${nanoid()}`;
  const rootPassword = generateRandomSecret(28);
  const userPassword = generateRandomSecret(24);
  const containerName = buildManagedDatabaseContainerName(databaseId);
  const volumeName = buildManagedDatabaseVolumeName(databaseId);
  const host = containerName;

  try {
    db.prepare(`
      INSERT INTO managed_databases (
        id, name, engine, version, db_name, username, encrypted_password, root_password,
        host, port, container_name, volume_name, network_name, status, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      'provisioning',
      userId
    );

    const created = getDatabaseForUser(databaseId, userId, req.userRole);
    res.status(201).json({
      ...created,
      credentials: {
        host,
        port: 3306,
        database: String(db_name),
        username: String(username),
        password: userPassword,
      }
    });

    void (async () => {
      try {
        await provisionManagedMysqlDatabase({
          id: databaseId,
          version: String(version),
          dbName: String(db_name),
          username: String(username),
          userPassword,
          rootPassword,
          containerName,
          volumeName,
          networkName: SHARED_DATABASE_NETWORK,
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
