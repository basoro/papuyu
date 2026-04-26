import crypto from 'crypto';
import { config } from '../config/env';

function getKey() {
  return crypto.createHash('sha256').update(config.secretEncryptionKey).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivEncoded, authTagEncoded, encryptedEncoded] = payload.split(':');
  if (!ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error('Invalid secret payload');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivEncoded, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, 'base64')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

export function generateRandomSecret(length = 24): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}
