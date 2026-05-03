export const SHARED_DATABASE_NETWORK = 'papuyu-network';
export const PUBLIC_PROXY_NETWORK = 'papuyu-network';

export function canonicalId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
