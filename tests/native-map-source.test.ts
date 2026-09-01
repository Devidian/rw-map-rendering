import {
  decodeNativeMapResponse,
  InvalidNativeMapResponseError,
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
    const source = new NativeMapSource(async (url) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ schemaVersion: 1, full: false, nextChange: null, chunks: [] }));
    });

    await source.fetchMapData({ ip: '127.0.0.1', port: 4255, baseUrl: 'http://127.0.0.1:3000' }, 1000);

    expect(calls).toEqual(['http://127.0.0.1:3000/plugins/oz---admin-utils/map?lastChange=1000']);
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
});
