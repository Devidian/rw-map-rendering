import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface StateFile {
  servers?: Record<string, ServerRenderState>;
}

export interface ServerRenderState {
  cursor?: number;
}

export class RenderStateStore {
  constructor(private readonly statePath: string) {}

  async getServerState(serverId: string): Promise<ServerRenderState> {
    const file = await this.read();
    return file.servers?.[serverId] ?? {};
  }

  async setServerCursor(serverId: string, cursor: number): Promise<void> {
    const file = await this.read();
    file.servers ??= {};
    file.servers[serverId] = { ...file.servers[serverId], cursor };
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  private async read(): Promise<StateFile> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as StateFile : {};
    } catch (error) {
      if (isMissing(error)) return {};
      throw error;
    }
  }
}

export function renderStatePath(mapRoot: string): string {
  return path.join(mapRoot, '.state', 'render-state.json');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
