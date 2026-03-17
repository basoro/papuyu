import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

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
