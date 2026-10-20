import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { SftpPublisher } from '../src/service/sftp-publisher.js';

const serverId = 'server-1234567890abcdef12345678';
const config = {
  target: 'webspace:maps',
  configFile: '/config/rclone.conf',
  idleSyncMs: 300000,
  fullSyncMs: 3600000,
};

describe('SftpPublisher', () => {
  let root: string;

  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'sftp-publisher-')); });
  afterEach(async () => {
    jest.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('copies recent files to a dedicated server directory without deleting remote files', async () => {
    const calls: string[][] = [];
    const publisher = new SftpPublisher(root, config, async (_command, args) => { calls.push(args); });

    await publisher.publishServer(serverId);
    publisher.stop();

    expect(calls).toEqual([[
      '--config', '/config/rclone.conf', 'copy', '--transfers', '2', '--checkers', '2',
      '--no-traverse', '--max-age', '3600000ms', path.join(root, serverId), `webspace:maps/${serverId}`,
    ]]);
  });

  it('uploads only the paths written by the render batch', async () => {
    let uploadedFiles: string[] = [];
    let args: string[] = [];
    const publisher = new SftpPublisher(root, config, async (_command, commandArgs) => {
      args = commandArgs;
      uploadedFiles = (await readFile(commandArgs[commandArgs.indexOf('--files-from') + 1], 'utf8')).trim().split('\n');
    });
    await publisher.publishServer(serverId, ['8/0/0.png', 'metadata.json', '8/0/0.png']);
    publisher.stop();
    expect(uploadedFiles).toEqual(['8/0/0.png', 'metadata.json']);
    expect(args).toContain('--no-traverse');
    expect(args).not.toContain('--max-age');
    expect(args.at(-1)).toBe(`webspace:maps/${serverId}`);
  });

  it('refuses a full sync if the local metadata is missing or belongs to another server', async () => {
    const calls: string[][] = [];
    const publisher = new SftpPublisher(root, config, async (_command, args) => { calls.push(args); });
    await expect(publisher.syncServer(serverId)).rejects.toThrow();
    await mkdir(path.join(root, serverId));
    await writeFile(path.join(root, serverId, 'metadata.json'), JSON.stringify({ serverId: 'other-server' }));
    await expect(publisher.syncServer(serverId)).rejects.toThrow('Invalid map metadata');
    expect(calls).toEqual([]);
  });

  it('runs idle and hourly full syncs within the dedicated server directory', async () => {
    jest.useFakeTimers();
    const publisher = new SftpPublisher(root, config, async () => undefined);
    const sync = jest.spyOn(publisher, 'syncServer').mockResolvedValue(undefined);
    publisher.start([serverId]);
    await publisher.publishServer(serverId);
    await jest.advanceTimersByTimeAsync(299000);
    await publisher.publishServer(serverId);
    await jest.advanceTimersByTimeAsync(300000);
    expect(sync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3001000);
    publisher.stop();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledWith(serverId);
  });

  it('keeps direct uploads active when full sync timers are disabled', async () => {
    jest.useFakeTimers();
    const publisher = new SftpPublisher(root, { ...config, idleSyncMs: 0, fullSyncMs: 0 }, async () => undefined);
    const sync = jest.spyOn(publisher, 'syncServer').mockResolvedValue(undefined);
    publisher.start([serverId]);
    await publisher.publishServer(serverId, ['metadata.json']);
    await jest.advanceTimersByTimeAsync(86400000);
    publisher.stop();
    expect(sync).not.toHaveBeenCalled();
  });

  it('scopes a full sync to the server directory', async () => {
    const calls: string[][] = [];
    await mkdir(path.join(root, serverId));
    await writeFile(path.join(root, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    const publisher = new SftpPublisher(root, config, async (_command, args) => { calls.push(args); });
    await publisher.syncServer(serverId);
    expect(calls).toEqual([[
      '--config', '/config/rclone.conf', 'sync', '--transfers', '2', '--checkers', '2',
      path.join(root, serverId), `webspace:maps/${serverId}`,
    ]]);
  });

  it('stages archive uploads and promotes them without deleting web-root files', async () => {
    const calls: string[][] = [];
    await mkdir(path.join(root, serverId));
    await writeFile(path.join(root, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    const publisher = new SftpPublisher(root, config,
      async (_command, args) => { calls.push(args); }, true);
    await publisher.publishServer(serverId, ['8/-2.zip']);
    await publisher.syncServer(serverId);
    publisher.stop();
    expect(calls.map((args) => args[2])).toEqual(['copy', 'move', 'sync', 'sync', 'move']);
    expect(calls[0]).toContain('--sftp-set-modtime=false');
    expect(calls[0]).toContain('1');
    expect(calls[0].at(-1)).toBe(`webspace:maps/.archive-stage/${serverId}`);
    expect(calls[1].at(-1)).toBe(`webspace:maps/${serverId}`);
    expect(calls[2].at(-1)).toBe(`webspace:maps/.archive-stage/${serverId}`);
    expect(calls[3]).toContain('--compare-dest');
    expect(calls[3]).toContain('--size-only');
    expect(calls[4]).toContain('--ignore-times');
  });

  it('allows a later full sync to recover from a failed direct upload', async () => {
    await mkdir(path.join(root, serverId));
    await writeFile(path.join(root, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    const modes: string[] = [];
    const publisher = new SftpPublisher(root, config, async (_command, args) => {
      modes.push(args[2]);
      if (args[2] === 'copy') throw new Error('SFTP unavailable');
    });
    await expect(publisher.publishServer(serverId)).rejects.toThrow('SFTP unavailable');
    await expect(publisher.syncServer(serverId)).resolves.toBeUndefined();
    publisher.stop();
    expect(modes).toEqual(['copy', 'sync']);
  });

  it('publishes a dedicated server directory directly below the remote root', async () => {
    const calls: string[][] = [];
    await mkdir(path.join(root, serverId));
    await writeFile(path.join(root, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    const publisher = new SftpPublisher(root, { ...config, target: 'webspace:' }, async (_command, args) => {
      calls.push(args);
    });
    await publisher.publishServer(serverId);
    await publisher.syncServer(serverId);
    publisher.stop();
    expect(calls[0].at(-1)).toBe(`webspace:${serverId}`);
    expect(calls[1].at(-1)).toBe(`webspace:${serverId}`);
  });

  it('rejects ambiguous targets and invalid server IDs before any upload', () => {
    expect(() => new SftpPublisher(root, { ...config, target: 'webspace:/' })).toThrow('remote root or directory');
    expect(() => new SftpPublisher(root, { ...config, target: 'webspace:../outside' })).toThrow('remote root or directory');
    const publisher = new SftpPublisher(root, config, async () => { throw new Error('unexpected upload'); });
    expect(() => publisher.publishServer('../wrong')).toThrow('Invalid map server ID');
    expect(() => publisher.publishServer(serverId, ['../outside.png'])).toThrow('Invalid relative tile path');
  });
});
