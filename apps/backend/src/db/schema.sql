-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hashed
  role        TEXT DEFAULT 'user',     -- 'admin' | 'user'
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
  compose_file    TEXT DEFAULT 'docker-compose.yml',
  port            INTEGER DEFAULT 3000,
  env_vars        TEXT,                  -- JSON stringified: [{"key": "DB_HOST", "value": "localhost"}]
  subdomain       TEXT UNIQUE,           -- Custom subdomain (optional)
  waf_enabled     INTEGER DEFAULT 0,     -- Web Application Firewall (0 = false, 1 = true)
  container_id    TEXT,                  -- Docker container ID
  status          TEXT DEFAULT 'idle',   -- idle | building | running | stopped | failed
  user_id         INTEGER NOT NULL,
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
