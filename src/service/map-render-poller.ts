import type { RenderServerConfig } from '../interfaces/render-server-config.js';
import { defaultLogger } from '../utils/logger.js';
import { serverIdFor } from '../utils/server-id.js';
import type { NativeMapSource } from './native-map-source.js';
import type { MapSourceCacheStore, MapSourceCacheMergeResult } from './map-source-cache-store.js';
import type { MapTileRenderer } from './map-tile-renderer.js';
import type { RenderStateStore } from './render-state-store.js';
import type { RsyncPublisher } from './rsync-publisher.js';

export interface MapRenderPollResult {
  serverId: string;
  fetched: number;
  rendered: number;
  cursor?: number;
}

export class MapRenderPoller {
  constructor(
    private readonly source: Pick<NativeMapSource, 'fetchMapData'>,
    private readonly renderer: Pick<MapTileRenderer, 'render'>,
    private readonly state: Pick<RenderStateStore, 'getServerState' | 'setServerCursor'>,
    private readonly cache?: Pick<MapSourceCacheStore, 'mergeChunks' | 'replaceChunks'>,
    private readonly publisher?: Pick<RsyncPublisher, 'publishServer'>,
  ) {}

  async pollServer(server: RenderServerConfig): Promise<MapRenderPollResult> {
    const serverId = serverIdFor(server.ip, server.port);
    const current = await this.state.getServerState(serverId);
    const response = await this.fetchWithRetry(server, current.cursor);
    if (response.chunks.length > 0) {
      const cacheResult: MapSourceCacheMergeResult | undefined = this.cache
        ? response.full
          ? await this.cache.replaceChunks(serverId, response.chunks)
          : await this.cache.mergeChunks(serverId, response.chunks)
        : undefined;
      const renderChunks = cacheResult?.renderChunks ?? response.chunks;
      await this.renderer.render(serverId, server.name ?? serverId, renderChunks, {
        preserveMissingChunks: !response.full,
        chunkBounds: cacheResult?.chunkBounds,
        tileBounds: cacheResult?.tileBounds,
      });
      await this.publisher?.publishServer(serverId);
    }
    if (response.nextChange !== null) {
      await this.state.setServerCursor(serverId, response.nextChange);
    }
    defaultLogger.debug('Map render poll completed:', {
      serverId,
      baseUrl: server.baseUrl,
      fetched: response.chunks.length,
      rendered: response.chunks.length,
      cursor: response.nextChange ?? current.cursor,
    });
    return {
      serverId,
      fetched: response.chunks.length,
      rendered: response.chunks.length,
      cursor: response.nextChange ?? current.cursor,
    };
  }

  private async fetchWithRetry(server: RenderServerConfig, cursor?: number) {
    const attempts = (server.retryAttempts ?? 0) + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.source.fetchMapData(server, cursor);
      } catch (error) {
        lastError = error;
        if (attempt < attempts && (server.retryBackoffMs ?? 0) > 0) {
          await sleep(server.retryBackoffMs!);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Map source fetch failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
