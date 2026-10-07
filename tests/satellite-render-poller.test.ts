import { jest } from '@jest/globals';
import { SatelliteRenderPoller } from '../src/service/satellite-render-poller.js';
import type { NativeSatelliteSource } from '../src/service/native-satellite-source.js';
import type { SatelliteTileRenderer } from '../src/service/satellite-tile-renderer.js';
import type { RenderStateStore } from '../src/service/render-state-store.js';

const server = { ip: '127.0.0.1', port: 4254, baseUrl: 'http://127.0.0.1:4255' };
test('does not advance the satellite cursor when an image is unavailable', async () => {
  const source = {
    changes: jest.fn(async () => ({ chunks: [{ x: 0, z: 0, res: 128, revision: 1 }], nextChange: 1 })),
    image: jest.fn(async () => { throw new Error('missing image'); }),
  } as unknown as NativeSatelliteSource;
  const render = jest.fn(async () => undefined);
  const renderer = { render } as unknown as SatelliteTileRenderer;
  const setSatelliteCursor = jest.fn(async () => undefined);
  const state = { getServerState: jest.fn(async () => ({})), setSatelliteCursor } as unknown as RenderStateStore;
  const poller = new SatelliteRenderPoller(source, renderer, state);
  await expect(poller.pollServer(server)).rejects.toThrow('missing image');
  expect(render).not.toHaveBeenCalled();
  expect(setSatelliteCursor).not.toHaveBeenCalled();
});
