import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RsyncConfig } from '../interfaces/rsync-config.js';

export type CommandRunner = (command: string, args: string[]) => Promise<void>;

export class RsyncPublisher {
  constructor(
    private readonly mapRoot: string,
    private readonly config: RsyncConfig,
    private readonly runner: CommandRunner = spawnCommand,
  ) {}

  async publishServer(serverId: string): Promise<void> {
    if (!this.config.target) return;
    const args = ['-a', '--delete'];
    if (this.config.sshKeyFile && isSshTarget(this.config.target)) {
      args.push('-e', `ssh -i ${this.config.sshKeyFile}`);
    }
    args.push(`${path.join(this.mapRoot, serverId)}${path.sep}`, this.config.target);
    await this.runner('rsync', args);
  }
}

export function isSshTarget(target: string): boolean {
  return /^[^/\s@:]+@[^/\s:]+:/.test(target) || /^[^/\s:]+:/.test(target);
}

function spawnCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
