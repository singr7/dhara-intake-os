import { Prisma } from '@prisma/client';

/**
 * App-layer half of the append-only guarantee (ADR-010).
 *
 * The database triggers in migration `20260815174000_append_only_guards` are the guarantee;
 * this extension exists so the mistake is caught at the call site with a message naming the
 * ADR, instead of surfacing as a Postgres error from three frames deep inside a
 * transaction. Removing this file would not weaken the invariant — removing the trigger
 * would.
 */

export const appendOnlyModels = ['EvidenceEvent', 'AuditEvent'] as const;

const forbidden = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export class AppendOnlyViolationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only (ADR-010): ${operation} is not permitted. ` +
        'Corrections are recorded as new events, never as edits to old ones.',
    );
    this.name = 'AppendOnlyViolationError';
  }
}

const guarded = new Set<string>(appendOnlyModels);

interface GuardArgs {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

export const appendOnlyExtension = Prisma.defineExtension({
  name: 'dhara-append-only',
  query: {
    $allModels: {
      // Structurally typed for the same reason as the tenant-scope hook: the guard is
      // model-agnostic, so it does not want per-model argument types.
      $allOperations({ model, operation, args, query }: GuardArgs) {
        if (guarded.has(model) && forbidden.has(operation)) {
          throw new AppendOnlyViolationError(model, operation);
        }
        return query(args);
      },
    },
  },
});
