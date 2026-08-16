import { parseServerEnv, type ServerEnv } from '@dhara/contracts';

/** A complete, valid environment for tests that never touches a real service. */
export function testEnv(overrides: Record<string, string> = {}): ServerEnv {
  return parseServerEnv({
    NODE_ENV: 'test',
    APP_BASE_URL: 'http://localhost:8080',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://dhara:pw@localhost:5432/dhara',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    SESSION_SECRET: 'a'.repeat(32),
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

/** Extracts one cookie's value from a `set-cookie` header collection. */
export function cookieValue(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(header);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return undefined;
}

/** Cookie attributes as a lowercased set, for asserting HttpOnly / SameSite (doc 09 §4). */
export function cookieAttributes(
  setCookie: string | string[] | undefined,
  name: string,
): Set<string> {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = headers.find((h) => h.startsWith(`${name}=`)) ?? '';
  return new Set(
    header
      .split(';')
      .slice(1)
      .map((part) => part.trim().toLowerCase()),
  );
}
