import { BridgeMapSource, decodeBridgeMapResponse, InvalidBridgeMapResponseError } from '../src/service/bridge-map-source.js';

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

describe('decodeBridgeMapResponse', () => {
  it('decodes valid bridge map data', () => {
    const result = decodeBridgeMapResponse({
      schemaVersion: 1,
      full: true,
      nextChange: 1000,
      chunks: [chunk()],
    });

    expect(result).toEqual({
      full: true,
      nextChange: 1000,
      chunks: [
        expect.objectContaining({
          schemaVersion: 1,
          chunkX: 1,
          chunkZ: 2,
          updatedAtMs: 1000,
          contentHash: 'a'.repeat(64),
          biome: null,
          region: 3,
        }),
      ],
    });
    expect(result.chunks[0].heights).toHaveLength(4096);
    expect(result.chunks[0].textures).toHaveLength(1024);
  });

  it('rejects invalid binary payloads', () => {
    expect(() => decodeBridgeMapResponse({
      schemaVersion: 1,
      full: true,
      nextChange: 1000,
      chunks: [{ ...chunk(), heightsBase64: Buffer.alloc(1).toString('base64') }],
    })).toThrow(InvalidBridgeMapResponseError);
  });
});

describe('BridgeMapSource', () => {
  it('passes timeout signal and lastChange to fetch', async () => {
    const calls: Array<{ url: string; hasSignal: boolean }> = [];
    const source = new BridgeMapSource(async (url, init) => {
      calls.push({ url: url.toString(), hasSignal: init?.signal !== undefined });
      return new Response(JSON.stringify({
        schemaVersion: 1,
        full: false,
        nextChange: null,
        chunks: [],
      }), { status: 200 });
    });

    await source.fetchMapData({
      ip: '127.0.0.1',
      port: 4255,
      baseUrl: 'http://127.0.0.1:3000',
      timeoutMs: 2500,
    }, 1000);

    expect(calls).toEqual([{
      url: 'http://127.0.0.1:3000/plugins/ozadminutils/map?lastChange=1000',
      hasSignal: true,
    }]);
  });
});
