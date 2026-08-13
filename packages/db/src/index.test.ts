import { describe, expect, it } from 'vitest';
import { checkDatabase, DB_PACKAGE } from './index.js';

describe('@dhara/db package boundary', () => {
  it('exposes its identity', () => {
    expect(DB_PACKAGE).toBe('@dhara/db');
  });

  it('reports the S01 placeholder health probe as not-yet-connected', async () => {
    await expect(checkDatabase()).resolves.toBe(false);
  });
});
