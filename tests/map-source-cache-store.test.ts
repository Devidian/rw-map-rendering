import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapSourceCacheStore } from '../src/service/map-source-cache-store.js';

function chunk(chunkX: number, updatedAtMs: number, contentHash: string): MapSourceChunk {
  return {
    schemaVersion: 1,
    chunkX,
    chunkZ: 0,
    heights: Buffer.alloc(4096),
    textures: Buffer.alloc(1024),
    updatedAtMs,
    contentHash,
    biome: null,
    region: null,
  };
}

describe('MapSourceCacheStore', () => {
  it('merges changed chunks into a persisted source snapshot', async () => {
    const store = new MapSourceCacheStore(mkdtempSync(path.join(os.tmpdir(), 'rw-map-cache-')));

    await store.mergeChunks('server-test', [chunk(0, 1000, 'a'.repeat(64))]);
    const snapshot = await store.mergeChunks('server-test', [chunk(1, 2000, 'b'.repeat(64))]);

    expect(snapshot.map((item) => item.chunkX)).toEqual([0, 1]);
    await expect(store.getChunks('server-test')).resolves.toEqual([
      expect.objectContaining({ chunkX: 0, contentHash: 'a'.repeat(64) }),
      expect.objectContaining({ chunkX: 1, contentHash: 'b'.repeat(64) }),
    ]);
  });
});
