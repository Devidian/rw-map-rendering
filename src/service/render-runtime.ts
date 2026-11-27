import path from 'node:path';
import type { RenderServerConfig } from '../interfaces/render-server-config.js';
import { AppConfig, resolveMapRoot } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { MapSourceNotFoundError, NativeMapSource } from './native-map-source.js';
import { MapRenderPoller } from './map-render-poller.js';
import { MapSourceCacheStore, mapSourceCacheRoot } from './map-source-cache-store.js';
import { MapTileRenderer } from './map-tile-renderer.js';
import { RenderStateStore, renderStatePath } from './render-state-store.js';
import { RsyncPublisher } from './rsync-publisher.js';
import { NativeSatelliteSource } from './native-satellite-source.js';
import { SatelliteTileRenderer } from './satellite-tile-renderer.js';
import { SatelliteRenderPoller } from './satellite-render-poller.js';
import { SftpPublisher } from './sftp-publisher.js';
import { ArchiveTileStore } from './archive-tile-store.js';
import { ArchivePublisher } from './archive-publisher.js';
import type { TilePublisher } from '../interfaces/tile-publisher.js';
import { serverIdFor } from '../utils/server-id.js';

export interface RendererRuntimeStatus {
  servers: number;
  running: boolean;
}

export class RendererRuntime {
  private readonly timers = new Set<NodeJS.Timeout>();
  private started = false;
  private stopped = false;

  constructor(
    private readonly servers: RenderServerConfig[],
    private readonly poller: Pick<MapRenderPoller, 'pollServer'>,
    private readonly intervalMs: number = AppConfig.pollIntervalMs,
    private readonly satellitePoller?: Pick<SatelliteRenderPoller, 'pollServer'>,
    private readonly publisher?: { start(serverIds: string[]): void; stop(): void },
  ) {}

  start(): void {
    if (this.stopped || this.started) return;
    this.publisher?.start(this.servers.map((server) => serverIdFor(server.ip, server.port)));
    this.started = true;
    const groups = new Map<string, RenderServerConfig[]>();
    for (const server of this.servers) {
      const serverId = serverIdFor(server.ip, server.port);
      const group = groups.get(serverId) ?? [];
      group.push(server);
      groups.set(serverId, group);
    }
    for (const group of groups.values()) {
      const schedule = (delay: number) => {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          void run();
        }, delay);
        this.timers.add(timer);
      };
      const run = async () => {
        for (const server of group) {
          if (this.stopped) break;
          try { await this.poller.pollServer(server); }
          catch (error) {
            const message = mapRenderPollErrorMessage(error);
            if (message) defaultLogger.error(message);
            else defaultLogger.error('Map render poll failed:', error);
          }
          if (!this.stopped && this.satellitePoller) {
            try { await this.satellitePoller.pollServer(server); }
            catch (error) { defaultLogger.error('Satellite render poll failed:', error); }
          }
        }
        if (!this.stopped) schedule(this.intervalMs);
      };
      schedule(0);
    }
  }

  stop(): void {
    this.stopped = true;
    this.publisher?.stop();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  status(): RendererRuntimeStatus {
    return { servers: this.servers.length, running: !this.stopped };
  }
}

export function mapRenderPollErrorMessage(error: unknown): string | undefined {
  return error instanceof MapSourceNotFoundError
    ? `Map render poll failed: Source url ${error.url} not found (404)`
    : undefined;
}

export function startRendererRuntime(): RendererRuntime {
  const mapRoot = resolveMapRoot();
  const state = new RenderStateStore(renderStatePath(mapRoot));
  const mode = AppConfig.publishMode;
  const publicationRoot = mode === 'archive' ? path.resolve(AppConfig.archiveRootDir) : mapRoot;
  const rsyncPublisher = new RsyncPublisher(publicationRoot, {
    target: AppConfig.rsyncTarget,
    sshKeyFile: AppConfig.rsyncSshKeyFile,
  }, undefined, mode === 'raw');
  const sftpPublisher = AppConfig.sftpTarget ? new SftpPublisher(publicationRoot, {
    target: AppConfig.sftpTarget,
    configFile: AppConfig.sftpConfigFile,
    idleSyncMs: AppConfig.sftpIdleSyncMs,
    fullSyncMs: AppConfig.sftpFullSyncMs,
  }, undefined, mode === 'archive') : undefined;
  const rawPublisher: TilePublisher = {
    publishServer: async (serverId: string, changedFiles?: string[]): Promise<void> => {
      await rsyncPublisher.publishServer(serverId);
      await sftpPublisher?.publishServer(serverId, changedFiles);
    },
  };
  const archivePublisher = mode === 'archive' && (AppConfig.rsyncTarget || AppConfig.sftpTarget)
    ? new ArchivePublisher(new ArchiveTileStore(mapRoot, publicationRoot), rsyncPublisher, sftpPublisher)
    : undefined;
  const publisher = archivePublisher ?? rawPublisher;
  const runtime = new RendererRuntime(
    AppConfig.renderServers,
    new MapRenderPoller(
      new NativeMapSource(),
      new MapTileRenderer(mapRoot),
      state,
      new MapSourceCacheStore(mapSourceCacheRoot(mapRoot)),
      publisher,
    ),
    AppConfig.pollIntervalMs,
    new SatelliteRenderPoller(new NativeSatelliteSource(), new SatelliteTileRenderer(mapRoot), state, publisher),
    archivePublisher ?? sftpPublisher,
  );
  runtime.start();
  return runtime;
}
