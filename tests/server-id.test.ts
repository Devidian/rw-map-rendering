import { createHash } from 'node:crypto';
import { serverIdFor } from '../src/utils/server-id.js';

describe('serverIdFor', () => {
  it('matches the manager backend server ID algorithm', () => {
    const expected = `server-${createHash('sha256').update('127.0.0.1:4255').digest('hex').slice(0, 24)}`;

    expect(serverIdFor('127.0.0.1', 4255)).toBe(expected);
  });
});
