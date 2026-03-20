import { spawn } from 'child_process';
import db from '../db/database';
import { nanoid } from 'nanoid';

export const startWafLogWatcher = () => {
  console.log(`[WAF] Starting Docker logs watcher for ModSecurity container...`);

  try {
    // We use Docker CLI directly to stream logs from the modsecurity container
    // This bypasses the need for shared file volumes completely
    const dockerLogs = spawn('docker', ['logs', '-f', '--tail', '0', 'papuyu-modsecurity-1']);

    dockerLogs.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => processNginxErrorLog(line));
    });

    dockerLogs.stderr.on('data', (data) => {
      // Nginx typically writes errors to stderr
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => processNginxErrorLog(line));
    });

    dockerLogs.on('close', (code) => {
      console.log(`[WAF] Docker log process exited with code ${code}. Restarting in 5s...`);
      setTimeout(startWafLogWatcher, 5000);
    });

    dockerLogs.on('error', (err) => {
      console.error('[WAF] Failed to start docker logs process:', err);
      setTimeout(startWafLogWatcher, 5000);
    });

  } catch (error) {
    console.error('[WAF] Failed to start log watcher:', error);
  }
};

const processNginxErrorLog = (line: string) => {
  if (!line || line.trim() === '') return;
  
  // Periksa apakah log adalah JSON (Audit Log dari ModSecurity)
  if (line.startsWith('{"transaction":')) {
    try {
      const auditLog = JSON.parse(line);
      const transaction = auditLog.transaction;
      
      // Ambil IP dari X-Forwarded-For atau X-Real-Ip jika tersedia, fallback ke client_ip
      let ipAddress = transaction.client_ip;
      if (transaction.request && transaction.request.headers) {
        const headers = transaction.request.headers;
        if (headers['X-Forwarded-For']) {
          ipAddress = headers['X-Forwarded-For'].split(',')[0].trim();
        } else if (headers['X-Real-Ip']) {
          ipAddress = headers['X-Real-Ip'].trim();
        }
      }
      
      let domain = 'Unknown';
      if (transaction.request && transaction.request.headers && transaction.request.headers['X-Forwarded-Host']) {
        domain = transaction.request.headers['X-Forwarded-Host'];
      } else if (transaction.request && transaction.request.headers && transaction.request.headers['Host']) {
        domain = transaction.request.headers['Host'];
        if (domain.includes(':')) domain = domain.split(':')[0];
      }
      
      if (domain === 'modsecurity' || domain === 'Unknown') {
        domain = 'rshd.my.id (Protected)';
      }
      
      let url = '/';
      if (transaction.request && transaction.request.uri) {
        url = transaction.request.uri;
      }
      
      // Ambil pesan error dari messages
      let rawMessage = 'Malicious request';
      if (transaction.messages && transaction.messages.length > 0) {
        rawMessage = transaction.messages[0].message || rawMessage;
      }
      
      const attackType = extractAttackType(rawMessage, url);
      const action = 'Blocked';
      
      // Parsing timestamp: "Fri Mar 20 08:59:38 2026"
      let timestamp = new Date().toISOString();
      if (transaction.time_stamp) {
        const parsed = new Date(transaction.time_stamp);
        if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
      }
      
      console.log(`[WAF] Captured Event (JSON): IP=${ipAddress}, Attack=${attackType}, URL=${url}`);
      
      const stmt = db.prepare(`
        INSERT INTO waf_events (id, timestamp, ip_address, domain, attack_type, url, action)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const id = nanoid();
      stmt.run(id, timestamp, ipAddress, domain, attackType, url, action);
      
      return; // Berhenti memproses jika sudah berhasil parse JSON
    } catch (err) {
      console.error('[WAF] Error parsing JSON audit log:', err);
      // Fallback ke parsing regex di bawah jika JSON gagal
    }
  }
  
  // We only care about ModSecurity Access denied logs
  if (!line.includes('ModSecurity: Access denied')) return;

  try {
    // Example log:
    // 2026/03/20 07:58:50 [error] 527#527: *1 [client 172.20.0.3] ModSecurity: Access denied with code 403 (phase 2). Matched "Operator `Ge' with parameter `5' against variable `TX:ANOMALY_SCORE' (Value: `20' ) [file "/etc/modsecurity.d/owasp-crs/rules/REQUEST-949-BLOCKING-EVALUATION.conf"] [line "81"] [id "949110"] [rev ""] [msg "Inbound Anomaly Score Exceeded (Total Score: 20)"] [data ""] [severity "2"] [ver "OWASP_CRS/3.3.8"] [maturity "0"] [accuracy "0"] [tag "modsecurity"] [tag "application-multi"] [tag "language-multi"] [tag "platform-multi"] [tag "attack-generic"] [hostname "modsecurity"] [uri "/"] [unique_id "177399353088.177075"] [ref ""], client: 172.20.0.3, server: localhost, request: "GET /?id=1%20UNION%20SELECT%20password%20FROM%20users&attempt=20 HTTP/1.1", host: "modsecurity:8080"

    // Extract basic fields using Regex
    const clientIpMatch = line.match(/client:\s*([^,]+)/);
    const uriMatch = line.match(/\[uri\s+"([^"]+)"\]/);
    const msgMatch = line.match(/\[msg\s+"([^"]+)"\]/);
    const hostMatch = line.match(/host:\s*"([^"]+)"/);
    const requestMatch = line.match(/request:\s*"([^"]+)"/);

    let ipAddress = clientIpMatch ? clientIpMatch[1] : 'Unknown';
    
    // Try to extract from Traefik headers passed by the plugin
    const forwardedForMatch = line.match(/X-Forwarded-For.*?([\d\.]+)/i);
    const realIpMatch = line.match(/X-Real-Ip.*?([\d\.]+)/i);
    
    if (forwardedForMatch && forwardedForMatch[1]) {
      ipAddress = forwardedForMatch[1];
    } else if (realIpMatch && realIpMatch[1]) {
      ipAddress = realIpMatch[1];
    } else {
      // Fallback: If IP starts with 172. (Docker internal), try to find another IP in the log
      if (ipAddress.startsWith('172.')) {
        const allIps = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
        for (const ip of allIps) {
          if (!ip.startsWith('172.') && !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.')) {
            ipAddress = ip;
            break;
          }
        }
      }
    }
    
    let domain = hostMatch ? hostMatch[1] : 'Unknown';
    if (domain.includes(':')) domain = domain.split(':')[0]; // Remove port
    
    // Fallback domain if host is not found but we know it's trapped by our WAF
    if (domain === 'modsecurity' || domain === 'Unknown') {
       domain = 'rshd.my.id (Protected)';
    }

    let url = uriMatch ? uriMatch[1] : '/';
    if (requestMatch && url === '/') {
      // Try to get full URL from request string (e.g., "GET /?id=1... HTTP/1.1")
      const reqParts = requestMatch[1].split(' ');
      if (reqParts.length > 1) url = reqParts[1];
    }

    const rawMessage = msgMatch ? msgMatch[1] : 'Malicious request';
    const attackType = extractAttackType(rawMessage, url);
    const action = 'Blocked';

    // Extract time: "2026/03/20 07:58:50" -> ISO
    let timestamp = new Date().toISOString();
    const timeMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
    if (timeMatch) {
      const parsed = new Date(timeMatch[1].replace(/\//g, '-'));
      if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
    }

    console.log(`[WAF] Captured Event: IP=${ipAddress}, Attack=${attackType}, URL=${url}`);

    // Insert into SQLite
    const stmt = db.prepare(`
      INSERT INTO waf_events (id, timestamp, ip_address, domain, attack_type, url, action)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const id = nanoid();
    stmt.run(id, timestamp, ipAddress, domain, attackType, url, action);

  } catch (err) {
    console.error('[WAF] Error processing docker log line:', err);
  }
};

const extractAttackType = (message: string, url: string): string => {
  const msgLower = message.toLowerCase();
  const urlLower = url.toLowerCase();
  
  if (msgLower.includes('sql injection') || msgLower.includes('sqli') || urlLower.includes('union') || urlLower.includes('select')) {
    return 'SQL Injection';
  }
  if (msgLower.includes('xss') || msgLower.includes('cross-site scripting') || urlLower.includes('<script>')) {
    return 'Cross-Site Scripting (XSS)';
  }
  if (msgLower.includes('local file inclusion') || msgLower.includes('lfi') || urlLower.includes('../') || urlLower.includes('etc/passwd')) {
    return 'Directory Traversal / LFI';
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
  if (msgLower.includes('scanner') || msgLower.includes('crawler') || msgLower.includes('anomaly')) {
    return 'Scanner / Bad Bot';
  }
  
  return message.length > 50 ? message.substring(0, 50) + '...' : message;
};
