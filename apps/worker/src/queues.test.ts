import { describe, expect, it } from 'vitest';
import { connectionFromUrl } from './queues.js';

describe('connectionFromUrl', () => {
  it('parses host and port from a redis url', () => {
    expect(connectionFromUrl('redis://redis:6379')).toMatchObject({ host: 'redis', port: 6379 });
  });

  it('defaults the port and carries a password when present', () => {
    const connection = connectionFromUrl('redis://:s3cret@cache.internal');
    expect(connection).toMatchObject({ host: 'cache.internal', port: 6379, password: 's3cret' });
  });

  it('disables per-request retries as BullMQ blocking commands require', () => {
    expect(connectionFromUrl('redis://redis:6379')).toMatchObject({ maxRetriesPerRequest: null });
  });
});
