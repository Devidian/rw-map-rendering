import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapRenderPoller } from '../src/service/map-render-poller.js';
import { serverIdFor } from '../src/utils/server-id.js';

const server = {
  ip: '127.0.0.1',
  port: 4255,
  baseUrl: 'http://127.0.0.1:3000',
  name: 'Test',
};

const chunk: MapSourceChunk = {
  schemaVersion: 1,
  chunkX: 0,
  chunkZ: 0,
  heights: Buffer.alloc(4096),
  textures: Buffer.alloc(1024),
  updatedAtMs: 1000,
  contentHash: 'a'.repeat(64),
  biome: null,
  region: null,
};

describe('MapRenderPoller', () => {
  it('renders chunks and advances cursor after success', async () => {
    const rendered: MapSourceChunk[][] = [];
    const cursors: Array<[string, number]> = [];
    const published: string[] = [];
    let cacheUsed = false;
    const poller = new MapRenderPoller(
      { fetchMapData: async () => ({ full: true, nextChange: 1000, chunks: [chunk] }) },
      { render: async (_serverId, _displayName, chunks) => { rendered.push(chunks); } },
      {
        getServerState: async () => ({}),
        setServerCursor: async (serverId, cursor) => { cursors.push([serverId, cursor]); },
      },
      {
        mergeChunks: async () => {
          cacheUsed = true;
          return [];
        },
      },
      { publishServer: async (serverId) => { published.push(serverId); } },
    );

    await expect(poller.pollServer(server)).resolves.toEqual({
      serverId: serverIdFor(server.ip, server.port),
      fetched: 1,
      rendered: 1,
      cursor: 1000,
    });
    expect(rendered).toEqual([[chunk]]);
    expect(cursors).toEqual([[serverIdFor(server.ip, server.port), 1000]]);
    expect(published).toEqual([serverIdFor(server.ip, server.port)]);
    expect(cacheUsed).toBe(false);
  });

  it('does not advance cursor when rendering fails', async () => {
    let cursorAdvanced = false;
    const poller = new MapRenderPoller(
      { fetchMapData: async () => ({ full: true, nextChange: 1000, chunks: [chunk] }) },
      { render: async () => { throw new Error('render failed'); } },
      {
        getServerState: async () => ({}),
        setServerCursor: async () => { cursorAdvanced = true; },
      },
    );

    await expect(poller.pollServer(server)).rejects.toThrow('render failed');
    expect(cursorAdvanced).toBe(false);
  });

  it('renders merged source cache snapshots for delta responses', async () => {
    const previous = { ...chunk, chunkX: 1, contentHash: 'b'.repeat(64) };
    const rendered: MapSourceChunk[][] = [];
    const poller = new MapRenderPoller(
      { fetchMapData: async () => ({ full: false, nextChange: 1000, chunks: [chunk] }) },
      { render: async (_serverId, _displayName, chunks) => { rendered.push(chunks); } },
      {
        getServerState: async () => ({ cursor: 500 }),
        setServerCursor: async () => {},
      },
      {
        mergeChunks: async () => [previous, chunk],
      },
    );

    await poller.pollServer(server);

    expect(rendered).toEqual([[previous, chunk]]);
  });

  it('retries failed source fetches before rendering', async () => {
    let attempts = 0;
    const poller = new MapRenderPoller(
      {
        fetchMapData: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary');
          return { full: false, nextChange: null, chunks: [] };
        },
      },
      { render: async () => {} },
      {
        getServerState: async () => ({}),
        setServerCursor: async () => {},
      },
    );

    await expect(poller.pollServer({ ...server, retryAttempts: 1 })).resolves.toEqual({
      serverId: serverIdFor(server.ip, server.port),
      fetched: 0,
      rendered: 0,
      cursor: undefined,
    });
    expect(attempts).toBe(2);
  });
});
