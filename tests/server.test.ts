import request from 'supertest';
import { createApp } from '../src/server.js';

describe('createApp', () => {
  it('serves health with runtime status', async () => {
    await request(createApp({ status: () => ({ servers: 2, running: true }) }))
      .get('/health')
      .expect(200)
      .expect({
        ok: true,
        service: 'rw-map-rendering',
        runtime: { servers: 2, running: true },
      });
  });
});
