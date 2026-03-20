import { Request, Response } from 'express';
import si from 'systeminformation';
import { AuthRequest } from '../middleware/auth';
import { execFileSync } from 'child_process';
import db from '../db/database';

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
      const composeOut = execFileSync('docker', ['compose', 'ls', '-q']).toString();
      composeCount = composeOut.split('\n').filter(Boolean).length;
    } catch (e) {
      // Fallback if docker compose ls fails
      try {
        const composeProjects = new Set(
          containers
            .map((c: any) => c.labels?.['com.docker.compose.project'] || (c.Labels && c.Labels['com.docker.compose.project']))
            .filter(Boolean)
        );
        composeCount = composeProjects.size;
      } catch (e2) {}
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
    
    // Fetch stats using docker CLI for accuracy, as si.dockerContainerStats is sometimes unreliable
    let statsMap: Record<string, any> = {};
    try {
      const statsOut = execFileSync('docker', [
        'stats', '--no-stream', '--format', '{"id":"{{.ID}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}"}'
      ]).toString();
      
      const statLines = statsOut.split('\n').filter(Boolean);
      for (const line of statLines) {
        try {
          const parsed = JSON.parse(line);
          // cpu: "0.05%" -> 0.05
          const cpu = parseFloat(parsed.cpu.replace('%', '')) || 0;
          // memPerc: "1.2%" -> 1.2
          const memPercent = parseFloat(parsed.memPerc.replace('%', '')) || 0;
          // mem: "12.5MiB / 2GiB" -> we just keep the raw string to parse in frontend, or parse here
          statsMap[parsed.id] = { cpu, memPercent, memUsageStr: parsed.mem };
        } catch (e) {}
      }
    } catch (e) {
      console.warn('Failed to fetch docker stats via CLI:', e);
    }

    // Merge stats into containers
    const enrichedContainers = containers.map((c: any) => {
      // systeminformation returns full 64-char ID, docker stats returns 12-char ID
      const shortId = c.id.substring(0, 12);
      const stats = statsMap[shortId] || { cpu: 0, memPercent: 0, memUsageStr: '0 B / 0 B' };
      return {
        ...c,
        cpuPercent: stats.cpu,
        memPercent: stats.memPercent,
        memUsageStr: stats.memUsageStr
      };
    });

    res.json(enrichedContainers);
  } catch (error: any) {
    console.error('Docker containers error:', error);
    res.status(500).json({ error: 'Failed to fetch Docker containers' });
  }
}

export async function performContainerAction(req: AuthRequest, res: Response) {
  const { id, action } = req.params;
  try {
    if (action === 'logs') {
      const logs = execFileSync('docker', ['logs', '--tail', '100', id]).toString();
      return res.json({ logs });
    }

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

export async function pruneDockerSystem(req: AuthRequest, res: Response) {
  try {
    // Run docker system prune -a -f (removes stopped containers, all unused images, networks)
    const output = execFileSync('docker', ['system', 'prune', '-a', '-f']).toString();
    res.json({ message: 'Docker system pruned successfully', output });
  } catch (error: any) {
    console.error('Docker prune error:', error);
    res.status(500).json({ error: 'Failed to prune Docker system' });
  }
}

export async function getWafStats(req: AuthRequest, res: Response) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // 1. Latest Events
    const latestEvents = db.prepare(`
      SELECT * FROM waf_events 
      ORDER BY timestamp DESC 
      LIMIT 10
    `).all();

    // 2. Block type breakdown (today)
    const blockTypes = db.prepare(`
      SELECT attack_type as name, COUNT(*) as value 
      FROM waf_events 
      WHERE timestamp >= ? 
      GROUP BY attack_type
    `).all(todayStr);

    // 3. Top IP addresses
    const topIps = db.prepare(`
      SELECT ip_address as ip, COUNT(*) as count 
      FROM waf_events 
      GROUP BY ip_address 
      ORDER BY count DESC 
      LIMIT 10
    `).all();

    // 4. Top Domains
    const topDomains = db.prepare(`
      SELECT domain, COUNT(*) as count 
      FROM waf_events 
      GROUP BY domain 
      ORDER BY count DESC 
      LIMIT 10
    `).all();

    // 5. Total counts
    const totalBlocksToday = db.prepare(`
      SELECT COUNT(*) as count FROM waf_events WHERE timestamp >= ?
    `).get(todayStr) as { count: number };

    res.json({
      latestEvents,
      blockTypes,
      topIps,
      topDomains,
      totalBlocksToday: totalBlocksToday.count || 0
    });
  } catch (error: any) {
    console.error('WAF stats error:', error);
    res.status(500).json({ error: 'Failed to fetch WAF stats' });
  }
}
