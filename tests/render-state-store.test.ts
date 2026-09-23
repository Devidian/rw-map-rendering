import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RenderStateStore } from '../src/service/render-state-store.js';

describe('RenderStateStore', () => {
  it('persists per-server cursors', async () => {
    const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'rw-render-state-')), 'state.json');
    const store = new RenderStateStore(statePath);

    await expect(store.getServerState('server-test')).resolves.toEqual({});
    await store.setServerCursor('server-test', 1234);

    await expect(new RenderStateStore(statePath).getServerState('server-test')).resolves.toEqual({
      cursor: 1234,
    });
  });

  it('serializes concurrent cursor updates without dropping a server state', async () => {
    const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'rw-render-state-')), 'state.json');
    const store = new RenderStateStore(statePath);

    await Promise.all([
      store.setServerCursor('server-one', 1000),
      store.setServerCursor('server-two', 2000),
      store.setServerCursor('server-three', 3000),
    ]);

    const restored = new RenderStateStore(statePath);
    await expect(restored.getServerState('server-one')).resolves.toEqual({ cursor: 1000 });
    await expect(restored.getServerState('server-two')).resolves.toEqual({ cursor: 2000 });
    await expect(restored.getServerState('server-three')).resolves.toEqual({ cursor: 3000 });
  });

  it('rebuilds malformed state on the next cursor update', async () => {
    const statePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'rw-render-state-')), 'state.json');
    writeFileSync(statePath, '{');
    const store = new RenderStateStore(statePath);

    await expect(store.getServerState('server-test')).resolves.toEqual({});
    await store.setServerCursor('server-test', 1234);

    await expect(new RenderStateStore(statePath).getServerState('server-test')).resolves.toEqual({ cursor: 1234 });
  });
});
