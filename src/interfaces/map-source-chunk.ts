export interface MapSourceChunk {
  schemaVersion: 1;
  chunkX: number;
  chunkZ: number;
  heights: Buffer;
  textures: Buffer;
  updatedAtMs: number;
  contentHash: string;
  biome: number | null;
  region: number | null;
}
