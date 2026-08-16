import { PrismaClient } from '@prisma/client';
import { appendOnlyExtension } from './append-only.js';
import { tenantScopeExtension } from './tenant-scope.js';

/**
 * The one Prisma connection for the process, and the two clients built on it.
 *
 * `db` is what application code uses: tenant-scoped and append-only-guarded. The raw
 * client is reachable only through `platformOps` (below), which is the single place a
 * cross-tenant query is allowed to exist.
 */

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * The application database client. Every query is filtered by the tenant in the current
 * AsyncLocalStorage context (ADR-011) and evidence/audit rows cannot be rewritten (ADR-010).
 */
export const db = base.$extends(appendOnlyExtension).$extends(tenantScopeExtension);

export type Db = typeof db;

/**
 * Cross-tenant escape hatch — the *only* sanctioned one (ADR-011).
 *
 * Legitimate users: authentication (a login resolves which tenant the user belongs to, so
 * it necessarily runs before a tenant context exists), migrations, seeding, the retention
 * worker, and platform-ops tooling. Everything else imports `db`. ESLint blocks
 * `@prisma/client` imports outside this package so there is no second route to a raw client.
 */
export const platformOps = {
  /** Unfiltered client. Cross-tenant by construction — justify every use in review. */
  prisma: base,
  /** Append-only guards still apply to platform code; tenancy filtering does not. */
  guarded: base.$extends(appendOnlyExtension),
} as const;

/** Real connectivity probe for `GET /health` (doc 07 §1). */
export async function checkDatabase(): Promise<boolean> {
  try {
    await base.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await base.$disconnect();
}
