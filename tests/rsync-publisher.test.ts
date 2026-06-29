import { RsyncPublisher, isSshTarget } from '../src/service/rsync-publisher.js';

describe('RsyncPublisher', () => {
  it('does nothing without a target', async () => {
    const calls: Array<[string, string[]]> = [];
    const publisher = new RsyncPublisher('/tiles', {}, async (command, args) => {
      calls.push([command, args]);
    });

    await publisher.publishServer('server-test');

    expect(calls).toEqual([]);
  });

  it('builds rsync command with SSH key for SSH targets', async () => {
    const calls: Array<[string, string[]]> = [];
    const publisher = new RsyncPublisher(
      '/tiles',
      { target: 'user@example.com:/var/www/maps/', sshKeyFile: '/keys/id_ed25519' },
      async (command, args) => { calls.push([command, args]); },
    );

    await publisher.publishServer('server-test');

    expect(calls).toEqual([[
      'rsync',
      [
        '-a',
        '--delete',
        '-e',
        'ssh -i /keys/id_ed25519',
        '/tiles/server-test/',
        'user@example.com:/var/www/maps/',
      ],
    ]]);
  });
});

describe('isSshTarget', () => {
  it('detects rsync SSH target forms', () => {
    expect(isSshTarget('user@example.com:/var/www/maps/')).toBe(true);
    expect(isSshTarget('example.com:/var/www/maps/')).toBe(true);
    expect(isSshTarget('/var/www/maps/')).toBe(false);
  });
});
