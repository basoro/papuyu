import { Request, Response } from 'express';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';

export function listUsers(req: AuthRequest, res: Response) {
  const users = db.prepare('SELECT id, email, role, created_at FROM users').all();
  res.json(users);
}

export function deleteUser(req: AuthRequest, res: Response) {
  const { id } = req.params;
  
  if (parseInt(id) === req.userId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({ message: 'User deleted' });
}

export function updateUserRole(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { role } = req.body;
  
  if (parseInt(id) === req.userId) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  if (!['user', 'client', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ message: 'User role updated' });
}
