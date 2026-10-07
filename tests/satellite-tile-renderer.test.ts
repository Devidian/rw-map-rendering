import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { SatelliteTileRenderer } from '../src/service/satellite-tile-renderer.js';
import { MapTileRenderer } from '../src/service/map-tile-renderer.js';

test('stores scaled satellite chunks beside the surface pyramid and preserves layer metadata', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rw-satellite-'));
  const renderer = new SatelliteTileRenderer(root);
  const image = new PNG({ width: 256, height: 256, colorType: 6 });
  image.data.fill(255);
  await renderer.render('server-test', [{ change: { x: -1, z: 0, res: 256, revision: 1 }, png: PNG.sync.write(image) }]);
  const tile = PNG.sync.read(readFileSync(path.join(root, 'server-test', 'satellite', '8', '-1', '0.png')));
  expect(tile.data[((tile.width * 130 + 130) << 2) + 3]).toBe(255);
  expect(tile.data[((tile.width * 2 + 2) << 2) + 3]).toBe(0);
  expect(readFileSync(path.join(root, 'server-test', 'satellite', '0', '-1', '0.png')).length).toBeGreaterThan(0);
  await new MapTileRenderer(root).writeMetadata('server-test', 'Test', {
    chunkBounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    tileBounds: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 },
  });
  const metadata = JSON.parse(readFileSync(path.join(root, 'server-test', 'metadata.json'), 'utf8')) as Record<string, unknown>;
  expect(metadata.satelliteTileUrl).toBe('/server-test/satellite/{z}/{x}/{y}.png');
}, 20000);
