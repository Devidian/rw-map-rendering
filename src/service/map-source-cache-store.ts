import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MapBounds } from '../interfaces/map-bounds.js';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';

const CACHE_SCHEMA_VERSION = 2;
const SECTOR_SIZE_CHUNKS = 256;
const NATIVE_TILE_SIZE_CHUNKS = 2;

interface CachedChunk {
  schemaVersion: 1;
  chunkX: number;
  chunkZ: number;
  heightsBase64: string;
  texturesBase64: string;
  updatedAtMs: number;
  contentHash: string;
  biome: number | null;
  region: number | null;
}

interface CacheFile {
  chunks?: CachedChunk[];
}

interface CacheMetaFile {
  schemaVersion?: unknown;
  chunkBounds?: unknown;
  tileBounds?: unknown;
  totalChunks?: unknown;
}

export interface MapSourceCacheMergeResult {
  renderChunks: MapSourceChunk[];
  chunkBounds: MapBounds;
  tileBounds: MapBounds;
  totalChunks: number;
}

export class MapSourceCacheStore {
  constructor(private readonly cacheRoot: string) {}

  async getChunks(serverId: string): Promise<MapSourceChunk[]> {
    const legacy = await this.readLegacyChunks(serverId);
    if (legacy) return legacy;
    const chunks: MapSourceChunk[] = [];
    for (const shard of await this.listShardPaths(serverId)) {
      chunks.push(...await this.readShard(shard));
    }
    return sortChunks(chunks);
  }

  async replaceChunks(serverId: string, chunks: MapSourceChunk[]): Promise<MapSourceCacheMergeResult> {
    await mkdir(this.cacheRoot, { recursive: true });
    await rm(this.serverShardRoot(serverId), { recursive: true, force: true });
    const bySector = groupBy(chunks, sectorKey);
    for (const [key, sectorChunks] of bySector) {
      await this.writeShard(this.shardPath(serverId, key), sortChunks(sectorChunks));
    }
    const meta = boundsFor(chunks);
    await this.writeMeta(serverId, meta);
    return { renderChunks: sortChunks(chunks), ...meta };
  }

  async mergeChunks(serverId: string, chunks: MapSourceChunk[]): Promise<MapSourceCacheMergeResult> {
    await this.migrateLegacyCache(serverId);
    const affectedTileKeys = new Set(chunks.map(nativeTileKey));
    const bySector = groupBy(chunks, sectorKey);
    const renderChunks = new Map<string, MapSourceChunk>();
    let totalChunkDelta = 0;

    for (const [key, changedChunks] of bySector) {
      const shardPath = this.shardPath(serverId, key);
      const previous = await this.readShard(shardPath);
      const merged = new Map(previous.map((chunk) => [chunkKey(chunk), chunk]));
      for (const chunk of changedChunks) merged.set(chunkKey(chunk), chunk);
      const sectorChunks = sortChunks([...merged.values()]);
      totalChunkDelta += sectorChunks.length - previous.length;
      await this.writeShard(shardPath, sectorChunks);
      for (const chunk of sectorChunks) {
        if (affectedTileKeys.has(nativeTileKey(chunk))) renderChunks.set(chunkKey(chunk), chunk);
      }
    }

    const previousMeta = await this.readMeta(serverId);
    const meta = previousMeta
      ? expandBounds({ ...previousMeta, totalChunks: previousMeta.totalChunks + totalChunkDelta }, chunks)
      : boundsFor(await this.getChunks(serverId));
    await this.writeMeta(serverId, meta);
    return { renderChunks: sortChunks([...renderChunks.values()]), ...meta };
  }

  private async readLegacyChunks(serverId: string): Promise<MapSourceChunk[] | null> {
    try {
      const parsed = JSON.parse(await readFile(this.legacyCachePath(serverId), 'utf8')) as unknown;
      const file = parsed && typeof parsed === 'object' ? parsed as CacheFile : {};
      return Array.isArray(file.chunks) ? sortChunks(file.chunks.map(fromCachedChunk)) : [];
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async migrateLegacyCache(serverId: string): Promise<void> {
    if (await this.readMeta(serverId)) return;
    const legacy = await this.readLegacyChunks(serverId);
    if (!legacy) return;
    await this.replaceChunks(serverId, legacy);
  }

  private async readMeta(serverId: string): Promise<Omit<MapSourceCacheMergeResult, 'renderChunks'> | null> {
    try {
      const parsed = JSON.parse(await readFile(this.metaPath(serverId), 'utf8')) as CacheMetaFile;
      if (
        parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
        !isBounds(parsed.chunkBounds) ||
        !isBounds(parsed.tileBounds) ||
        !Number.isSafeInteger(parsed.totalChunks) ||
        (parsed.totalChunks as number) < 0
      ) return null;
      return {
        chunkBounds: parsed.chunkBounds,
        tileBounds: parsed.tileBounds,
        totalChunks: parsed.totalChunks as number,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async writeMeta(
    serverId: string,
    meta: Omit<MapSourceCacheMergeResult, 'renderChunks'>,
  ): Promise<void> {
    await mkdir(this.cacheRoot, { recursive: true });
    await writeFile(this.metaPath(serverId), `${JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      ...meta,
    }, null, 2)}\n`);
  }

  private async readShard(filePath: string): Promise<MapSourceChunk[]> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      const file = parsed && typeof parsed === 'object' ? parsed as CacheFile : {};
      return Array.isArray(file.chunks) ? file.chunks.map(fromCachedChunk) : [];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private async writeShard(filePath: string, chunks: MapSourceChunk[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, chunks: chunks.map(toCachedChunk) }, null, 2)}\n`);
  }

  private async listShardPaths(serverId: string): Promise<string[]> {
    const serverRoot = this.serverShardRoot(serverId);
    try {
      const sectorXEntries = await readdir(serverRoot, { withFileTypes: true });
      const result: string[] = [];
      for (const sectorXEntry of sectorXEntries) {
        if (!sectorXEntry.isDirectory()) continue;
        const sectorXRoot = path.join(serverRoot, sectorXEntry.name);
        const sectorZEntries = await readdir(sectorXRoot, { withFileTypes: true });
        for (const sectorZEntry of sectorZEntries) {
          if (sectorZEntry.isFile() && sectorZEntry.name.endsWith('.json')) {
            result.push(path.join(sectorXRoot, sectorZEntry.name));
          }
        }
      }
      return result.sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private legacyCachePath(serverId: string): string {
    return path.join(this.cacheRoot, `${serverId}.json`);
  }

  private metaPath(serverId: string): string {
    return path.join(this.cacheRoot, `${serverId}.meta.json`);
  }

  private serverShardRoot(serverId: string): string {
    return path.join(this.cacheRoot, serverId);
  }

  private shardPath(serverId: string, key: string): string {
    const [sectorX, sectorZ] = key.split(',');
    return path.join(this.serverShardRoot(serverId), sectorX, `${sectorZ}.json`);
  }
}

export function mapSourceCacheRoot(mapRoot: string): string {
  return path.join(mapRoot, '.state', 'source-cache');
}

function toCachedChunk(chunk: MapSourceChunk): CachedChunk {
  return {
    schemaVersion: 1,
    chunkX: chunk.chunkX,
    chunkZ: chunk.chunkZ,
    heightsBase64: chunk.heights.toString('base64'),
    texturesBase64: chunk.textures.toString('base64'),
    updatedAtMs: chunk.updatedAtMs,
    contentHash: chunk.contentHash,
    biome: chunk.biome,
    region: chunk.region,
  };
}

function fromCachedChunk(chunk: CachedChunk): MapSourceChunk {
  return {
    schemaVersion: 1,
    chunkX: chunk.chunkX,
    chunkZ: chunk.chunkZ,
    heights: Buffer.from(chunk.heightsBase64, 'base64'),
    textures: Buffer.from(chunk.texturesBase64, 'base64'),
    updatedAtMs: chunk.updatedAtMs,
    contentHash: chunk.contentHash,
    biome: chunk.biome,
    region: chunk.region,
  };
}

function chunkKey(chunk: Pick<MapSourceChunk, 'chunkX' | 'chunkZ'>): `${number},${number}` {
  return `${chunk.chunkX},${chunk.chunkZ}`;
}

function sectorKey(chunk: Pick<MapSourceChunk, 'chunkX' | 'chunkZ'>): `${number},${number}` {
  return `${floorDiv(chunk.chunkX, SECTOR_SIZE_CHUNKS)},${floorDiv(chunk.chunkZ, SECTOR_SIZE_CHUNKS)}`;
}

function nativeTileKey(chunk: Pick<MapSourceChunk, 'chunkX' | 'chunkZ'>): `${number},${number}` {
  return `${floorDiv(chunk.chunkX, NATIVE_TILE_SIZE_CHUNKS)},${floorDiv(chunk.chunkZ, NATIVE_TILE_SIZE_CHUNKS)}`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = result.get(key);
    if (group) group.push(item);
    else result.set(key, [item]);
  }
  return result;
}

function sortChunks(chunks: MapSourceChunk[]): MapSourceChunk[] {
  return chunks.sort((a, b) => a.updatedAtMs - b.updatedAtMs || a.chunkX - b.chunkX || a.chunkZ - b.chunkZ);
}

function boundsFor(chunks: MapSourceChunk[]): Omit<MapSourceCacheMergeResult, 'renderChunks'> {
  return {
    chunkBounds: bounds(chunks.map((chunk) => [chunk.chunkX, chunk.chunkZ])),
    tileBounds: bounds(chunks.map((chunk) => [
      floorDiv(chunk.chunkX, NATIVE_TILE_SIZE_CHUNKS),
      floorDiv(chunk.chunkZ, NATIVE_TILE_SIZE_CHUNKS),
    ])),
    totalChunks: chunks.length,
  };
}

function expandBounds(
  current: Omit<MapSourceCacheMergeResult, 'renderChunks'>,
  chunks: MapSourceChunk[],
): Omit<MapSourceCacheMergeResult, 'renderChunks'> {
  if (chunks.length === 0) return current;
  return {
    chunkBounds: mergeBounds(current.chunkBounds, bounds(chunks.map((chunk) => [chunk.chunkX, chunk.chunkZ]))),
    tileBounds: mergeBounds(current.tileBounds, bounds(chunks.map((chunk) => [
      floorDiv(chunk.chunkX, NATIVE_TILE_SIZE_CHUNKS),
      floorDiv(chunk.chunkZ, NATIVE_TILE_SIZE_CHUNKS),
    ]))),
    totalChunks: current.totalChunks,
  };
}

function bounds(coordinates: Array<[number, number]>): MapBounds {
  return coordinates.reduce<MapBounds>(
    (result, [x, z]) => ({
      minX: Math.min(result.minX, x),
      minZ: Math.min(result.minZ, z),
      maxX: Math.max(result.maxX, x),
      maxZ: Math.max(result.maxZ, z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
}

function mergeBounds(a: MapBounds, b: MapBounds): MapBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function isBounds(value: unknown): value is MapBounds {
  if (value === null || typeof value !== 'object') return false;
  const boundsValue = value as Partial<MapBounds>;
  return (
    Number.isInteger(boundsValue.minX) &&
    Number.isInteger(boundsValue.minZ) &&
    Number.isInteger(boundsValue.maxX) &&
    Number.isInteger(boundsValue.maxZ) &&
    boundsValue.minX! <= boundsValue.maxX! &&
    boundsValue.minZ! <= boundsValue.maxZ!
  );
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
