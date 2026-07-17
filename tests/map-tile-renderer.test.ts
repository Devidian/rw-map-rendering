import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapTileRenderer } from '../src/service/map-tile-renderer.js';

function sourceChunk(texture: number, chunkX = 0, chunkZ = 0): MapSourceChunk {
  const heights = Buffer.alloc(4096);
  const textures = Buffer.alloc(1024, texture);
  for (let index = 0; index < 1024; index += 1) {
    heights.writeFloatLE(120, index * Float32Array.BYTES_PER_ELEMENT);
  }
  return {
    schemaVersion: 1,
    chunkX,
    chunkZ,
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

  it('renders every present chunk quadrant as opaque pixels', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rw-map-rendering-'));
    const renderer = new MapTileRenderer(root, () => Date.parse('2026-06-29T00:00:00.000Z'));

    await renderer.render('server-test', 'Test Server', [
      sourceChunk(1, 0, 0),
      sourceChunk(2, 1, 0),
      sourceChunk(3, 0, 1),
      sourceChunk(4, 1, 1),
    ]);

    const image = PNG.sync.read(readFileSync(path.join(root, 'server-test', '8', '0', '0.png')));
    expect(transparentPixels(image, 0, 0, 128, 128)).toBe(0);
    expect(transparentPixels(image, 128, 0, 256, 128)).toBe(0);
    expect(transparentPixels(image, 0, 128, 128, 256)).toBe(0);
    expect(transparentPixels(image, 128, 128, 256, 256)).toBe(0);
  }, 20000);

  it('preserves existing native tile quadrants during delta renders', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rw-map-rendering-'));
    const renderer = new MapTileRenderer(root, () => Date.parse('2026-06-29T00:00:00.000Z'));
    const nativeTile = path.join(root, 'server-test', '8', '0', '0.png');

    await renderer.render('server-test', 'Test Server', [
      sourceChunk(1, 0, 0),
      sourceChunk(2, 1, 0),
      sourceChunk(3, 0, 1),
      sourceChunk(4, 1, 1),
    ]);
    await renderer.render('server-test', 'Test Server', [
      sourceChunk(5, 0, 0),
    ], { preserveMissingChunks: true });

    const image = PNG.sync.read(readFileSync(nativeTile));
    expect(transparentPixels(image, 0, 0, 128, 128)).toBe(0);
    expect(transparentPixels(image, 128, 0, 256, 128)).toBe(0);
    expect(transparentPixels(image, 0, 128, 128, 256)).toBe(0);
    expect(transparentPixels(image, 128, 128, 256, 256)).toBe(0);
  }, 20000);
});

function transparentPixels(image: PNG, minX: number, minY: number, maxX: number, maxY: number): number {
  let count = 0;
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const alphaIndex = ((image.width * y + x) << 2) + 3;
      if (image.data[alphaIndex] === 0) count += 1;
    }
  }
  return count;
}
