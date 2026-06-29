import { createHash } from 'node:crypto';

export function serverIdFor(ip: string, port: number): string {
  const hash = createHash('sha256').update(`${ip}:${port}`).digest('hex').slice(0, 24);
  return `server-${hash}`;
}
