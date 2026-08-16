import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ServerEnv } from '@dhara/contracts';
import { loggerOptions } from './plugins/logger.js';
import { errorHandlerPlugin } from './plugins/error.js';
import { requestIdPlugin } from './plugins/request-id.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './modules/health/index.js';
import { authRoutes } from './modules/auth/index.js';

export const API_PREFIX = '/api/v1';

/**
 * Builds the API instance. Kept separate from `index.ts` so tests can drive it through
 * `app.inject()` without binding a port.
 */
export async function buildServer(env: ServerEnv): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(env),
    genReqId: () => randomUUID(),
    // nginx sits in front of the API in every environment (doc 10 §2).
    trustProxy: true,
  });

  // Zod is the single source of truth for request/response shapes (doc 04 §1).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(requestIdPlugin);
  await app.register(errorHandlerPlugin);
  // Opt-in per route: throttling belongs where guessing pays (login, runner endpoints),
  // not on the health check the container orchestrator polls.
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, { secret: env.SESSION_SECRET });

  await app.register(healthRoutes, { prefix: API_PREFIX, env });
  await app.register(authRoutes, { prefix: API_PREFIX, env });

  return app;
}
