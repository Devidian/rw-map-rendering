import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { SatelliteChange } from './native-satellite-source.js';

const TILE_SIZE = 256;
const CHUNK_PIXELS = 128;
const NATIVE_ZOOM = 8;

export class SatelliteTileRenderer {
  constructor(private readonly tileRoot: string) {}

  async render(serverId: string, images: Array<{ change: SatelliteChange; png: Buffer }>): Promise<void> {
    if (!images.length) return;
    const root = path.join(this.tileRoot, serverId);
    const satelliteRoot = path.join(root, 'satellite');
    const tiles = new Map<string, { x: number; z: number; image: PNG }>();
    for (const { change, png } of images) {
      const source = PNG.sync.read(png);
      if (source.width !== change.res || source.height !== change.res) throw new Error('Invalid satellite image dimensions');
      const x = Math.floor(change.x / 2);
      const z = Math.floor(change.z / 2);
      const key = `${x},${z}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = { x, z, image: await readPng(tilePath(satelliteRoot, NATIVE_ZOOM, x, z)) ?? transparentTile() };
        tiles.set(key, tile);
      }
      const offsetX = change.x - x * 2;
      const offsetZ = change.z - z * 2;
      for (let py = 0; py < CHUNK_PIXELS; py++) {
        for (let px = 0; px < CHUNK_PIXELS; px++) {
          copyPixel(source, Math.floor(px * change.res / CHUNK_PIXELS), Math.floor(py * change.res / CHUNK_PIXELS),
            tile.image, offsetX * CHUNK_PIXELS + px, (1 - offsetZ) * CHUNK_PIXELS + py);
        }
      }
    }
    let affected = [...tiles.values()].map(({ x, z }) => [x, z] as const);
    for (const tile of tiles.values()) await writePng(tilePath(satelliteRoot, NATIVE_ZOOM, tile.x, tile.z), tile.image);
    for (let zoom = NATIVE_ZOOM - 1; zoom >= 0; zoom--) {
      affected = unique(affected.map(([x, z]) => [Math.floor(x / 2), Math.floor(z / 2)] as const));
      for (const [x, z] of affected) {
        const parent = transparentTile();
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const child = await readPng(tilePath(satelliteRoot, zoom + 1, x * 2 + dx, z * 2 + dz));
          if (!child) continue;
          for (let py = 0; py < 128; py++) for (let px = 0; px < 128; px++) {
            copyPixel(child, px * 2, py * 2, parent, dx * 128 + px, (1 - dz) * 128 + py);
          }
        }
        await writePng(tilePath(satelliteRoot, zoom, x, z), parent);
      }
    }
    await writeAtomic(path.join(satelliteRoot, 'metadata.json'), Buffer.from(JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString() })));
    const metadataPath = path.join(root, 'metadata.json');
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
      metadata.satelliteTileUrl = `/${serverId}/satellite/{z}/{x}/{y}.png`;
      await writeAtomic(metadataPath, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

function tilePath(root: string, zoom: number, x: number, z: number): string {
  return path.join(root, String(zoom), String(x), `${z}.png`);
}
function transparentTile(): PNG { return new PNG({ width: TILE_SIZE, height: TILE_SIZE, colorType: 6 }); }
function unique(values: readonly (readonly [number, number])[]): Array<readonly [number, number]> {
  return [...new Map(values.map((value) => [value.join(','), value])).values()];
}
async function readPng(file: string): Promise<PNG | null> {
  try { return PNG.sync.read(await readFile(file)); } catch (error) { if (isMissing(error)) return null; throw error; }
}
async function writePng(file: string, png: PNG): Promise<void> {
  await writeAtomic(file, PNG.sync.write(png, { deflateLevel: 3, deflateStrategy: 3 }));
}
async function writeAtomic(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
function copyPixel(source: PNG, sx: number, sy: number, target: PNG, tx: number, ty: number): void {
  const from = (source.width * sy + sx) << 2;
  const to = (target.width * ty + tx) << 2;
  target.data.set(source.data.subarray(from, from + 4), to);
}
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
