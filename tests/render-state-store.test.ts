import { mkdtempSync } from 'node:fs';
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
});
