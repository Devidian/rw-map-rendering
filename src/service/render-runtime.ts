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
import { serverIdFor } from '../utils/server-id.js';

export interface RendererRuntimeStatus {
  servers: number;
  running: boolean;
}

export class RendererRuntime {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly servers: RenderServerConfig[],
    private readonly poller: Pick<MapRenderPoller, 'pollServer'>,
    private readonly intervalMs: number = AppConfig.pollIntervalMs,
    private readonly satellitePoller?: Pick<SatelliteRenderPoller, 'pollServer'>,
    private readonly publisher?: Pick<SftpPublisher, 'start' | 'stop'>,
  ) {}

  start(): void {
    if (this.stopped || this.timer) return;
    this.publisher?.start(this.servers.map((server) => serverIdFor(server.ip, server.port)));
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await Promise.all(this.servers.map(async (server) => {
          try { await this.poller.pollServer(server); }
          catch (error) { defaultLogger.error('Map render poll failed:', error); }
          if (this.satellitePoller) {
            try { await this.satellitePoller.pollServer(server); }
            catch (error) { defaultLogger.error('Satellite render poll failed:', error); }
          }
        }));
      } catch (error) {
        const message = mapRenderPollErrorMessage(error);
        if (message) defaultLogger.error(message);
        else defaultLogger.error('Map render poll failed:', error);
      } finally {
        this.running = false;
        if (!this.stopped) this.timer = setTimeout(run, this.intervalMs);
      }
    };
    this.timer = setTimeout(run, 0);
  }

  stop(): void {
    this.stopped = true;
    this.publisher?.stop();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
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
  const rsyncPublisher = new RsyncPublisher(mapRoot, {
    target: AppConfig.rsyncTarget,
    sshKeyFile: AppConfig.rsyncSshKeyFile,
  });
  const sftpPublisher = AppConfig.sftpTarget ? new SftpPublisher(mapRoot, {
    target: AppConfig.sftpTarget,
    configFile: AppConfig.sftpConfigFile,
    idleSyncMs: AppConfig.sftpIdleSyncMs,
    fullSyncMs: AppConfig.sftpFullSyncMs,
  }) : undefined;
  const publisher = {
    publishServer: async (serverId: string, changedFiles?: string[]): Promise<void> => {
      await rsyncPublisher.publishServer(serverId);
      await sftpPublisher?.publishServer(serverId, changedFiles);
    },
  };
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
    sftpPublisher,
  );
  runtime.start();
  return runtime;
}
