import { MapSourceNotFoundError } from '../src/service/native-map-source.js';
import { mapRenderPollErrorMessage, RendererRuntime } from '../src/service/render-runtime.js';

describe('RendererRuntime', () => {
  it('polls each configured game server independently', async () => {
    const called: number[] = [];
    let done!: () => void;
    const bothPolled = new Promise<void>((resolve) => { done = resolve; });
    const servers = [
      { ip: '127.0.0.1', port: 5255, baseUrl: 'http://127.0.0.1:5254', mapAckToken: 'x'.repeat(32) },
      { ip: '127.0.0.2', port: 4255, baseUrl: 'http://127.0.0.2:4254' },
    ];
    const runtime = new RendererRuntime(servers, { pollServer: async (server) => {
      called.push(server.port);
      if (called.length === 2) done();
      return { serverId: String(server.port), fetched: 0, rendered: 0 };
    } }, 60000);
    runtime.start();
    try {
      await bothPolled;
      expect(called.sort()).toEqual([4255, 5255]);
      expect(runtime.status()).toEqual({ servers: 2, running: true });
    } finally {
      runtime.stop();
    }
  });
  it('reports empty server configuration without polling', () => {
    const runtime = new RendererRuntime([], { pollServer: async () => {
      throw new Error('should not poll');
    } });

    expect(runtime.status()).toEqual({ servers: 0, running: true });
    runtime.stop();
    expect(runtime.status()).toEqual({ servers: 0, running: false });
  });

  it('formats a missing map source without an Error prefix', () => {
    expect(mapRenderPollErrorMessage(new MapSourceNotFoundError('http://example.test/plugins/oz---admin-utils/map')))
      .toBe('Map render poll failed: Source url http://example.test/plugins/oz---admin-utils/map not found (404)');
  });
});
