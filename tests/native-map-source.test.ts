import {
  decodeNativeMapResponse,
  InvalidNativeMapResponseError,
  MapExportBusyError,
  MapSourceNotFoundError,
  NativeMapSource,
} from '../src/service/native-map-source.js';

function chunk() {
  return {
    schemaVersion: 1,
    chunkX: 1,
    chunkZ: 2,
    heightsBase64: Buffer.alloc(4096).toString('base64'),
    texturesBase64: Buffer.alloc(1024).toString('base64'),
    updatedAtMs: 1000,
    contentHash: 'a'.repeat(64),
    biome: null,
    region: 3,
  };
}

describe('NativeMapSource', () => {
  test('uses the game-derived Admin Utils handler path', async () => {
    const calls: string[] = [];
    const source = new NativeMapSource(async (url, init) => {
      expect(init?.headers).toBeUndefined();
      calls.push(url.toString());
      return new Response(JSON.stringify({ schemaVersion: 1, full: false, nextChange: null, chunks: [] }));
    });

    await source.fetchMapData({ ip: '127.0.0.1', port: 4255, baseUrl: 'http://127.0.0.1:3000' }, 1000);

    expect(calls).toEqual(['http://127.0.0.1:3000/plugins/oz---admin-utils/map?lastChange=1000&limit=100&offset=0']);
  });

  test('paginates delta exports before returning a cursor that may advance', async () => {
    const calls: string[] = [];
    const source = new NativeMapSource(async (url) => {
      calls.push(url.toString());
      const offset = new URL(url).searchParams.get('offset');
      return new Response(JSON.stringify({
        schemaVersion: 1,
        full: false,
        nextChange: offset === '0' ? 1000 : 2000,
        partial: offset === '0',
        nextOffset: offset === '0' ? 100 : undefined,
        chunks: [chunk()],
      }));
    });

    const result = await source.fetchMapData({ ip: '127.0.0.1', port: 4255, baseUrl: 'http://127.0.0.1:3000' }, 500);

    expect(result.full).toBe(false);
    expect(result.chunks).toHaveLength(2);
    expect(result.nextChange).toBe(2000);
    expect(calls).toEqual([
      'http://127.0.0.1:3000/plugins/oz---admin-utils/map?lastChange=500&limit=100&offset=0',
      'http://127.0.0.1:3000/plugins/oz---admin-utils/map?lastChange=500&limit=100&offset=100',
    ]);
  });

  test('keeps map payload validation unchanged', () => {
    expect(decodeNativeMapResponse({
      schemaVersion: 1,
      full: true,
      nextChange: 1000,
      chunks: [chunk()],
    }).chunks).toHaveLength(1);
    expect(() => decodeNativeMapResponse({ schemaVersion: 1, full: true, nextChange: 0, chunks: [{}] }))
      .toThrow(InvalidNativeMapResponseError);
  });

  test('accepts the null nextOffset emitted by Admin Utils on the final page', () => {
    expect(decodeNativeMapResponse({
      schemaVersion: 1,
      full: true,
      nextChange: 1000,
      partial: false,
      nextOffset: null,
      chunks: [chunk()],
    }).nextOffset).toBeUndefined();
  });

  test('uses the server retry delay while a map export is active', async () => {
    const source = new NativeMapSource(async () => new Response('', {
      status: 429,
      headers: { 'Retry-After': '2' },
    }));

    await expect(source.fetchMapData({ ip: '127.0.0.1', port: 4255, baseUrl: 'http://127.0.0.1:3000' }))
      .rejects.toEqual(expect.objectContaining<MapExportBusyError>({ retryAfterMs: 2000 }));
  });

  test('reports the full missing source URL for a 404', async () => {
    const source = new NativeMapSource(async () => new Response('', { status: 404 }));

    await expect(source.fetchMapData({ ip: '127.0.0.1', port: 4255, baseUrl: 'http://127.0.0.1:3000' }))
      .rejects.toEqual(expect.objectContaining<MapSourceNotFoundError>({
        url: 'http://127.0.0.1:3000/plugins/oz---admin-utils/map?limit=100&offset=0',
      }));
  });
});
