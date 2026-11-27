import { MapSourceNotFoundError } from '../src/service/native-map-source.js';
import { mapRenderPollErrorMessage, RendererRuntime } from '../src/service/render-runtime.js';
import { jest } from '@jest/globals';

describe('RendererRuntime', () => {
  it('keeps healthy servers polling while another remains in flight, and stops rescheduling', async () => {
    jest.useFakeTimers();
    let resolveSlow!: () => void;
    const slow = new Promise<void>((resolve) => { resolveSlow = resolve; });
    const calls: string[] = [];
    const servers = [
      { ip: 'slow', port: 4255, baseUrl: 'http://slow' },
      { ip: 'fast', port: 4255, baseUrl: 'http://fast' },
    ];
    const runtime = new RendererRuntime(servers, { pollServer: async (server) => {
      calls.push(`terrain:${server.ip}`);
      if (server.ip === 'slow') await slow;
      return { serverId: server.ip, fetched: 0, rendered: 0 };
    } }, 100, { pollServer: async (server) => { calls.push(`satellite:${server.ip}`); } });
    try {
      runtime.start();
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(250);
      expect(calls.filter((call) => call === 'terrain:slow')).toHaveLength(1);
      expect(calls.filter((call) => call === 'terrain:fast')).toHaveLength(3);
      expect(calls.filter((call) => call === 'satellite:fast')).toHaveLength(3);
      runtime.stop();
      resolveSlow();
      await jest.advanceTimersByTimeAsync(500);
      expect(calls.filter((call) => call === 'terrain:slow')).toHaveLength(1);
      expect(calls.filter((call) => call === 'terrain:fast')).toHaveLength(3);
      expect(calls).not.toContain('satellite:slow');
    } finally {
      runtime.stop();
      resolveSlow();
      jest.useRealTimers();
    }
  });

  it('serializes duplicate server identities and keeps terrain before satellite', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const servers = [
      { ip: 'same', port: 4255, baseUrl: 'http://one' },
      { ip: 'same', port: 4255, baseUrl: 'http://two' },
    ];
    const runtime = new RendererRuntime(servers, { pollServer: async (server) => {
      calls.push(`terrain:${server.baseUrl}`);
      if (server.baseUrl === 'http://one') await first;
      return { serverId: server.ip, fetched: 0, rendered: 0 };
    } }, 100, { pollServer: async (server) => { calls.push(`satellite:${server.baseUrl}`); } });
    try {
      runtime.start();
      await jest.advanceTimersByTimeAsync(200);
      expect(calls).toEqual(['terrain:http://one']);
      release();
      await jest.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['terrain:http://one', 'satellite:http://one',
        'terrain:http://two', 'satellite:http://two']);
    } finally {
      runtime.stop();
      release();
      jest.useRealTimers();
    }
  });

  it('continues to satellite after terrain failure and never overlaps a pending satellite', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let terrainCalls = 0;
    let satelliteCalls = 0;
    const runtime = new RendererRuntime([{ ip: 'one', port: 4255, baseUrl: 'http://one' }], {
      pollServer: async () => {
        terrainCalls += 1;
        if (terrainCalls === 1) throw new Error('injected terrain failure');
        return { serverId: 'one', fetched: 0, rendered: 0 };
      },
    }, 100, { pollServer: async () => { satelliteCalls += 1; await pending; } });
    try {
      runtime.start();
      runtime.start();
      await jest.advanceTimersByTimeAsync(300);
      expect(terrainCalls).toBe(1);
      expect(satelliteCalls).toBe(1);
      release();
      await jest.advanceTimersByTimeAsync(100);
      expect(terrainCalls).toBe(2);
      expect(satelliteCalls).toBe(2);
    } finally {
      runtime.stop();
      release();
      jest.useRealTimers();
    }
  });
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
