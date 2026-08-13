import type { FastifyInstance } from 'fastify';
import { healthSchema, type Health } from '@dhara/contracts';

export const API_VERSION = '0.1.0';

/**
 * `GET /health` — liveness plus dependency booleans (doc 07 §1, doc 10 §4).
 *
 * S01 returns placeholders: nothing is wired to Postgres/Redis/S3 yet, and reporting
 * `true` before a real probe exists is exactly the silent-degradation failure the demo
 * taught us to avoid. S02 replaces these with real probes and flips `status` to
 * `degraded` when a dependency is down; S07 adds provider-key presence.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { schema: { response: { 200: healthSchema } } }, async (): Promise<Health> => {
    return {
      status: 'ok',
      version: API_VERSION,
      db: false,
      redis: false,
      s3: false,
    };
  });
}
