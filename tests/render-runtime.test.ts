import { RendererRuntime } from '../src/service/render-runtime.js';

describe('RendererRuntime', () => {
  it('reports empty server configuration without polling', () => {
    const runtime = new RendererRuntime([], { pollServer: async () => {
      throw new Error('should not poll');
    } });

    expect(runtime.status()).toEqual({ servers: 0, running: true });
    runtime.stop();
    expect(runtime.status()).toEqual({ servers: 0, running: false });
  });
});
