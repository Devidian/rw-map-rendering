import { AppConfig } from '../src/utils/app-config.js';

describe('AppConfig', () => {
  const previousEnv = process.env;

  beforeEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it('parses render server timeout and retry configuration', () => {
    process.env.RENDER_SERVERS_JSON = JSON.stringify([
      {
        ip: '127.0.0.1',
        port: 4255,
        baseUrl: 'http://127.0.0.1:3000/',
        name: 'Local',
        timeoutMs: 2500,
        retryAttempts: 2,
        retryBackoffMs: 10,
      },
    ]);

    expect(AppConfig.renderServers).toEqual([
      {
        ip: '127.0.0.1',
        port: 4255,
        baseUrl: 'http://127.0.0.1:3000',
        name: 'Local',
        timeoutMs: 2500,
        retryAttempts: 2,
        retryBackoffMs: 10,
      },
    ]);
  });

  it('drops invalid server entries', () => {
    process.env.RENDER_SERVERS_JSON = JSON.stringify([
      { ip: '', port: 4255, baseUrl: 'http://127.0.0.1:3000' },
      { ip: '127.0.0.1', port: 0, baseUrl: 'http://127.0.0.1:3000' },
      { ip: '127.0.0.1', port: 4255, baseUrl: 'not a url' },
    ]);

    expect(AppConfig.renderServers).toEqual([]);
  });
});
