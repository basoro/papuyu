import { Request, Response } from 'express';
import db from '../db/database';
import { AuthRequest } from '../middleware/auth';
const bcrypt = require('bcryptjs');

export function listUsers(req: AuthRequest, res: Response) {
  const users = db.prepare('SELECT id, email, role, created_at FROM users').all();
  res.json(users);
}

export async function createUser(req: AuthRequest, res: Response) {
  const { email, password, role } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const validRoles = ['admin', 'client', 'user'];
  const userRole = validRoles.includes(role) ? role : 'user';

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)');
    const result = stmt.run(email, hashedPassword, userRole);
    
    res.status(201).json({ id: result.lastInsertRowid, email, role: userRole });
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
}

export async function updateUser(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { email, password, role } = req.body;
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (email) {
    updates.push('email = ?');
    values.push(email);
  }
  
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    updates.push('password = ?');
    values.push(hashedPassword);
  }
  
  if (role) {
    const validRoles = ['admin', 'client', 'user'];
    if (validRoles.includes(role)) {
      updates.push('role = ?');
      values.push(role);
    }
  }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  values.push(id);
  
  try {
    const result = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User updated successfully' });
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
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
