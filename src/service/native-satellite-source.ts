import type { RenderServerConfig } from '../interfaces/render-server-config.js';

export interface SatelliteChange {
  x: number;
  z: number;
  res: number;
  revision: number;
}

export class NativeSatelliteSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async changes(server: RenderServerConfig, cursor?: number): Promise<{ chunks: SatelliteChange[]; nextChange: number } | null> {
    let offset = 0;
    let nextChange = cursor ?? 0;
    const chunks: SatelliteChange[] = [];
    for (;;) {
      const url = this.url(server, 'sat-changes');
      if (cursor !== undefined) url.searchParams.set('lastChange', String(cursor));
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', String(offset));
      const response = await this.fetchImpl(url, this.init(server));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Satellite changes returned HTTP ${response.status}`);
      const value = await response.json() as Record<string, unknown>;
      if (value.schemaVersion !== 1 || !Array.isArray(value.chunks) || !nonNegativeInteger(value.nextChange)
          || typeof value.partial !== 'boolean') throw new Error('Invalid satellite changes');
      const page = value.chunks.map(decodeChange);
      chunks.push(...page);
      nextChange = value.nextChange;
      if (!value.partial) return { chunks, nextChange };
      if (!nonNegativeInteger(value.nextOffset) || value.nextOffset <= offset || page.length === 0) {
        throw new Error('Invalid satellite pagination');
      }
      offset = value.nextOffset;
    }
  }

  async image(server: RenderServerConfig, change: SatelliteChange): Promise<Buffer> {
    const url = this.url(server, 'sat-tile');
    url.searchParams.set('x', String(change.x));
    url.searchParams.set('z', String(change.z));
    url.searchParams.set('res', String(change.res));
    const response = await this.fetchImpl(url, this.init(server));
    if (!response.ok) throw new Error(`Satellite image returned HTTP ${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > 8 * 1024 * 1024) throw new Error('Invalid satellite image size');
    return content;
  }

  private url(server: RenderServerConfig, route: string): URL {
    return new URL(`/plugins/oz---admin-utils/${route}`, `${server.baseUrl}/`);
  }

  private init(server: RenderServerConfig): RequestInit | undefined {
    return server.timeoutMs === undefined ? undefined : { signal: AbortSignal.timeout(server.timeoutMs) };
  }
}

function decodeChange(value: unknown): SatelliteChange {
  if (!value || typeof value !== 'object') throw new Error('Invalid satellite change');
  const entry = value as Record<string, unknown>;
  if (!Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.z) || !nonNegativeInteger(entry.revision)
      || !Number.isInteger(entry.res) || ![64, 128, 256, 512, 1024].includes(entry.res as number)) {
    throw new Error('Invalid satellite change');
  }
  return entry as unknown as SatelliteChange;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
