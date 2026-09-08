import type { RenderServerConfig } from '../interfaces/render-server-config.js';
import { defaultLogger } from '../utils/logger.js';
import { serverIdFor } from '../utils/server-id.js';
import { MapExportBusyError, type NativeMapSource, type NativeMapSourceResult, type NativeMapStreamResult } from './native-map-source.js';
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
    private readonly source: Pick<NativeMapSource, 'fetchMapData'> & Partial<Pick<NativeMapSource, 'streamMapData'>>,
    private readonly renderer: Pick<MapTileRenderer, 'render'> & Partial<Pick<MapTileRenderer, 'writeMetadata'>>,
    private readonly state: Pick<RenderStateStore, 'getServerState' | 'setServerCursor'>,
    private readonly cache?: Pick<MapSourceCacheStore, 'mergeChunks' | 'replaceChunks'>
      & Partial<Pick<MapSourceCacheStore, 'beginFullSync' | 'appendFullSyncPage' | 'finishFullSync' | 'abortFullSync'>>,
    private readonly publisher?: Pick<RsyncPublisher, 'publishServer'>,
  ) {}

  async pollServer(server: RenderServerConfig): Promise<MapRenderPollResult> {
    const serverId = serverIdFor(server.ip, server.port);
    const current = await this.state.getServerState(serverId);
    if (this.canStreamPages()) return this.pollStreamed(server, serverId, current.cursor);
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

  private canStreamPages(): boolean {
    return this.source.streamMapData !== undefined
      && this.renderer.writeMetadata !== undefined
      && this.cache?.beginFullSync !== undefined
      && this.cache.appendFullSyncPage !== undefined
      && this.cache.finishFullSync !== undefined
      && this.cache.abortFullSync !== undefined;
  }

  private async pollStreamed(
    server: RenderServerConfig,
    serverId: string,
    cursor: number | undefined,
  ): Promise<MapRenderPollResult> {
    const cache = this.cache!;
    const full = cursor === undefined;
    let fetched = 0;
    let streamResult: NativeMapStreamResult;
    if (full) await cache.beginFullSync!(serverId);
    try {
      streamResult = await this.streamWithRetry(server, cursor, async (page) => {
        fetched += page.chunks.length;
        if (full) {
          await cache.appendFullSyncPage!(serverId, page.chunks);
          await this.renderer.render(serverId, server.name ?? serverId, page.chunks, {
            preserveMissingChunks: true,
            writeMetadata: false,
          });
          return;
        }
        const cacheResult = await cache.mergeChunks(serverId, page.chunks);
        await this.renderer.render(serverId, server.name ?? serverId, cacheResult.renderChunks, {
          preserveMissingChunks: true,
          chunkBounds: cacheResult.chunkBounds,
          tileBounds: cacheResult.tileBounds,
        });
      }, full ? async () => {
        cache.abortFullSync!(serverId);
        await cache.beginFullSync!(serverId);
        fetched = 0;
      } : undefined);
    } catch (error) {
      if (full) cache.abortFullSync!(serverId);
      throw error;
    }

    if (full) {
      const cacheResult = await cache.finishFullSync!(serverId);
      if (fetched > 0) {
        await this.renderer.writeMetadata!(serverId, server.name ?? serverId, cacheResult);
        await this.publisher?.publishServer(serverId);
      }
    } else if (fetched > 0) {
      await this.publisher?.publishServer(serverId);
    }
    if (streamResult.nextChange !== null) await this.state.setServerCursor(serverId, streamResult.nextChange);
    return { serverId, fetched, rendered: fetched, cursor: streamResult.nextChange ?? cursor };
  }

  private async fetchWithRetry(server: RenderServerConfig, cursor?: number) {
    const attempts = (server.retryAttempts ?? 0) + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.source.fetchMapData(server, cursor);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          const retryDelayMs = error instanceof MapExportBusyError
            ? error.retryAfterMs
            : (server.retryBackoffMs ?? 0);
          if (retryDelayMs > 0) await sleep(retryDelayMs);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Map source fetch failed');
  }

  private async streamWithRetry(
    server: RenderServerConfig,
    cursor: number | undefined,
    consume: (page: NativeMapSourceResult) => Promise<void>,
    beforeRetry?: () => Promise<void>,
  ): Promise<NativeMapStreamResult> {
    const attempts = (server.retryAttempts ?? 0) + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.source.streamMapData!(server, cursor, consume);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await beforeRetry?.();
          const retryDelayMs = error instanceof MapExportBusyError ? error.retryAfterMs : (server.retryBackoffMs ?? 0);
          if (retryDelayMs > 0) await sleep(retryDelayMs);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Map source stream failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
