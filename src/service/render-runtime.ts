import type { RenderServerConfig } from '../interfaces/render-server-config.js';
import { AppConfig, resolveMapRoot } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { BridgeMapSource } from './bridge-map-source.js';
import { MapRenderPoller } from './map-render-poller.js';
import { MapSourceCacheStore, mapSourceCacheRoot } from './map-source-cache-store.js';
import { MapTileRenderer } from './map-tile-renderer.js';
import { RenderStateStore, renderStatePath } from './render-state-store.js';
import { RsyncPublisher } from './rsync-publisher.js';

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
  ) {}

  start(): void {
    if (this.stopped || this.timer) return;
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await Promise.all(this.servers.map((server) => this.poller.pollServer(server)));
      } catch (error) {
        defaultLogger.error('Map render poll failed:', error);
      } finally {
        this.running = false;
        if (!this.stopped) this.timer = setTimeout(run, this.intervalMs);
      }
    };
    this.timer = setTimeout(run, 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  status(): RendererRuntimeStatus {
    return { servers: this.servers.length, running: !this.stopped };
  }
}

export function startRendererRuntime(): RendererRuntime {
  const mapRoot = resolveMapRoot();
  const runtime = new RendererRuntime(
    AppConfig.renderServers,
    new MapRenderPoller(
      new BridgeMapSource(),
      new MapTileRenderer(mapRoot),
      new RenderStateStore(renderStatePath(mapRoot)),
      new MapSourceCacheStore(mapSourceCacheRoot(mapRoot)),
      new RsyncPublisher(mapRoot, {
        target: AppConfig.rsyncTarget,
        sshKeyFile: AppConfig.rsyncSshKeyFile,
      }),
    ),
  );
  runtime.start();
  return runtime;
}
