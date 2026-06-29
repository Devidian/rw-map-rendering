import type { BridgeMapChunkDto, BridgeMapResponseDto } from '../dto/bridge-map-response.js';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';
import type { RenderServerConfig } from '../interfaces/render-server-config.js';

const HEIGHT_BYTES = 4096;
const TEXTURE_BYTES = 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface BridgeMapSourceResult {
  full: boolean;
  nextChange: number | null;
  chunks: MapSourceChunk[];
}

export class InvalidBridgeMapResponseError extends Error {}

export class BridgeMapSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchMapData(
    server: RenderServerConfig,
    lastChange?: number,
  ): Promise<BridgeMapSourceResult> {
    const url = new URL('/plugins/ozadminutils/map', `${server.baseUrl}/`);
    if (lastChange !== undefined) url.searchParams.set('lastChange', String(lastChange));
    const init = server.timeoutMs === undefined
      ? undefined
      : { signal: AbortSignal.timeout(server.timeoutMs) };
    const response = await this.fetchImpl(url, init);
    if (!response.ok) throw new Error(`Map source returned HTTP ${response.status}`);
    return decodeBridgeMapResponse(await response.json());
  }
}

export function decodeBridgeMapResponse(value: unknown): BridgeMapSourceResult {
  if (!value || typeof value !== 'object') throw new InvalidBridgeMapResponseError('Invalid map response');
  const dto = value as BridgeMapResponseDto;
  if (dto.schemaVersion !== 1 || typeof dto.full !== 'boolean' || !Array.isArray(dto.chunks)) {
    throw new InvalidBridgeMapResponseError('Invalid map response');
  }
  if (dto.nextChange !== null && !isNonNegativeInteger(dto.nextChange)) {
    throw new InvalidBridgeMapResponseError('Invalid map response cursor');
  }
  return {
    full: dto.full,
    nextChange: dto.nextChange,
    chunks: dto.chunks.map((chunk) => decodeChunk(chunk as BridgeMapChunkDto)),
  };
}

function decodeChunk(value: BridgeMapChunkDto): MapSourceChunk {
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.chunkX) ||
    !Number.isSafeInteger(value.chunkZ) ||
    typeof value.heightsBase64 !== 'string' ||
    typeof value.texturesBase64 !== 'string' ||
    !Number.isSafeInteger(value.updatedAtMs) ||
    (value.updatedAtMs as number) < 0 ||
    typeof value.contentHash !== 'string' ||
    !HASH_PATTERN.test(value.contentHash) ||
    !isNullableInteger(value.biome) ||
    !isNullableInteger(value.region)
  ) {
    throw new InvalidBridgeMapResponseError('Invalid map chunk');
  }
  const heights = Buffer.from(value.heightsBase64, 'base64');
  const textures = Buffer.from(value.texturesBase64, 'base64');
  if (heights.length !== HEIGHT_BYTES || textures.length !== TEXTURE_BYTES) {
    throw new InvalidBridgeMapResponseError('Invalid map chunk binary payload');
  }
  return {
    schemaVersion: 1,
    chunkX: value.chunkX as number,
    chunkZ: value.chunkZ as number,
    heights,
    textures,
    updatedAtMs: value.updatedAtMs as number,
    contentHash: value.contentHash,
    biome: value.biome as number | null,
    region: value.region as number | null,
  };
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
