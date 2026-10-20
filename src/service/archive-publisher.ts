import type { TilePublisher } from '../interfaces/tile-publisher.js';
import { defaultLogger } from '../utils/logger.js';
import { ArchiveTileStore } from './archive-tile-store.js';
import { RsyncPublisher } from './rsync-publisher.js';
import { SftpPublisher } from './sftp-publisher.js';

export class ArchivePublisher implements TilePublisher {
  private readonly seeds = new Map<string, Promise<void>>();

  constructor(
    private readonly store: ArchiveTileStore,
    private readonly rsync: RsyncPublisher,
    private readonly sftp?: SftpPublisher,
  ) {}

  start(serverIds: string[]): void {
    let previous = Promise.resolve();
    for (const serverId of serverIds) {
      previous = previous.catch(() => undefined).then(() => this.seed(serverId));
      const task = previous;
      this.seeds.set(serverId, task);
      void task.catch((error: unknown) => {
        if (this.seeds.get(serverId) === task) this.seeds.delete(serverId);
        defaultLogger.error(`Archive initial publication failed for ${serverId}:`, error);
      });
    }
    void previous.then(() => this.sftp?.start(serverIds), () => this.sftp?.start(serverIds));
  }

  stop(): void {
    this.sftp?.stop();
  }

  async publishServer(serverId: string, changedFiles?: string[]): Promise<void> {
    await (this.seeds.get(serverId) ?? this.seed(serverId));
    if (changedFiles === undefined) {
      await this.seed(serverId);
      return;
    }
    if (changedFiles.length === 0) return;
    const archived = await this.store.buildChanged(serverId, changedFiles);
    await this.rsync.publishServer(serverId);
    await this.sftp?.publishServer(serverId, archived);
  }

  private async seed(serverId: string): Promise<void> {
    if (!await this.store.buildMissingOrStale(serverId)) return;
    await this.rsync.publishServer(serverId);
    await this.sftp?.syncServer(serverId);
  }
}
