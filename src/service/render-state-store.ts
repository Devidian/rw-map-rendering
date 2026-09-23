import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultLogger } from '../utils/logger.js';

interface StateFile {
  servers?: Record<string, ServerRenderState>;
}

export interface ServerRenderState {
  cursor?: number;
}

export class RenderStateStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly statePath: string) {}

  async getServerState(serverId: string): Promise<ServerRenderState> {
    const file = await this.read();
    return file.servers?.[serverId] ?? {};
  }

  async setServerCursor(serverId: string, cursor: number): Promise<void> {
    const write = this.writeQueue.then(async () => {
      const file = await this.read();
      file.servers ??= {};
      file.servers[serverId] = { ...file.servers[serverId], cursor };
      await this.write(file);
    });
    this.writeQueue = write.catch(() => undefined);
    return write;
  }

  private async read(): Promise<StateFile> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as StateFile : {};
    } catch (error) {
      if (isMissing(error)) return {};
      if (error instanceof SyntaxError) {
        defaultLogger.warn(`Ignoring invalid render state at ${this.statePath}; it will be rebuilt`);
        return {};
      }
      throw error;
    }
  }

  private async write(file: StateFile): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`);
    await rename(temporaryPath, this.statePath);
  }
}

export function renderStatePath(mapRoot: string): string {
  return path.join(mapRoot, '.state', 'render-state.json');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
