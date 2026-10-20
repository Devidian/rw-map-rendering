import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SERVER_ID = /^server-[a-f0-9]{24}$/;
const COORDINATE = /^-?\d+$/;
const TILE = /^(-?\d+)\.png$/;
const MAX_ZIP_SIZE = 0xffffffff;
const MAX_ZIP_ENTRIES = 0xffff;

export class ArchiveTileStore {
  constructor(
    private readonly tileRoot: string,
    private readonly archiveRoot: string,
  ) {}

  async buildChanged(serverId: string, changedFiles: string[]): Promise<string[]> {
    assertServerId(serverId);
    const columns = new Set<string>();
    const metadata = new Set<string>();
    for (const file of changedFiles) {
      if (file === 'metadata.json' || file === 'satellite/metadata.json') {
        metadata.add(file);
        continue;
      }
      const parts = file.split('/');
      const satellite = parts[0] === 'satellite';
      const coordinates = satellite ? parts.slice(1) : parts;
      if (coordinates.length !== 3 || !COORDINATE.test(coordinates[0])
        || !COORDINATE.test(coordinates[1]) || !TILE.test(coordinates[2])) {
        throw new Error(`Invalid rendered tile path: ${file}`);
      }
      columns.add(`${satellite ? 'satellite/' : ''}${coordinates[0]}/${coordinates[1]}`);
    }
    const published: string[] = [];
    for (const column of [...columns].sort()) {
      await this.buildColumn(serverId, column);
      published.push(`${column}.zip`);
    }
    for (const file of [...metadata].sort()) {
      await this.copyMetadata(serverId, file);
      published.push(file);
    }
    return published;
  }

  async buildMissingOrStale(serverId: string): Promise<boolean> {
    assertServerId(serverId);
    if (!await exists(path.join(this.tileRoot, serverId, 'metadata.json'))) return false;
    await this.copyMetadata(serverId, 'metadata.json');
    for (const prefix of ['', 'satellite/']) {
      const sourceRoot = path.join(this.tileRoot, serverId, prefix);
      if (prefix && !await exists(sourceRoot)) continue;
      if (prefix && await exists(path.join(sourceRoot, 'metadata.json'))) {
        await this.copyMetadata(serverId, 'satellite/metadata.json');
      }
      for (const zoom of await readdir(sourceRoot, { withFileTypes: true })) {
        if (!zoom.isDirectory() || !COORDINATE.test(zoom.name)) continue;
        const zoomPath = path.join(sourceRoot, zoom.name);
        for (const column of await readdir(zoomPath, { withFileTypes: true })) {
          if (!column.isDirectory() || !COORDINATE.test(column.name)) continue;
          const relative = `${prefix}${zoom.name}/${column.name}`;
          if (await this.isStale(serverId, relative)) await this.buildColumn(serverId, relative);
        }
      }
    }
    return true;
  }

  private async isStale(serverId: string, column: string): Promise<boolean> {
    const archive = path.join(this.archiveRoot, serverId, `${column}.zip`);
    let archiveTime: number;
    try { archiveTime = (await stat(archive)).mtimeMs; }
    catch (error) { if (isMissing(error)) return true; throw error; }
    const source = path.join(this.tileRoot, serverId, column);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isFile() && TILE.test(entry.name)
        && (await stat(path.join(source, entry.name))).mtimeMs > archiveTime) return true;
    }
    return false;
  }

  private async buildColumn(serverId: string, column: string): Promise<void> {
    const source = path.join(this.tileRoot, serverId, column);
    const destination = path.join(this.archiveRoot, serverId, `${column}.zip`);
    const names = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && TILE.test(entry.name))
      .map((entry) => entry.name).sort((a, b) => Number(a.slice(0, -4)) - Number(b.slice(0, -4)));
    if (names.length === 0) throw new Error(`No PNG tiles in ${source}`);
    if (names.length > MAX_ZIP_ENTRIES) throw new Error(`Too many PNG tiles in ${source}`);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx');
      try {
        const central: Buffer[] = [];
        let offset = 0;
        for (const name of names) {
          const contents = await readFile(path.join(source, name));
          if (contents.length > MAX_ZIP_SIZE) throw new Error(`Tile too large: ${name}`);
          const nameBytes = Buffer.from(name);
          const checksum = crc32(contents);
          const local = Buffer.alloc(30);
          local.writeUInt32LE(0x04034b50, 0);
          local.writeUInt16LE(20, 4);
          local.writeUInt16LE(0, 6);
          local.writeUInt16LE(0, 8);
          local.writeUInt16LE(0, 10);
          local.writeUInt16LE(33, 12); // 1980-01-01, the earliest ZIP date.
          local.writeUInt32LE(checksum, 14);
          local.writeUInt32LE(contents.length, 18);
          local.writeUInt32LE(contents.length, 22);
          local.writeUInt16LE(nameBytes.length, 26);
          const header = Buffer.alloc(46);
          header.writeUInt32LE(0x02014b50, 0);
          header.writeUInt16LE(20, 4);
          header.writeUInt16LE(20, 6);
          header.writeUInt16LE(0, 8);
          header.writeUInt16LE(0, 10);
          header.writeUInt16LE(0, 12);
          header.writeUInt16LE(33, 14);
          header.writeUInt32LE(checksum, 16);
          header.writeUInt32LE(contents.length, 20);
          header.writeUInt32LE(contents.length, 24);
          header.writeUInt16LE(nameBytes.length, 28);
          header.writeUInt32LE(offset, 42);
          central.push(header, nameBytes);
          await file.writeFile(Buffer.concat([local, nameBytes, contents]));
          offset += local.length + nameBytes.length + contents.length;
          if (offset > MAX_ZIP_SIZE) throw new Error(`Archive too large: ${destination}`);
        }
        const directory = Buffer.concat(central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(names.length, 8);
        end.writeUInt16LE(names.length, 10);
        end.writeUInt32LE(directory.length, 12);
        end.writeUInt32LE(offset, 16);
        if (offset + directory.length + end.length > MAX_ZIP_SIZE) {
          throw new Error(`Archive too large: ${destination}`);
        }
        await file.writeFile(directory);
        await file.writeFile(end);
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async copyMetadata(serverId: string, relative: string): Promise<void> {
    const source = path.join(this.tileRoot, serverId, relative);
    const contents = await readFile(source);
    if (relative === 'metadata.json') {
      const parsed = JSON.parse(contents.toString('utf8')) as Record<string, unknown>;
      if (parsed.serverId !== serverId) throw new Error(`Invalid metadata for ${serverId}`);
    }
    const destination = path.join(this.archiveRoot, serverId, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, contents); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  }
}

function assertServerId(serverId: string): void {
  if (!SERVER_ID.test(serverId)) throw new Error(`Invalid server ID: ${serverId}`);
}

async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(contents: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of contents) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
