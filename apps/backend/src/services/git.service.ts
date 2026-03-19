import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const BUILD_DIR = process.env.BUILD_DIR || '/tmp/papuyu-builds';

export function cloneRepository(
  projectId: string,
  gitUrl: string,
  branch: string,
  onLog?: (msg: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const targetDir = path.join(BUILD_DIR, projectId);

    // Cleanup previous build
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const proc = spawn('git', ['clone', '--branch', branch, '--depth', '1', gitUrl, targetDir]);

    proc.stdout?.on('data', (data) => {
      if (onLog) {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => onLog(line));
      }
    });

    proc.stderr?.on('data', (data) => {
      if (onLog) {
        data.toString().split('\n').filter(Boolean).forEach((line: string) => onLog(line));
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(targetDir);
      } else {
        reject(new Error(`Git clone failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
