import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Try to load .env from the root directory (where docker-compose runs)
// as well as from the local backend directory
const rootEnvPath = path.join(__dirname, '../../../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

export const config = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-me',
  dbPath: process.env.DB_PATH || path.join(__dirname, '../../../../data/papuyu.db'),
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: parseInt(process.env.REDIS_PORT || '6379'),
  
  // Use nip.io as the ultimate fallback if no domain is provided, 
  // but prioritize reading from the server's environment variable.
  domain: process.env.DOMAIN || '103.187.146.74.nip.io', 
};
