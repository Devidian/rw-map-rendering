import type { RenderServerConfig } from '../interfaces/render-server-config.js';
import { serverIdFor } from '../utils/server-id.js';
import type { NativeSatelliteSource } from './native-satellite-source.js';
import type { SatelliteTileRenderer } from './satellite-tile-renderer.js';
import type { RenderStateStore } from './render-state-store.js';
import type { TilePublisher } from '../interfaces/tile-publisher.js';

export class SatelliteRenderPoller {
  constructor(
    private readonly source: NativeSatelliteSource,
    private readonly renderer: SatelliteTileRenderer,
    private readonly state: RenderStateStore,
    private readonly publisher?: TilePublisher,
  ) {}

  async pollServer(server: RenderServerConfig): Promise<void> {
    const serverId = serverIdFor(server.ip, server.port);
    const cursor = (await this.state.getServerState(serverId)).satelliteCursor;
    const result = await this.source.changes(server, cursor);
    if (!result) return; // Older Admin Utils versions do not expose satellite routes.
    if (result.chunks.length) {
      const images = [];
      for (const change of result.chunks) images.push({ change, png: await this.source.image(server, change) });
      await this.renderer.render(serverId, images);
      const changedFiles = this.renderer.takeChangedPaths(serverId);
      await this.publisher?.publishServer(serverId, changedFiles);
    }
    await this.state.setSatelliteCursor(serverId, result.nextChange);
  }
}
