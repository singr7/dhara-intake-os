import { describe, expect, it } from 'vitest';
import { providerKinds } from './index.js';

describe('@dhara/providers package boundary', () => {
  it('declares the four adapter kinds from doc 08', () => {
    expect([...providerKinds]).toEqual(['stt', 'llm', 'tts', 'realtime']);
  });
});
