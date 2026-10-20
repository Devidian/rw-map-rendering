import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArchivePublisher } from '../src/service/archive-publisher.js';
import { ArchiveTileStore } from '../src/service/archive-tile-store.js';
import { RsyncPublisher } from '../src/service/rsync-publisher.js';
import { SftpPublisher } from '../src/service/sftp-publisher.js';

const serverId = 'server-1234567890abcdef12345678';

describe('ArchivePublisher', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'archive-publisher-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('seeds existing tiles and publishes changed ZIPs through both transports', async () => {
    const tiles = path.join(root, 'tiles');
    const archives = path.join(tiles, '.archives');
    await mkdir(path.join(tiles, serverId, '8', '-2'), { recursive: true });
    await writeFile(path.join(tiles, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    await writeFile(path.join(tiles, serverId, '8', '-2', '-3.png'), 'first');
    const rsyncCalls: string[][] = [];
    const sftpCalls: Array<{ args: string[]; files?: string[] }> = [];
    const rsync = new RsyncPublisher(archives, { target: '/www/maps/' },
      async (_command, args) => { rsyncCalls.push(args); }, false);
    const sftp = new SftpPublisher(archives, {
      target: 'webspace:', configFile: '/config/rclone.conf', idleSyncMs: 0, fullSyncMs: 0,
    }, async (_command, args) => {
      const manifest = args.indexOf('--files-from');
      sftpCalls.push({ args, files: manifest === -1 ? undefined
        : (await readFile(args[manifest + 1], 'utf8')).trim().split('\n') });
    }, true);
    const publisher = new ArchivePublisher(new ArchiveTileStore(tiles, archives), rsync, sftp);
    publisher.start([serverId]);
    await publisher.publishServer(serverId, ['8/-2/-3.png', 'metadata.json']);
    publisher.stop();

    expect(rsyncCalls).toHaveLength(2);
    expect(rsyncCalls.every((args) => !args.includes('--delete'))).toBe(true);
    expect(sftpCalls.map((call) => call.args[2])).toEqual(['sync', 'sync', 'move', 'copy', 'move']);
    expect(sftpCalls[3].files).toEqual(['8/-2.zip', 'metadata.json']);
    expect(sftpCalls[4].files).toEqual(['8/-2.zip', 'metadata.json']);
    expect((await readFile(path.join(archives, serverId, '8', '-2.zip'))).length).toBeGreaterThan(0);
  });
});
