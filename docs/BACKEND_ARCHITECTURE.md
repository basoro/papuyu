# Papuyu — Backend & Docker Architecture

## Overview

Papuyu adalah mini PaaS (Platform as a Service) self-hosted yang memungkinkan user men-deploy aplikasi dari Git repository menggunakan Docker container. Dokumen ini menjelaskan arsitektur backend dan Docker logic secara detail.

---

## 1. Tech Stack Backend

| Komponen       | Teknologi         |
|----------------|-------------------|
| Runtime        | Node.js 20+       |
| Framework      | Express.js        |
| Database       | SQLite (via better-sqlite3) |
| Auth           | JWT (jsonwebtoken) |
| Container      | Docker CLI / dockerode |
| Password Hash  | bcrypt             |

---

## 2. Struktur Folder Backend

```
apps/backend/
├── src/
│   ├── index.ts              # Entry point, Express app setup
│   ├── config/
│   │   └── env.ts            # Environment variables
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification middleware
│   │   └── admin.ts          # Admin role guard
│   ├── routes/
│   │   ├── auth.routes.ts    # POST /auth/login, /auth/register
│   │   ├── project.routes.ts # CRUD /projects
│   │   ├── deploy.routes.ts  # POST /deploy/:projectId
│   │   ├── logs.routes.ts    # GET /logs/:projectId
│   │   └── user.routes.ts    # GET /users (admin only)
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── project.controller.ts
│   │   ├── deploy.controller.ts
│   │   └── user.controller.ts
│   ├── services/
│   │   ├── docker.service.ts # Docker build & run logic
│   │   └── git.service.ts    # Git clone logic
│   ├── db/
│   │   ├── database.ts       # SQLite connection
│   │   └── schema.sql        # Table definitions
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 3. Database Schema (SQLite)

```sql
-- Users table
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hashed
  role        TEXT DEFAULT 'user',     -- 'admin' | 'user'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,      -- nanoid, e.g. 'prj_a1b2c3'
  name            TEXT NOT NULL,
  git_repository  TEXT NOT NULL,
  branch          TEXT DEFAULT 'main',
  dockerfile_path TEXT DEFAULT 'Dockerfile',
  port            INTEGER DEFAULT 3000,
  container_id    TEXT,                  -- Docker container ID
  status          TEXT DEFAULT 'idle',   -- idle | building | running | stopped | failed
  user_id         INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Deployment logs table
CREATE TABLE deployment_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  message     TEXT NOT NULL,
  level       TEXT DEFAULT 'info',     -- info | warn | error
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

---

## 4. API Endpoints

### Authentication

| Method | Endpoint          | Body                          | Response              |
|--------|-------------------|-------------------------------|-----------------------|
| POST   | `/auth/register`  | `{ email, password }`         | `{ token, user }`     |
| POST   | `/auth/login`     | `{ email, password }`         | `{ token, user }`     |

### Projects (JWT required)

| Method | Endpoint          | Description                    |
|--------|-------------------|--------------------------------|
| GET    | `/projects`       | List user's projects           |
| POST   | `/projects`       | Create project                 |
| GET    | `/projects/:id`   | Get project detail             |
| DELETE | `/projects/:id`   | Delete project + stop container|

### Deployment (JWT required)

| Method | Endpoint              | Description             |
|--------|-----------------------|-------------------------|
| POST   | `/deploy/:projectId`  | Build & run container   |
| POST   | `/restart/:projectId` | Restart container       |
| POST   | `/stop/:projectId`    | Stop container          |
| GET    | `/logs/:projectId`    | Get container logs      |

### Users (Admin only)

| Method | Endpoint          | Description              |
|--------|-------------------|--------------------------|
| GET    | `/users`          | List all users           |
| DELETE | `/users/:id`      | Delete user              |

---

## 5. Deployment Workflow (Docker Logic)

Berikut adalah alur lengkap saat user menekan tombol **Deploy**:

```
User clicks "Deploy"
        │
        ▼
┌─────────────────────┐
│ 1. UPDATE status     │  project.status = 'building'
│    to 'building'     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 2. CLONE repository │  git clone --branch {branch} --depth 1 {git_repository}
│                     │  → /tmp/papuyu-builds/{project_id}/
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 3. BUILD image      │  docker build -t papuyu-{project_id}:latest
│                     │  -f {dockerfile_path} .
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 4. RUN container    │  docker run -d
│                     │  --name papuyu-{project_id}
│                     │  -p {port}:{port}
│                     │  papuyu-{project_id}:latest
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 5. SAVE state       │  container_id → database
│                     │  status = 'running'
└─────────────────────┘
```

### 5.1 Git Clone Service

```typescript
// services/git.service.ts
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const BUILD_DIR = '/tmp/papuyu-builds';

export function cloneRepository(
  projectId: string,
  gitUrl: string,
  branch: string
): string {
  const targetDir = path.join(BUILD_DIR, projectId);

  // Cleanup previous build
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true });
  }

  fs.mkdirSync(targetDir, { recursive: true });

  execSync(
    `git clone --branch ${branch} --depth 1 ${gitUrl} ${targetDir}`,
    { timeout: 60_000 }
  );

  return targetDir;
}
```

### 5.2 Docker Service

```typescript
// services/docker.service.ts
import { execSync } from 'child_process';

export function buildImage(projectId: string, buildDir: string, dockerfilePath: string): void {
  const imageName = `papuyu-${projectId}:latest`;
  execSync(
    `docker build -t ${imageName} -f ${dockerfilePath} ${buildDir}`,
    { timeout: 300_000, stdio: 'pipe' }
  );
}

export function runContainer(projectId: string, port: number): string {
  const imageName = `papuyu-${projectId}:latest`;
  const containerName = `papuyu-${projectId}`;

  // Stop & remove existing container if any
  try { execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' }); } catch {}

  const output = execSync(
    `docker run -d --name ${containerName} -p ${port}:${port} ${imageName}`,
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
```

### 5.3 Deploy Controller

```typescript
// controllers/deploy.controller.ts
import { Request, Response } from 'express';
import db from '../db/database';
import { cloneRepository } from '../services/git.service';
import { buildImage, runContainer } from '../services/docker.service';

export async function deployProject(req: Request, res: Response) {
  const { projectId } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Update status
  db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('building', projectId);
  logMessage(projectId, `Cloning ${project.git_repository}...`);

  try {
    // Step 1: Clone
    const buildDir = cloneRepository(projectId, project.git_repository, project.branch);
    logMessage(projectId, 'Repository cloned successfully');

    // Step 2: Build
    logMessage(projectId, `Building Docker image papuyu-${projectId}:latest...`);
    buildImage(projectId, buildDir, project.dockerfile_path);
    logMessage(projectId, 'Docker image built successfully');

    // Step 3: Run
    logMessage(projectId, `Starting container on port ${project.port}...`);
    const containerId = runContainer(projectId, project.port);
    logMessage(projectId, `Container running: ${containerId.substring(0, 12)}`);

    // Step 4: Save
    db.prepare('UPDATE projects SET status = ?, container_id = ? WHERE id = ?')
      .run('running', containerId.substring(0, 12), projectId);

    res.json({ status: 'running', container_id: containerId.substring(0, 12) });
  } catch (err: any) {
    logMessage(projectId, `Deploy failed: ${err.message}`, 'error');
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('failed', projectId);
    res.status(500).json({ error: err.message });
  }
}

function logMessage(projectId: string, message: string, level = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare('INSERT INTO deployment_logs (project_id, message, level) VALUES (?, ?, ?)')
    .run(projectId, `[${timestamp}] ${message}`, level);
}
```

---

## 6. Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
    ports:
      - "5173:80"
    depends_on:
      - backend
    environment:
      - VITE_API_URL=http://localhost:4000

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    ports:
      - "4000:4000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker access
      - papuyu-data:/app/data                        # SQLite persistence
      - /tmp/papuyu-builds:/tmp/papuyu-builds          # Build directory
    environment:
      - PORT=4000
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/app/data/papuyu.db
      - NODE_ENV=production

volumes:
  papuyu-data:
```

### Frontend Dockerfile

```dockerfile
# apps/frontend/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### Backend Dockerfile

```dockerfile
# apps/backend/Dockerfile
FROM node:20-alpine
RUN apk add --no-cache git docker-cli
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

---

## 7. Environment Variables

```env
# .env.example
PORT=4000
JWT_SECRET=your-super-secret-key-change-in-production
DB_PATH=./data/papuyu.db
NODE_ENV=development
```

---

## 8. JWT Auth Middleware

```typescript
// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as any;
    req.userId = payload.id;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// middleware/admin.ts
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
```

---

## 9. Security Considerations

| Concern                  | Mitigation                                         |
|--------------------------|----------------------------------------------------|
| Docker socket exposure   | Backend container mounts `/var/run/docker.sock` — **host-level access**. Restrict in production with Docker socket proxy (e.g., Tecnativa/docker-socket-proxy). |
| Git URL injection        | Validate & sanitize `git_repository` input. Only allow `https://` URLs. |
| Port conflicts           | Track allocated ports in DB. Validate port range (1024–65535). |
| Resource limits          | Use `--memory` and `--cpus` flags on `docker run`. |
| Build timeout            | Set `execSync` timeout to prevent hanging builds.  |
| JWT secret               | Use strong random secret. Never commit to repo.    |

---

## 10. Cara Menjalankan

```bash
# 1. Clone repo
git clone https://github.com/basoro/papuyu.git
cd papuyu

# 2. Copy environment file
cp .env.example .env
# Edit .env — set JWT_SECRET

# 3. Jalankan dengan Docker Compose
docker compose up -d

# 4. Akses aplikasi
# Frontend: http://localhost:5173
# Backend:  http://localhost:4000

# 5. Default admin account
# Email:    admin@papuyu.dev
# Password: admin123
```

---

## 11. Roadmap Pengembangan

- [ ] **Queue system** — Bull/BullMQ untuk async build
- [ ] **WebSocket logs** — Real-time container log streaming
- [ ] **Custom domains** — Reverse proxy (Traefik/Caddy) per project
- [ ] **Environment variables** — Per-project env config
- [ ] **Health checks** — Auto-restart unhealthy containers
- [ ] **Multi-node** — Docker Swarm / Kubernetes orchestration
- [ ] **GitHub webhooks** — Auto-deploy on push
- [ ] **Build cache** — Docker layer caching untuk build lebih cepat
