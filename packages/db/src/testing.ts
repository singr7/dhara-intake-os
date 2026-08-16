import { platformOps } from './client.js';

/**
 * Test-only helpers, exported from `@dhara/db/testing` so they are impossible to reach
 * from application code by accident.
 *
 * These run against a real Postgres — the guarantees this package exists to provide
 * (append-only triggers, tenant filtering, transactional sequence numbers) are database
 * behaviour, and a mock would only prove that the mock agrees with itself.
 */

/**
 * True when a test database is configured. Suites gate on this so `pnpm test` still works
 * on a laptop without Postgres running; CI always sets it, so the guarantees are never
 * merged unverified.
 */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

const TABLES = [
  'evidence_events',
  'audit_events',
  'field_values',
  'consent_records',
  'cost_records',
  'export_records',
  'review_actions',
  'media_objects',
  'prompt_audio',
  'intake_sessions',
  'workflow_versions',
  'workflows',
  'export_targets',
  'budgets',
  'provider_configs',
  'routing_policies',
  'sessions_auth',
  'platform_users',
  'user_roles',
  'users',
  'pack_versions',
  'packs',
  'tenants',
];

/**
 * Empties every table. TRUNCATE is used rather than DELETE precisely because the
 * append-only triggers are row-level: a test fixture must be able to reset the world
 * without an override that production code could then copy.
 */
export async function resetTestDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await platformOps.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface TestTenant {
  id: string;
  slug: string;
}

/** Creates a tenant directly, bypassing the scoped client (which needs a tenant to exist). */
export async function createTestTenant(slug: string, name = slug): Promise<TestTenant> {
  const tenant = await platformOps.prisma.tenant.create({
    data: { slug, name },
    select: { id: true, slug: true },
  });
  return tenant;
}
