-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hashed
  role        TEXT DEFAULT 'user',     -- 'admin' | 'client' | 'user'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,      -- nanoid, e.g. 'prj_a1b2c3'
  name            TEXT NOT NULL,
  git_repository  TEXT NOT NULL,
  branch          TEXT DEFAULT 'main',
  project_type    TEXT DEFAULT 'dockerfile', -- 'dockerfile' | 'compose'
  dockerfile_path TEXT DEFAULT 'Dockerfile',
  dockerfile_source TEXT DEFAULT 'repo', -- 'repo' | 'upload' | 'textarea'
  dockerfile_content TEXT,               -- optional custom Dockerfile content
  compose_file    TEXT DEFAULT 'docker-compose.yml',
  compose_source  TEXT DEFAULT 'repo',   -- 'repo' | 'upload' | 'textarea'
  compose_content TEXT,                  -- optional custom compose content
  port            INTEGER DEFAULT 3000,
  env_vars        TEXT,                  -- JSON stringified: [{"key": "DB_HOST", "value": "localhost"}]
  subdomain       TEXT UNIQUE,           -- Custom subdomain (optional)
  waf_enabled     INTEGER DEFAULT 0,     -- Web Application Firewall (0 = false, 1 = true)
  container_id    TEXT,                  -- Docker container ID
  status          TEXT DEFAULT 'idle',   -- idle | building | running | stopped | failed
  user_id         INTEGER NOT NULL,
  ram_limit       INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS waf_events (
  id              TEXT PRIMARY KEY,
  timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address      TEXT,
  domain          TEXT,
  attack_type     TEXT,
  url             TEXT,
  action          TEXT
);

-- Deployment logs table
CREATE TABLE IF NOT EXISTS deployment_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  message     TEXT NOT NULL,
  level       TEXT DEFAULT 'info',     -- info | warn | error
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS managed_databases (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  engine              TEXT NOT NULL,              -- mysql
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
  public_access_enabled INTEGER DEFAULT 0,
  public_subdomain    TEXT,
  public_port         INTEGER DEFAULT 3306,
  public_tls_enabled  INTEGER DEFAULT 1,
  public_allowed_ips  TEXT,
  status              TEXT DEFAULT 'provisioning', -- provisioning | running | failed | stopped
  user_id             INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_databases_public_subdomain
ON managed_databases(public_subdomain)
WHERE public_subdomain IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_database_attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  database_id  TEXT NOT NULL,
  alias        TEXT DEFAULT 'primary',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, database_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (database_id) REFERENCES managed_databases(id) ON DELETE CASCADE
);
