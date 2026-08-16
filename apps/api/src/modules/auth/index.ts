import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AUTH_COOKIE_NAME,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  type ServerEnv,
} from '@dhara/contracts';
import { ApiError } from '../../plugins/error.js';
import { requireUser } from '../../plugins/auth.js';
import { audit, auditActions } from '../audit/index.js';
import { login, revokeSession } from './service.js';

/**
 * Auth routes (doc 07 §1, ADR-012). Registration is not among them: staff accounts are
 * provisioned by seed or by a tenant admin, never self-served.
 */
export async function authRoutes(app: FastifyInstance, opts: { env: ServerEnv }): Promise<void> {
  const { env } = opts;
  const secureCookie = env.NODE_ENV === 'production';
  // Route bodies are typed from their Zod schemas rather than re-declared as interfaces.
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/auth/login',
    {
      schema: { body: loginRequestSchema, response: { 200: loginResponseSchema } },
      // Per-IP throttle on the one route where guessing pays (doc 09 §4).
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body;
      const result = await login({
        tenantSlug: body.tenantSlug,
        email: body.email,
        password: body.password,
        secret: env.SESSION_SECRET,
        ttlHours: env.SESSION_TTL_HOURS,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (result === 'tenant_suspended') {
        await audit({
          action: auditActions.loginFailed,
          objectRef: { tenantSlug: body.tenantSlug, reason: 'tenant_suspended' },
          ip: request.ip,
        });
        throw new ApiError('TENANT_SUSPENDED');
      }

      if (result === 'invalid_credentials') {
        // The audit row records the attempt; the response says only that it failed. Which
        // of tenant / user / password was wrong is not the caller's business.
        await audit({
          action: auditActions.loginFailed,
          objectRef: { tenantSlug: body.tenantSlug, email: body.email },
          ip: request.ip,
        });
        throw new ApiError('AUTH_REQUIRED', 'Invalid credentials');
      }

      await audit({
        action: auditActions.loginSucceeded,
        objectRef: { userId: result.user.id },
        tenantId: result.user.tenantId,
        userId: result.user.id,
        ip: request.ip,
      });

      void reply.setCookie(AUTH_COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookie,
        path: '/',
        expires: result.expiresAt,
      });

      return { user: result.user };
    },
  );

  routes.post(
    '/auth/logout',
    { schema: { response: { 200: logoutResponseSchema } } },
    async (request, reply) => {
      const token = request.cookies[AUTH_COOKIE_NAME];
      if (typeof token === 'string' && token.length > 0) {
        await revokeSession(token, env.SESSION_SECRET);
      }
      if (request.authUser) {
        await audit({
          action: auditActions.logout,
          tenantId: request.authUser.tenantId,
          userId: request.authUser.id,
          ip: request.ip,
        });
      }
      void reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      return { ok: true } as const;
    },
  );

  routes.get('/auth/me', { schema: { response: { 200: meResponseSchema } } }, async (request) => {
    return { user: requireUser(request) };
  });
}
