import { describe, expect, it } from 'vitest';
import { DSL_GRAMMAR_VERSION, DSL_PACKAGE } from './index.js';

describe('@dhara/dsl package boundary', () => {
  it('exposes its identity and grammar version', () => {
    expect(DSL_PACKAGE).toBe('@dhara/dsl');
    expect(DSL_GRAMMAR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
