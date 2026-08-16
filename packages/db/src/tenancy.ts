import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped tenant context (ADR-011).
 *
 * The tenant id is never a function parameter that a caller can forget to pass — it rides
 * in AsyncLocalStorage, established once per request by the API's tenancy plugin, and the
 * Prisma extension in `tenant-scope.ts` reads it on every query. Code that queries outside
 * a tenant context fails loudly rather than querying every tenant's rows.
 */

export interface TenantContext {
  tenantId: string;
  /** The authenticated user, when the request has one. Runner requests do not. */
  userId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `No tenant context for ${model}.${operation}. Wrap the call in runWithTenant(), or ` +
        'use platformOps if this is genuinely a cross-tenant platform operation.',
    );
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Runs `fn` with the given tenant context bound to the async execution path.
 *
 * The inner `await` is load-bearing, not style. Prisma queries are lazy: `db.x.findMany()`
 * builds a promise and only executes when something calls `.then` on it. If the caller
 * awaits outside this function, execution happens after `storage.run` has returned and the
 * extension reads an empty context — which, before this wrapper awaited, showed up as
 * "no tenant context" on perfectly ordinary code. Awaiting here forces the query to run
 * inside the scope.
 *
 * Callback-style callers (the Fastify `onRequest` hook) pass a synchronous `done`: it is
 * invoked before the first await, so the whole request chain it starts inherits the scope.
 */
export async function runWithTenant<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run(context, async () => fn());
}

/** The current context, or `undefined` outside one. */
export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** The current tenant id, or `undefined` outside a context. */
export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/**
 * The current tenant id, or a thrown error.
 *
 * Prisma's generated `create` inputs require `tenantId` even though the extension sets it
 * regardless, so writes read it from here. Passing the wrong value is not a risk — the
 * extension overwrites whatever is supplied — but reading it explicitly keeps the types
 * honest instead of casting them away.
 */
export function requireTenantId(): string {
  const tenantId = storage.getStore()?.tenantId;
  if (tenantId === undefined) throw new MissingTenantContextError('(any)', 'write');
  return tenantId;
}
