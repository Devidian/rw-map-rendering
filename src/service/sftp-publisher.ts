import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SftpConfig } from '../interfaces/sftp-config.js';
import type { TilePublisher } from '../interfaces/tile-publisher.js';
import { defaultLogger } from '../utils/logger.js';
import { type CommandRunner, spawnCommand } from './rsync-publisher.js';

export class SftpPublisher implements TilePublisher {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private hourlyTimer?: NodeJS.Timeout;

  constructor(
    private readonly mapRoot: string,
    private readonly config: SftpConfig,
    private readonly runner: CommandRunner = spawnCommand,
    private readonly archiveMode = false,
  ) {
    const targetPath = /^[a-zA-Z0-9_-]+:(.*)$/.exec(config.target)?.[1];
    if (targetPath === undefined || targetPath === '/'
      || targetPath.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('SFTP_TARGET must be a remote root or directory, e.g. webspace: or webspace:maps');
    }
    if (!Number.isSafeInteger(config.idleSyncMs) || config.idleSyncMs < 0
      || !Number.isSafeInteger(config.fullSyncMs) || config.fullSyncMs < 0) {
      throw new Error('SFTP sync intervals must be nonnegative integer milliseconds');
    }
  }

  start(serverIds: string[]): void {
    if (this.hourlyTimer || this.config.fullSyncMs === 0) return;
    this.hourlyTimer = setInterval(() => {
      for (const serverId of serverIds) this.syncServer(serverId).catch((error: unknown) => {
        defaultLogger.error(`SFTP full sync failed for ${serverId}:`, error);
      });
    }, this.config.fullSyncMs);
    this.hourlyTimer.unref();
  }

  stop(): void {
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
    this.hourlyTimer = undefined;
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
  }

  publishServer(serverId: string, changedFiles?: string[]): Promise<void> {
    this.assertServerId(serverId);
    if (changedFiles?.length === 0) return Promise.resolve();
    if (changedFiles?.some((file) => !isSafeRelativePath(file))) {
      throw new Error('Invalid relative tile path');
    }
    if (this.archiveMode && changedFiles === undefined) return this.syncServer(serverId);
    if (this.config.idleSyncMs > 0) {
      const oldTimer = this.idleTimers.get(serverId);
      if (oldTimer) clearTimeout(oldTimer);
      const timer = setTimeout(() => {
        this.idleTimers.delete(serverId);
        this.syncServer(serverId).catch((error: unknown) => {
          defaultLogger.error(`SFTP idle sync failed for ${serverId}:`, error);
        });
      }, this.config.idleSyncMs);
      timer.unref();
      this.idleTimers.set(serverId, timer);
    }
    return this.enqueue(serverId, async () => {
      if (!changedFiles) {
        await this.run('copy', serverId, ['--no-traverse', '--max-age', `${this.config.fullSyncMs || 3600000}ms`]);
        return;
      }
      const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'rw-map-sftp-'));
      try {
        const manifest = path.join(temporaryDir, 'files.txt');
        await writeFile(manifest, `${[...new Set(changedFiles)].join('\n')}\n`, { mode: 0o600 });
        if (this.archiveMode) {
          await this.run('copy', serverId, ['--no-traverse', '--no-check-dest', '--files-from', manifest], true);
          await this.promote(serverId, ['--no-traverse', '--files-from', manifest]);
        } else {
          await this.run('copy', serverId, ['--no-traverse', '--files-from', manifest]);
        }
      } finally {
        await rm(temporaryDir, { recursive: true, force: true });
      }
    });
  }

  syncServer(serverId: string): Promise<void> {
    this.assertServerId(serverId);
    return this.enqueue(serverId, async () => {
      // Never let a missing, empty or wrong source directory delete remote tiles.
      const metadata = JSON.parse(await readFile(path.join(this.mapRoot, serverId, 'metadata.json'), 'utf8')) as unknown;
      if (!metadata || typeof metadata !== 'object' || !('serverId' in metadata)
        || metadata.serverId !== serverId) {
        throw new Error(`Invalid map metadata for ${serverId}; SFTP sync refused`);
      }
      if (this.archiveMode) {
        await this.clearStage(serverId);
        await this.run('sync', serverId,
          ['--compare-dest', this.remotePath(serverId, false), '--size-only'], true);
        await this.promote(serverId);
      } else {
        await this.run('sync', serverId);
      }
    });
  }

  private run(mode: 'copy' | 'sync', serverId: string, extra: string[] = [], staging = false): Promise<void> {
    return this.runner('rclone', [
      '--config', this.config.configFile,
      mode, '--transfers', this.archiveMode ? '1' : '2', '--checkers', this.archiveMode ? '1' : '2',
      ...(this.archiveMode ? ['--sftp-set-modtime=false'] : []), ...extra,
      path.join(this.mapRoot, serverId), this.remotePath(serverId, staging),
    ]);
  }

  private promote(serverId: string, extra: string[] = []): Promise<void> {
    return this.runner('rclone', [
      '--config', this.config.configFile,
      'move', '--transfers', '1', '--checkers', '1', '--ignore-times', ...extra,
      this.remotePath(serverId, true), this.remotePath(serverId, false),
    ]);
  }

  private async clearStage(serverId: string): Promise<void> {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'rw-map-sftp-empty-'));
    try {
      await this.runner('rclone', [
        '--config', this.config.configFile,
        'sync', '--transfers', '1', '--checkers', '1',
        empty, this.remotePath(serverId, true),
      ]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  }

  private remotePath(serverId: string, staging: boolean): string {
    const base = this.config.target.replace(/\/+$/, '');
    const separator = base.endsWith(':') ? '' : '/';
    return `${base}${separator}${staging ? '.archive-stage/' : ''}${serverId}`;
  }

  private enqueue(serverId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(serverId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.pending.set(serverId, current);
    void current.then(() => { if (this.pending.get(serverId) === current) this.pending.delete(serverId); },
      () => { if (this.pending.get(serverId) === current) this.pending.delete(serverId); });
    return current;
  }

  private assertServerId(serverId: string): void {
    if (!/^server-[a-f0-9]{24}$/.test(serverId)) throw new Error('Invalid map server ID');
  }
}

function isSafeRelativePath(file: string): boolean {
  return file !== '' && !path.posix.isAbsolute(file) && !file.includes('\\')
    && !file.includes('\n') && !file.includes('\r')
    && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
