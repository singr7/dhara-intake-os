import { z } from 'zod';

/**
 * Zod-validated environment loader (doc 04 §3).
 *
 * Demo lesson encoded here: a missing key must crash the process **at boot**, never
 * degrade silently at call time. Services call `loadServerEnv()` on the first line of
 * their entrypoint; anything invalid throws an `EnvValidationError` listing every
 * offending variable at once.
 *
 * Only the S01 variable set is defined. Later sessions extend `serverEnvSchema`
 * (provider keys in S07, budgets in S16, …) — never read `process.env` directly.
 */

const nonEmpty = (name: string) => z.string({ required_error: `${name} is required` }).min(1);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url(),

  DATABASE_URL: nonEmpty('DATABASE_URL').startsWith('postgres'),
  REDIS_URL: nonEmpty('REDIS_URL').startsWith('redis'),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: nonEmpty('S3_REGION').default('ap-south-1'),
  S3_ACCESS_KEY_ID: nonEmpty('S3_ACCESS_KEY_ID'),
  S3_SECRET_ACCESS_KEY: nonEmpty('S3_SECRET_ACCESS_KEY'),
  S3_BUCKET_AUDIO: nonEmpty('S3_BUCKET_AUDIO').default('audio'),
  S3_BUCKET_DOCUMENTS: nonEmpty('S3_BUCKET_DOCUMENTS').default('documents'),
  S3_BUCKET_EXPORTS: nonEmpty('S3_BUCKET_EXPORTS').default('exports'),

  // Signs server-side auth cookies (ADR-012) and short-lived intake tokens.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** Staff console session lifetime. A clinic shift is the unit that matters here. */
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(12),
  /** Failed-login attempts allowed per IP per minute before 429 (doc 09 §4). */
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}\n` +
        'Fix your .env (see .env.example) — the process refuses to start with incomplete config.',
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Parses and returns the validated server environment. Throws `EnvValidationError`
 * with every problem listed, rather than failing one variable at a time.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Cached accessor — safe to call from anywhere once the entrypoint has booted. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  cached ??= parseServerEnv(source);
  return cached;
}

/** Test-only: drops the cache so a fresh environment can be parsed. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
