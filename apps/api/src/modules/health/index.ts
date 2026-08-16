import type { FastifyInstance } from 'fastify';
import { healthSchema, type Health, type ServerEnv } from '@dhara/contracts';
import { createProbes, type Probes } from './probes.js';

export const API_VERSION = '0.1.0';

/**
 * `GET /health` — liveness plus dependency probes (doc 07 §1, doc 10 §4).
 *
 * S02 replaces S01's placeholders with real round-trips to Postgres, Redis and S3. `status`
 * is `degraded` when any of them is down: the endpoint reports what it actually observed,
 * never an optimistic default. S07 adds provider-key presence — a silent no-key fallback
 * cost the demo a day of debugging.
 */
export async function healthRoutes(app: FastifyInstance, opts: { env: ServerEnv }): Promise<void> {
  const probes: Probes = createProbes(opts.env);
  app.addHook('onClose', () => probes.close());

  app.get('/health', { schema: { response: { 200: healthSchema } } }, async (): Promise<Health> => {
    const [db, redis, s3] = await Promise.all([probes.db(), probes.redis(), probes.s3()]);
    return {
      status: db && redis && s3 ? 'ok' : 'degraded',
      version: API_VERSION,
      db,
      redis,
      s3,
    };
  });
}
