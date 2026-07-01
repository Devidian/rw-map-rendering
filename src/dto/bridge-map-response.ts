export interface BridgeMapChunkDto {
  schemaVersion: unknown;
  chunkX: unknown;
  chunkZ: unknown;
  heightsBase64: unknown;
  texturesBase64: unknown;
  updatedAtMs: unknown;
  contentHash: unknown;
  biome: unknown;
  region: unknown;
}

export interface BridgeMapResponseDto {
  schemaVersion?: unknown;
  full?: unknown;
  nextChange?: unknown;
  partial?: unknown;
  nextOffset?: unknown;
  chunks?: unknown;
}
