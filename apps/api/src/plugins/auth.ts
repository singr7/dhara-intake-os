import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { AUTH_COOKIE_NAME, type AuthUser, type TenantRole } from '@dhara/contracts';
import { runWithTenant } from '@dhara/db';
import { ApiError } from './error.js';
import { resolveSession } from '../modules/auth/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated staff user, or null for anonymous and runner requests. */
    authUser: AuthUser | null;
  }
}

/**
 * Establishes identity and tenancy for every request (ADR-011, ADR-012).
 *
 * The tenant context is bound in an `onRequest` hook and stays bound for the whole request
 * because `done` is invoked *inside* `runWithTenant` — every handler, hook and awaited call
 * downstream inherits it. That is what lets the Prisma extension read the tenant without a
 * single route having to pass it.
 *
 * Runner requests (S04) carry a short-lived intake token rather than a cookie and will
 * establish their context the same way, from the session the token is scoped to.
 */
async function plugin(app: FastifyInstance, opts: { secret: string }): Promise<void> {
  await app.register(cookie, { secret: opts.secret });

  app.decorateRequest('authUser', null);

  app.addHook('onRequest', (request, _reply, done) => {
    const token = request.cookies[AUTH_COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      done();
      return;
    }

    resolveSession(token, opts.secret)
      .then((user) => {
        request.authUser = user;
        if (!user) {
          done();
          return;
        }
        // `done` runs synchronously inside the scope, so every later hook and the handler
        // itself inherit it; the returned promise carries no result worth awaiting.
        void runWithTenant({ tenantId: user.tenantId, userId: user.id }, done);
      })
      .catch((error: unknown) => {
        // A failed lookup must not silently downgrade to anonymous: that would turn a
        // database blip into an authorization decision.
        done(error as Error);
      });
  });
}

export const authPlugin = fp(plugin, { name: 'auth' });

/** The authenticated user, or a 401 problem. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new ApiError('AUTH_REQUIRED');
  return request.authUser;
}

/**
 * Route guard: `preHandler: requireRole('admin', 'owner')` (doc 09 §4).
 *
 * Platform roles are not a superset of tenant roles — platform staff who need tenant data
 * get it through the platform-ops surface, so support access stays visible in the audit log
 * rather than looking like ordinary clinic activity.
 */
export function requireRole(...roles: TenantRole[]): preHandlerHookHandler {
  return async (request) => {
    const user = requireUser(request);
    if (!roles.some((role) => user.roles.includes(role))) {
      throw new ApiError('FORBIDDEN', `requires one of: ${roles.join(', ')}`);
    }
  };
}
