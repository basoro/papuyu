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
  
  // We only care about ModSecurity Access denied logs
  if (!line.includes('ModSecurity: Access denied')) return;

  try {
    // Example log:
    // 2026/03/20 07:58:50 [error] 527#527: *1 [client 172.20.0.3] ModSecurity: Access denied with code 403 (phase 2). Matched "Operator `Ge' with parameter `5' against variable `TX:ANOMALY_SCORE' (Value: `20' ) [file "/etc/modsecurity.d/owasp-crs/rules/REQUEST-949-BLOCKING-EVALUATION.conf"] [line "81"] [id "949110"] [rev ""] [msg "Inbound Anomaly Score Exceeded (Total Score: 20)"] [data ""] [severity "2"] [ver "OWASP_CRS/3.3.8"] [maturity "0"] [accuracy "0"] [tag "modsecurity"] [tag "application-multi"] [tag "language-multi"] [tag "platform-multi"] [tag "attack-generic"] [hostname "modsecurity"] [uri "/"] [unique_id "177399353088.177075"] [ref ""], client: 172.20.0.3, server: localhost, request: "GET /?id=1%20UNION%20SELECT%20password%20FROM%20users&attempt=20 HTTP/1.1", host: "modsecurity:8080"

    // Extract basic fields using Regex
    const clientIpMatch = line.match(/client:\s*([^,]+)/);
    const forwardedForMatch = line.match(/"([^"]+)"\s*"([^"]+)"$/); // Try to get X-Forwarded-For if it's logged at the end
    const uriMatch = line.match(/\[uri\s+"([^"]+)"\]/);
    const msgMatch = line.match(/\[msg\s+"([^"]+)"\]/);
    const hostMatch = line.match(/host:\s*"([^"]+)"/);
    const requestMatch = line.match(/request:\s*"([^"]+)"/);

    let ipAddress = clientIpMatch ? clientIpMatch[1] : 'Unknown';
    
    // Check if the log contains a forwarded IP (if Nginx logs it)
    if (line.includes('X-Forwarded-For:')) {
        const xffMatch = line.match(/X-Forwarded-For:\s*([^,\]"'\s]+)/i);
        if (xffMatch && xffMatch[1]) {
            ipAddress = xffMatch[1].trim();
        }
    }
    
    // Check if X-Forwarded-For is passed as a normal string at the end of the log
    // Example: ... "Mozilla/5.0..." "103.144.xxx.xxx"
    if (ipAddress.startsWith('172.') || ipAddress === 'Unknown') {
        const lastQuotes = line.match(/"([^"]+)"$/);
        if (lastQuotes && lastQuotes[1] && !lastQuotes[1].includes('/') && lastQuotes[1].includes('.')) {
            // It might be an IP address
            const potentialIp = lastQuotes[1].split(',')[0].trim();
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(potentialIp)) {
                ipAddress = potentialIp;
            }
        }
    }
    
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
