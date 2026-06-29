import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapTileRenderer } from '../src/service/map-tile-renderer.js';

function sourceChunk(texture: number): MapSourceChunk {
  const heights = Buffer.alloc(4096);
  const textures = Buffer.alloc(1024, texture);
  for (let index = 0; index < 1024; index += 1) {
    heights.writeFloatLE(120, index * Float32Array.BYTES_PER_ELEMENT);
  }
  return {
    schemaVersion: 1,
    chunkX: 0,
    chunkZ: 0,
    heights,
    textures,
    updatedAtMs: 1000,
    contentHash: 'c'.repeat(64),
    biome: null,
    region: null,
  };
}

describe('MapTileRenderer', () => {
  it('renders fixture chunks into server-id rooted PNG tiles and metadata', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rw-map-rendering-'));
    const renderer = new MapTileRenderer(root, () => Date.parse('2026-06-29T00:00:00.000Z'));

    await renderer.render('server-test', 'Test Server', [sourceChunk(1)]);

    const nativeTile = path.join(root, 'server-test', '8', '0', '0.png');
    expect(existsSync(nativeTile)).toBe(true);
    const image = PNG.sync.read(readFileSync(nativeTile));
    expect(image.width).toBe(256);
    expect(image.height).toBe(256);

    const metadata = JSON.parse(readFileSync(path.join(root, 'server-test', 'metadata.json'), 'utf8')) as Record<string, unknown>;
    expect(metadata).toEqual(expect.objectContaining({
      schemaVersion: 6,
      serverId: 'server-test',
      displayName: 'Test Server',
      tileUrl: '/server-test/{z}/{x}/{y}.png',
      updatedAt: '2026-06-29T00:00:00.000Z',
    }));
  }, 20000);
});
