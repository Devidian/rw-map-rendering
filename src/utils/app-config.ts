import path from 'node:path';
import type { RenderServerConfig } from '../interfaces/render-server-config.js';

export class AppConfig {
  static get host(): string {
    return process.env.HOST?.trim() || '0.0.0.0';
  }

  static get port(): number {
    return boundedInteger(process.env.PORT, 3000, 1, 65535);
  }

  static get mapRootDir(): string {
    return process.env.MAP_ROOT_DIR?.trim() || '/appdata/rw-map-rendering/tiles';
  }

  static get pollIntervalMs(): number {
    return boundedInteger(process.env.POLL_INTERVAL_MS, 15000, 1000, Number.MAX_SAFE_INTEGER);
  }

  static get rsyncTarget(): string | undefined {
    return process.env.RSYNC_TARGET?.trim() || undefined;
  }

  static get rsyncSshKeyFile(): string | undefined {
    return process.env.RSYNC_SSH_KEY_FILE?.trim() || undefined;
  }

  static get logLevel(): 'debug' | 'info' | 'warn' | 'error' | 'off' {
    const value = process.env.LOG_LEVEL;
    return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'off'
      ? value
      : 'info';
  }

  static get renderServers(): RenderServerConfig[] {
    const raw = process.env.RENDER_SERVERS_JSON?.trim() || '[]';
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => parseServer(entry));
  }
}

function parseServer(value: unknown): RenderServerConfig[] {
  if (!value || typeof value !== 'object') return [];
  const item = value as Record<string, unknown>;
  if (typeof item.ip !== 'string' || !item.ip.trim()) return [];
  if (!Number.isSafeInteger(item.port) || (item.port as number) <= 0) return [];
  if (typeof item.baseUrl !== 'string' || !item.baseUrl.trim()) return [];
  try {
    return [{
      ip: item.ip.trim(),
      port: item.port as number,
      baseUrl: new URL(item.baseUrl.trim()).toString().replace(/\/+$/, ''),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
      timeoutMs: optionalBoundedInteger(item.timeoutMs, 500, 60000),
      retryAttempts: optionalBoundedInteger(item.retryAttempts, 0, 10),
      retryBackoffMs: optionalBoundedInteger(item.retryBackoffMs, 0, 60000),
    }];
  } catch {
    return [];
  }
}

function optionalBoundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : undefined;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function resolveMapRoot(root: string = AppConfig.mapRootDir): string {
  return path.resolve(root);
}
