import { Request, Response } from 'express';
import si from 'systeminformation';
import { AuthRequest } from '../middleware/auth';

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
