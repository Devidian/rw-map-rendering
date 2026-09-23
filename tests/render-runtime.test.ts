import { MapSourceNotFoundError } from '../src/service/native-map-source.js';
import { mapRenderPollErrorMessage, RendererRuntime } from '../src/service/render-runtime.js';

describe('RendererRuntime', () => {
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
