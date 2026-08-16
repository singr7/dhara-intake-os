import { Prisma } from '@prisma/client';
import { currentTenantId, MissingTenantContextError } from './tenancy.js';

/**
 * The tenant-scoped Prisma client extension (ADR-011).
 *
 * Every query against a tenant-owned model gets `tenantId` injected — into `where` for
 * reads, updates and deletes, into `data` for writes. Forgetting the filter is not a
 * possible mistake because the filter is not written by callers at all.
 *
 * The model list is derived from the DMMF rather than maintained by hand: a model is
 * tenant-scoped exactly when it has a required `tenantId` column. New tables inherit the
 * protection the moment they are migrated, and the list cannot drift from the schema.
 *
 * Models with a *nullable* `tenantId` (prompt_audio, provider_configs, routing_policies)
 * hold platform-shared rows alongside tenant rows, so a blanket filter would hide the
 * shared ones. They are queried with explicit filters; `packs` / `pack_versions` are
 * platform-global and have no tenant column at all.
 */

function deriveTenantScopedModels(): ReadonlySet<string> {
  // Before `prisma generate` runs, `@prisma/client` resolves to a stub whose `dmmf` is
  // undefined. Failing here with the fix in the message beats a `Cannot read properties of
  // undefined` five frames into module initialisation.
  const models = Prisma.dmmf?.datamodel?.models;
  if (!models) {
    throw new Error(
      'Prisma client is not generated: run `pnpm --filter @dhara/db generate`. ' +
        'Tenant scoping derives its model list from the schema and cannot start without it.',
    );
  }

  const scoped = new Set<string>();
  for (const model of models) {
    const tenantField = model.fields.find((field) => field.name === 'tenantId');
    if (tenantField?.isRequired === true) {
      scoped.add(model.name);
    }
  }
  return scoped;
}

export const tenantScopedModels = deriveTenantScopedModels();

/** Operations whose `where` clause selects the rows being read, changed or removed. */
const whereScoped = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Operations that introduce new rows and must stamp the tenant on them. */
const dataScoped = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

/**
 * Prisma types each model's arguments differently, and this extension exists precisely to
 * treat them uniformly — so the hook signature is deliberately structural. The `unknown`
 * fields keep the loose typing contained to the boundary instead of spreading inward.
 */
interface AllOperationsArgs {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

function withTenantWhere(args: Args, tenantId: string): Args {
  const where = (args.where ?? {}) as Args;
  return { ...args, where: { ...where, tenantId } };
}

function withTenantData(args: Args, tenantId: string): Args {
  const data = args.data;
  if (Array.isArray(data)) {
    return { ...args, data: data.map((row) => ({ ...(row as Args), tenantId })) };
  }
  return { ...args, data: { ...((data ?? {}) as Args), tenantId } };
}

export const tenantScopeExtension = Prisma.defineExtension({
  name: 'dhara-tenant-scope',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }: AllOperationsArgs) {
        if (!tenantScopedModels.has(model)) {
          return query(args);
        }

        const tenantId = currentTenantId();
        if (tenantId === undefined) {
          throw new MissingTenantContextError(model, operation);
        }

        if (whereScoped.has(operation)) {
          return query(withTenantWhere(args as Args, tenantId));
        }
        if (dataScoped.has(operation)) {
          return query(withTenantData(args as Args, tenantId));
        }
        if (operation === 'upsert') {
          const scoped = withTenantWhere(args as Args, tenantId) as Args;
          const create = (scoped.create ?? {}) as Args;
          return query({ ...scoped, create: { ...create, tenantId } });
        }

        // Anything not enumerated above (a future Prisma operation) is refused rather than
        // let through unfiltered — an unknown operation is not evidence that it is safe.
        throw new MissingTenantContextError(model, `${operation} (unscoped)`);
      },
    },
  },
});
