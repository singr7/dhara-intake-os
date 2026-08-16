import { describe, expect, it } from 'vitest';
import { appendOnlyModels, checkDatabase, DB_PACKAGE } from './index.js';
import { hasTestDatabase } from './testing.js';

describe('@dhara/db package surface', () => {
  it('exposes its identity', () => {
    expect(DB_PACKAGE).toBe('@dhara/db');
  });

  it('names the append-only tables from doc 05', () => {
    expect([...appendOnlyModels]).toEqual(['EvidenceEvent', 'AuditEvent']);
  });

  it.runIf(hasTestDatabase)('probes a live database with a real round-trip', async () => {
    await expect(checkDatabase()).resolves.toBe(true);
  });
});
