import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseServerEnv } from './env.js';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgresql://dhara:pw@postgres:5432/dhara',
  REDIS_URL: 'redis://redis:6379',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  SESSION_SECRET: 'a'.repeat(32),
};

describe('parseServerEnv', () => {
  it('parses a complete environment and applies defaults', () => {
    const env = parseServerEnv(valid);
    expect(env.NODE_ENV).toBe('test');
    expect(env.S3_REGION).toBe('ap-south-1');
    expect(env.S3_BUCKET_AUDIO).toBe('audio');
    expect(env.API_PORT).toBe(3001);
  });

  it('coerces numeric ports from strings', () => {
    expect(parseServerEnv({ ...valid, API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('throws at boot when a required variable is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;
    expect(() => parseServerEnv(withoutDb)).toThrow(EnvValidationError);
  });

  it('reports every offending variable at once', () => {
    try {
      parseServerEnv({ ...valid, SESSION_SECRET: 'short', REDIS_URL: 'http://nope' });
      expect.unreachable('expected EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((i) => i.startsWith('SESSION_SECRET'))).toBe(true);
      expect(issues.some((i) => i.startsWith('REDIS_URL'))).toBe(true);
    }
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: 'mysql://x/y' })).toThrow(
      EnvValidationError,
    );
  });
});
