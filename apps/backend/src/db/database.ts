import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config/env';

const dbPath = config.dbPath;

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Better performance

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Migration: Add new columns if not exists
try {
  db.prepare("ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT 'dockerfile'").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN compose_file TEXT DEFAULT 'docker-compose.yml'").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN env_vars TEXT").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN dockerfile_source TEXT DEFAULT 'repo'").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN dockerfile_content TEXT").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN compose_source TEXT DEFAULT 'repo'").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE projects ADD COLUMN compose_content TEXT").run();
} catch (e) {}

try {
  // Check if column exists first
  const columns = db.prepare("PRAGMA table_info(projects)").all() as any[];
  const hasSubdomain = columns.some(c => c.name === 'subdomain');
  
  if (!hasSubdomain) {
    console.log('Migrating: Adding subdomain column to projects table');
    db.prepare("ALTER TABLE projects ADD COLUMN subdomain TEXT").run();
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_subdomain ON projects(subdomain)").run();
    console.log('Migration successful: subdomain column added');
  }
} catch (e: any) {
  console.error('Migration failed for subdomain:', e);
}

try {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as any[];
  const hasWafEnabled = columns.some(c => c.name === 'waf_enabled');
  
  if (!hasWafEnabled) {
    console.log('Migrating: Adding waf_enabled column to projects table');
    db.prepare("ALTER TABLE projects ADD COLUMN waf_enabled INTEGER DEFAULT 0").run();
    console.log('Migration successful: waf_enabled column added');
  }
} catch (e: any) {
  console.error('Migration failed for waf_enabled:', e);
}

try {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as any[];
  const hasRamLimit = columns.some(c => c.name === 'ram_limit');
  
  if (!hasRamLimit) {
    console.log('Migrating: Adding ram_limit column to projects table');
    db.prepare("ALTER TABLE projects ADD COLUMN ram_limit INTEGER DEFAULT 0").run();
    console.log('Migration successful: ram_limit column added');
  }
} catch (e: any) {
  console.error('Migration failed for ram_limit:', e);
}

try {
  // Create WAF events table if it doesn't exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS waf_events (
      id              TEXT PRIMARY KEY,
      timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address      TEXT,
      domain          TEXT,
      attack_type     TEXT,
      url             TEXT,
      action          TEXT
    )
  `).run();
} catch (e: any) {
  console.error('Failed to create waf_events table:', e);
}

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS managed_databases (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL UNIQUE,
      engine              TEXT NOT NULL,
      version             TEXT NOT NULL DEFAULT '8.0',
      db_name             TEXT NOT NULL,
      username            TEXT NOT NULL,
      encrypted_password  TEXT NOT NULL,
      root_password       TEXT NOT NULL,
      host                TEXT NOT NULL,
      port                INTEGER NOT NULL DEFAULT 3306,
      container_name      TEXT NOT NULL UNIQUE,
      volume_name         TEXT NOT NULL UNIQUE,
      network_name        TEXT NOT NULL DEFAULT 'papuyu-services-network',
      status              TEXT DEFAULT 'provisioning',
      user_id             INTEGER NOT NULL,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
} catch (e: any) {
  console.error('Failed to create managed_databases table:', e);
}

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS project_database_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id   TEXT NOT NULL,
      database_id  TEXT NOT NULL,
      alias        TEXT DEFAULT 'primary',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, database_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (database_id) REFERENCES managed_databases(id) ON DELETE CASCADE
    )
  `).run();
} catch (e: any) {
  console.error('Failed to create project_database_attachments table:', e);
}

console.log(`Database connected at ${dbPath}`);

export default db;
