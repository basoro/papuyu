import { Request, Response } from 'express';
import si from 'systeminformation';
import { AuthRequest } from '../middleware/auth';
import { execFileSync } from 'child_process';

export async function getSystemStats(req: AuthRequest, res: Response) {
  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);

    res.json({
      cpu_usage: Math.round(cpu.currentLoad),
      memory_usage: Math.round((mem.active / mem.total) * 100),
      memory_total: Math.round(mem.total / 1024 / 1024 / 1024 * 100) / 100, // GB
      memory_used: Math.round(mem.active / 1024 / 1024 / 1024 * 100) / 100, // GB
    });
  } catch (error: any) {
    console.error('System stats error:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
}

export async function getDockerOverview(req: AuthRequest, res: Response) {
  try {
    const [info, images, volumes, containers] = await Promise.all([
      si.dockerInfo(),
      si.dockerImages(true),
      si.dockerVolumes(),
      si.dockerContainers(true)
    ]);

    let networksCount = 0;
    try {
      const networksOut = execFileSync('docker', ['network', 'ls', '-q']).toString();
      networksCount = networksOut.split('\n').filter(Boolean).length;
    } catch (e) {
      // Ignore
    }

    let composeCount = 0;
    try {
      // Try to estimate compose projects based on container labels
      const composeProjects = new Set(
        containers
          .map((c: any) => c.labels?.['com.docker.compose.project'])
          .filter(Boolean)
      );
      composeCount = composeProjects.size;
    } catch (e) {
      // Ignore
    }

    const imagesSize = images.reduce((acc: number, img: any) => acc + (img.size || 0), 0);
    // volumes size is not easily accessible via systeminformation, leaving as 0 or estimate
    
    res.json({
      containers: { total: info.containers || containers.length || 0 },
      compose: { total: composeCount },
      images: { total: images.length, size: imagesSize },
      networks: { total: networksCount },
      volumes: { total: volumes.length },
      registries: { total: 1 } // Hardcoded or dynamic
    });
  } catch (error: any) {
    console.error('Docker overview error:', error);
    res.status(500).json({ error: 'Failed to fetch Docker overview' });
  }
}

export async function getDockerContainers(req: AuthRequest, res: Response) {
  try {
    const containers = await si.dockerContainers(true);
    res.json(containers);
  } catch (error: any) {
    console.error('Docker containers error:', error);
    res.status(500).json({ error: 'Failed to fetch Docker containers' });
  }
}

export async function performContainerAction(req: AuthRequest, res: Response) {
  const { id, action } = req.params;
  try {
    const validActions = ['start', 'stop', 'restart', 'kill', 'rm'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    const args = [action];
    if (action === 'rm') args.push('-f');
    args.push(id);

    execFileSync('docker', args);
    res.json({ message: `Container ${id} ${action} successful` });
  } catch (error: any) {
    console.error(`Container action error (${action} on ${id}):`, error);
    res.status(500).json({ error: `Failed to ${action} container` });
  }
}
