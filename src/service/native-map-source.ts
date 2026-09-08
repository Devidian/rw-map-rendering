import type { NativeMapChunkDto, NativeMapResponseDto } from '../dto/native-map-response.js';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';
import type { RenderServerConfig } from '../interfaces/render-server-config.js';

const HEIGHT_BYTES = 4096;
const TEXTURE_BYTES = 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FULL_SYNC_PAGE_LIMIT = 100;

export interface NativeMapSourceResult {
  full: boolean;
  nextChange: number | null;
  partial?: boolean;
  nextOffset?: number;
  chunks: MapSourceChunk[];
}

export interface NativeMapStreamResult {
  full: boolean;
  nextChange: number | null;
  fetched: number;
}

export class InvalidNativeMapResponseError extends Error {}

export class MapExportBusyError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Map export is busy');
  }
}

/** Reads the Admin Utils map export through Rising World's native handler path. */
export class NativeMapSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchMapData(server: RenderServerConfig, lastChange?: number): Promise<NativeMapSourceResult> {
    const chunks: MapSourceChunk[] = [];
    const result = await this.streamMapData(server, lastChange, async (page) => {
      chunks.push(...page.chunks);
    });
    return { full: result.full, nextChange: result.nextChange, partial: false, chunks };
  }

  async streamMapData(
    server: RenderServerConfig,
    lastChange: number | undefined,
    consume: (page: NativeMapSourceResult) => Promise<void>,
  ): Promise<NativeMapStreamResult> {
    return this.fetchPagedMapData(server, lastChange, consume);
  }

  private async fetchPagedMapData(
    server: RenderServerConfig,
    lastChange?: number,
    consume?: (page: NativeMapSourceResult) => Promise<void>,
  ): Promise<NativeMapStreamResult> {
    let fetched = 0;
    let nextChange: number | null = null;
    let offset = 0;
    for (;;) {
      const page = await this.fetchMapDataPage(server, lastChange, { limit: FULL_SYNC_PAGE_LIMIT, offset });
      fetched += page.chunks.length;
      if (consume) await consume(page);
      if (page.nextChange !== null) nextChange = page.nextChange;
      if (!page.partial) return { full: lastChange === undefined, nextChange, fetched };
      offset = page.nextOffset ?? offset + FULL_SYNC_PAGE_LIMIT;
    }
  }

  private async fetchMapDataPage(
    server: RenderServerConfig,
    lastChange?: number,
    pagination?: { limit: number; offset: number },
  ): Promise<NativeMapSourceResult> {
    const url = new URL('/plugins/oz---admin-utils/map', `${server.baseUrl}/`);
    if (lastChange !== undefined) url.searchParams.set('lastChange', String(lastChange));
    if (pagination) {
      url.searchParams.set('limit', String(pagination.limit));
      url.searchParams.set('offset', String(pagination.offset));
    }
    const init = server.timeoutMs === undefined ? undefined : { signal: AbortSignal.timeout(server.timeoutMs) };
    const response = await this.fetchImpl(url, init);
    if (response.status === 429) throw new MapExportBusyError(retryAfterMilliseconds(response.headers.get('Retry-After')));
    if (!response.ok) throw new Error(`Map source returned HTTP ${response.status}`);
    return decodeNativeMapResponse(await response.json());
  }
}

function retryAfterMilliseconds(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 1000;
  return Math.max(1000, Number(value) * 1000);
}

export function decodeNativeMapResponse(value: unknown): NativeMapSourceResult {
  if (!value || typeof value !== 'object') throw new InvalidNativeMapResponseError('Invalid map response');
  const dto = value as NativeMapResponseDto;
  if (dto.schemaVersion !== 1 || typeof dto.full !== 'boolean' || !Array.isArray(dto.chunks)) {
    throw new InvalidNativeMapResponseError('Invalid map response');
  }
  if (dto.nextChange !== null && !isNonNegativeInteger(dto.nextChange)) {
    throw new InvalidNativeMapResponseError('Invalid map response cursor');
  }
  return {
    full: dto.full,
    nextChange: dto.nextChange,
    partial: dto.partial === true,
    nextOffset: dto.nextOffset === undefined ? undefined : decodeNextOffset(dto.nextOffset),
    chunks: dto.chunks.map((chunk) => decodeChunk(chunk as NativeMapChunkDto)),
  };
}

function decodeNextOffset(value: unknown): number {
  if (!isNonNegativeInteger(value)) throw new InvalidNativeMapResponseError('Invalid map response nextOffset');
  return value;
}

function decodeChunk(value: NativeMapChunkDto): MapSourceChunk {
  if (
    value.schemaVersion !== 1 || !Number.isSafeInteger(value.chunkX) || !Number.isSafeInteger(value.chunkZ)
    || typeof value.heightsBase64 !== 'string' || typeof value.texturesBase64 !== 'string'
    || !Number.isSafeInteger(value.updatedAtMs) || (value.updatedAtMs as number) < 0
    || typeof value.contentHash !== 'string' || !HASH_PATTERN.test(value.contentHash)
    || !isNullableInteger(value.biome) || !isNullableInteger(value.region)
  ) throw new InvalidNativeMapResponseError('Invalid map chunk');
  const heights = Buffer.from(value.heightsBase64, 'base64');
  const textures = Buffer.from(value.texturesBase64, 'base64');
  if (heights.length !== HEIGHT_BYTES || textures.length !== TEXTURE_BYTES) {
    throw new InvalidNativeMapResponseError('Invalid map chunk binary payload');
  }
  return {
    schemaVersion: 1, chunkX: value.chunkX as number, chunkZ: value.chunkZ as number,
    heights, textures, updatedAtMs: value.updatedAtMs as number, contentHash: value.contentHash,
    biome: value.biome as number | null, region: value.region as number | null,
  };
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
