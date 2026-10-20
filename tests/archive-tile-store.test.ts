import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArchiveTileStore } from '../src/service/archive-tile-store.js';

const serverId = 'server-1234567890abcdef12345678';

describe('ArchiveTileStore', () => {
  let root: string;
  let tiles: string;
  let archives: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'renderer-archives-'));
    tiles = path.join(root, 'tiles');
    archives = path.join(root, 'archives');
    await mkdir(path.join(tiles, serverId, '8', '-2'), { recursive: true });
    await mkdir(path.join(tiles, serverId, 'satellite', '8', '-2'), { recursive: true });
    await writeFile(path.join(tiles, serverId, 'metadata.json'), JSON.stringify({ serverId }));
    await writeFile(path.join(tiles, serverId, '8', '-2', '-3.png'), Buffer.from('terrain one'));
    await writeFile(path.join(tiles, serverId, '8', '-2', '4.png'), Buffer.from('terrain two'));
    await writeFile(path.join(tiles, serverId, 'satellite', '8', '-2', '-3.png'), Buffer.from('satellite'));
    await writeFile(path.join(tiles, serverId, 'satellite', 'metadata.json'), '{}');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('builds standard ZIPs for terrain and satellite and copies metadata', async () => {
    const store = new ArchiveTileStore(tiles, archives);
    const changed = await store.buildChanged(serverId, [
      '8/-2/-3.png', '8/-2/4.png', 'satellite/8/-2/-3.png',
      'metadata.json', 'satellite/metadata.json',
    ]);
    expect(changed).toEqual([
      '8/-2.zip', 'satellite/8/-2.zip', 'metadata.json', 'satellite/metadata.json',
    ]);
    expect(unzip(path.join(archives, serverId, '8', '-2.zip'), '-3.png')).toBe('terrain one');
    expect(unzip(path.join(archives, serverId, '8', '-2.zip'), '4.png')).toBe('terrain two');
    expect(unzip(path.join(archives, serverId, 'satellite', '8', '-2.zip'), '-3.png')).toBe('satellite');
    expect(await readFile(path.join(archives, serverId, 'metadata.json'), 'utf8'))
      .toBe(JSON.stringify({ serverId }));
  });

  it('rebuilds an archive when a tile changes and seeds missing archives', async () => {
    const store = new ArchiveTileStore(tiles, archives);
    expect(await store.buildMissingOrStale(serverId)).toBe(true);
    const archive = path.join(archives, serverId, '8', '-2.zip');
    expect(unzip(archive, '-3.png')).toBe('terrain one');
    const updated = path.join(tiles, serverId, '8', '-2', '-3.png');
    await writeFile(updated, 'updated terrain');
    const future = new Date(Date.now() + 5000);
    await utimes(updated, future, future);
    expect(await store.buildMissingOrStale(serverId)).toBe(true);
    expect(unzip(archive, '-3.png')).toBe('updated terrain');
    const first = await readFile(archive);
    await store.buildChanged(serverId, ['8/-2/-3.png']);
    expect(await readFile(archive)).toEqual(first);
    expect((await stat(archive)).size).toBeGreaterThan(0);
  });

  it('rejects paths outside a tile column before writing an archive', async () => {
    const store = new ArchiveTileStore(tiles, archives);
    await expect(store.buildChanged(serverId, ['../metadata.json'])).rejects.toThrow('Invalid rendered tile path');
    await expect(store.buildChanged('../outside', ['8/-2/-3.png'])).rejects.toThrow('Invalid server ID');
  });
});

function unzip(archive: string, entry: string): string {
  const result = spawnSync('unzip', ['-p', archive, entry], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
