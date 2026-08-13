import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, fetchHealth } from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHealth', () => {
  it('parses a valid health payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ status: 'ok', version: '0.1.0', db: false, redis: false, s3: false }),
      ),
    );

    await expect(fetchHealth()).resolves.toMatchObject({ status: 'ok', version: '0.1.0' });
  });

  it('returns null instead of throwing when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    await expect(fetchHealth()).resolves.toBeNull();
  });

  it('calls the versioned same-origin API path', () => {
    expect(API_BASE).toBe('/api/v1');
  });
});
