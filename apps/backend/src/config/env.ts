import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-key',
  dbPath: process.env.DB_PATH || './data.db',
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: parseInt(process.env.REDIS_PORT || '6379'),
  domain: process.env.DOMAIN || '103.187.146.74.nip.io', // Used for Traefik routing
};
