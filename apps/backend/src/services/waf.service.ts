import { Tail } from 'tail';
import fs from 'fs';
import path from 'path';
import db from '../db/database';
import { nanoid } from 'nanoid';

const LOG_FILE = '/var/log/modsec/audit.log';

// For local testing outside of Docker, fallback to the relative path
const getLogFilePath = () => {
  if (fs.existsSync(LOG_FILE)) {
    return LOG_FILE;
  }
  const localPath = path.resolve(process.cwd(), '../../logs/modsec/audit.log');
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  const projectRootPath = path.resolve(process.cwd(), 'logs/modsec/audit.log');
  if (fs.existsSync(projectRootPath)) {
    return projectRootPath;
  }
  return null;
};

export const startWafLogWatcher = () => {
  const logPath = getLogFilePath();
  
  if (!logPath) {
    console.warn('[WAF] Audit log file not found. WAF logging is disabled.');
    return;
  }

  console.log(`[WAF] Watching ModSecurity audit log at ${logPath}`);

  try {
    const tail = new Tail(logPath, {
      fromBeginning: false,
      follow: true,
      useWatchFile: true
    });

    tail.on('line', (line: string) => {
      try {
        console.log('[WAF] New log line detected, length:', line.length);
        if (!line || !line.trim().startsWith('{')) {
          console.log('[WAF] Ignoring non-JSON log line');
          return; // Ignore non-JSON lines
        }
        
        const data = JSON.parse(line);
        console.log('[WAF] Successfully parsed JSON log for transaction:', data?.transaction?.id);
        processWafLog(data);
      } catch (err) {
        console.error('[WAF] Error parsing log line:', err);
      }
    });

    tail.on('error', (error: any) => {
      console.error('[WAF] Tail error:', error);
    });
  } catch (error) {
    console.error('[WAF] Failed to start log watcher:', error);
  }
};

const processWafLog = (data: any) => {
  console.log('[WAF] Processing WAF log...');
  const transaction = data?.transaction;
  if (!transaction) {
    console.log('[WAF] No transaction object found in log');
    return;
  }

  const messages = transaction.messages || [];
  if (messages.length === 0) {
    console.log('[WAF] No messages found in transaction, not an attack');
    return; // Not an attack if there are no messages
  }

  const ipAddress = transaction.client_ip || 'Unknown';
  const domain = transaction.request?.headers?.Host || 'Unknown';
  const url = transaction.request?.uri || '/';
  
  // Use the first message to classify the attack type
  const firstMessage = messages[0];
  const attackType = extractAttackType(firstMessage.message || 'Unknown threat');
  
  // Assuming "action" from details or default to Blocked if it's an alert
  const action = firstMessage.details?.action || 'Blocked';
  
  console.log(`[WAF] Extracted Data: IP=${ipAddress}, Domain=${domain}, URL=${url}, Attack=${attackType}, Action=${action}`);

  // Parse ModSec time "20/Mar/2026:11:01:42 +0000" to SQLite datetime format
  let timestamp = new Date().toISOString(); // fallback
  try {
    if (transaction.time) {
      // ModSec time format: "05/Oct/2023:14:32:00 +0000"
      const timeStr = transaction.time.replace(':', ' ');
      const dateObj = new Date(timeStr);
      if (!isNaN(dateObj.getTime())) {
        timestamp = dateObj.toISOString();
      }
    }
  } catch (e) {
    console.error('[WAF] Error parsing time:', e);
  }

  // Insert into SQLite
  try {
    const stmt = db.prepare(`
      INSERT INTO waf_events (id, timestamp, ip_address, domain, attack_type, url, action)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const id = nanoid();
    stmt.run(id, timestamp, ipAddress, domain, attackType, url, action);
    console.log(`[WAF] Successfully saved event to database with ID: ${id}`);
  } catch (err) {
    console.error('[WAF] Failed to insert WAF event into database:', err);
  }
};

const extractAttackType = (message: string): string => {
  // Map OWASP CRS rule messages to simpler categories
  const msgLower = message.toLowerCase();
  
  if (msgLower.includes('sql injection') || msgLower.includes('sqli')) {
    return 'SQL Injection';
  }
  if (msgLower.includes('xss') || msgLower.includes('cross-site scripting')) {
    return 'Cross-Site Scripting (XSS)';
  }
  if (msgLower.includes('local file inclusion') || msgLower.includes('lfi')) {
    return 'Local File Inclusion';
  }
  if (msgLower.includes('remote file inclusion') || msgLower.includes('rfi')) {
    return 'Remote File Inclusion';
  }
  if (msgLower.includes('php injection') || msgLower.includes('php code')) {
    return 'PHP Injection';
  }
  if (msgLower.includes('shell') || msgLower.includes('command injection')) {
    return 'Command Injection';
  }
  if (msgLower.includes('scanner') || msgLower.includes('crawler')) {
    return 'Scanner/Crawler';
  }
  if (msgLower.includes('user-agent') || msgLower.includes('anomaly')) {
    return 'Protocol Anomaly';
  }
  
  return message.length > 50 ? message.substring(0, 50) + '...' : message;
};
