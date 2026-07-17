import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
  it('stores full sync chunks in sector shards with compact metadata', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rw-map-cache-'));
    const store = new MapSourceCacheStore(root);

    const result = await store.replaceChunks('server-test', [
      chunk(0, 1000, 'a'.repeat(64)),
      chunk(300, 2000, 'b'.repeat(64)),
    ]);

    expect(result.renderChunks.map((item) => item.chunkX)).toEqual([0, 300]);
    expect(result.totalChunks).toBe(2);
    expect(existsSync(path.join(root, 'server-test', '0', '0.json'))).toBe(true);
    expect(existsSync(path.join(root, 'server-test', '1', '0.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, 'server-test.meta.json'), 'utf8'))).toEqual(expect.objectContaining({
      schemaVersion: 2,
      totalChunks: 2,
      chunkBounds: { minX: 0, minZ: 0, maxX: 300, maxZ: 0 },
    }));
    await expect(store.getChunks('server-test')).resolves.toEqual([
      expect.objectContaining({ chunkX: 0, contentHash: 'a'.repeat(64) }),
      expect.objectContaining({ chunkX: 300, contentHash: 'b'.repeat(64) }),
    ]);
  });

  it('merges deltas by loading only affected sector shards and returns affected tile chunks', async () => {
    const store = new MapSourceCacheStore(mkdtempSync(path.join(os.tmpdir(), 'rw-map-cache-')));

    await store.replaceChunks('server-test', [
      chunk(0, 1000, 'a'.repeat(64)),
      chunk(1, 1001, 'b'.repeat(64)),
      chunk(2, 1002, 'c'.repeat(64)),
    ]);
    const result = await store.mergeChunks('server-test', [chunk(0, 2000, 'd'.repeat(64))]);

    expect(result.renderChunks.map((item) => item.chunkX)).toEqual([1, 0]);
    expect(result.totalChunks).toBe(3);
    await expect(store.getChunks('server-test')).resolves.toEqual([
      expect.objectContaining({ chunkX: 1, contentHash: 'b'.repeat(64) }),
      expect.objectContaining({ chunkX: 2, contentHash: 'c'.repeat(64) }),
      expect.objectContaining({ chunkX: 0, contentHash: 'd'.repeat(64) }),
    ]);
  });
});
