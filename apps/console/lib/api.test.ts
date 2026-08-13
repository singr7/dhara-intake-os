import { describe, expect, it } from 'vitest';
import { apiUrl, defaultRequestInit } from './api.js';

describe('apiUrl', () => {
  it('builds versioned paths whether or not a leading slash is given', () => {
    expect(apiUrl('/auth/me')).toBe('/api/v1/auth/me');
    expect(apiUrl('auth/me')).toBe('/api/v1/auth/me');
  });
});

describe('defaultRequestInit', () => {
  it('sends cookies so server-side sessions work from the browser', () => {
    expect(defaultRequestInit.credentials).toBe('include');
  });
});
