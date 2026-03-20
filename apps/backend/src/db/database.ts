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

console.log(`Database connected at ${dbPath}`);

export default db;
