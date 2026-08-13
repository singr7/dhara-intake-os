/**
 * @dhara/db — Prisma schema, client, and the tenant-scoped client extension (doc 05, ADR-011).
 *
 * S01 ships the package boundary only. S02 adds: the full Prisma schema + migrations,
 * append-only guards for `evidence_events` / `audit_events`, and the tenant-scoped client
 * that injects `tenant_id` from AsyncLocalStorage. The raw client will be exported only from
 * a `platformOps` namespace — any other raw `prisma.` usage is review-blocking (doc 04 §3).
 */

export const DB_PACKAGE = '@dhara/db' as const;

/** Placeholder connectivity probe; S02 replaces this with a real `SELECT 1`. */
export async function checkDatabase(): Promise<boolean> {
  return false;
}
