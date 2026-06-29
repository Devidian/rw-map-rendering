import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';

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

export class MapSourceCacheStore {
  constructor(private readonly cacheRoot: string) {}

  async getChunks(serverId: string): Promise<MapSourceChunk[]> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath(serverId), 'utf8')) as unknown;
      const file = parsed && typeof parsed === 'object' ? parsed as CacheFile : {};
      return Array.isArray(file.chunks) ? file.chunks.map(fromCachedChunk) : [];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async mergeChunks(serverId: string, chunks: MapSourceChunk[]): Promise<MapSourceChunk[]> {
    const previous = await this.getChunks(serverId);
    const merged = new Map(previous.map((chunk) => [chunkKey(chunk), chunk]));
    for (const chunk of chunks) merged.set(chunkKey(chunk), chunk);
    const snapshot = [...merged.values()].sort((a, b) => a.updatedAtMs - b.updatedAtMs || a.chunkX - b.chunkX || a.chunkZ - b.chunkZ);
    await mkdir(this.cacheRoot, { recursive: true });
    await writeFile(this.cachePath(serverId), `${JSON.stringify({ chunks: snapshot.map(toCachedChunk) }, null, 2)}\n`);
    return snapshot;
  }

  private cachePath(serverId: string): string {
    return path.join(this.cacheRoot, `${serverId}.json`);
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

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
