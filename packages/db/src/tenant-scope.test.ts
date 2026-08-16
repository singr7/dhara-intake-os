import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, platformOps } from './client.js';
import { runWithTenant, MissingTenantContextError } from './tenancy.js';
import { tenantScopedModels } from './tenant-scope.js';
import { AppendOnlyViolationError } from './append-only.js';
import {
  createTestTenant,
  hasTestDatabase,
  resetTestDatabase,
  type TestTenant,
} from './testing.js';

/**
 * The two structural guarantees of this package, verified against a real database:
 * tenant isolation (ADR-011) and the append-only evidence graph (ADR-010).
 */

describe('tenant-scope model derivation', () => {
  it('scopes every model with a required tenantId', () => {
    expect(tenantScopedModels.has('IntakeSession')).toBe(true);
    expect(tenantScopedModels.has('EvidenceEvent')).toBe(true);
    expect(tenantScopedModels.has('FieldValue')).toBe(true);
    expect(tenantScopedModels.has('Workflow')).toBe(true);
  });

  it('leaves platform-global and dual-scope models unfiltered', () => {
    // A blanket filter on these would hide platform-shared rows from every tenant.
    expect(tenantScopedModels.has('Pack')).toBe(false);
    expect(tenantScopedModels.has('PromptAudio')).toBe(false);
    expect(tenantScopedModels.has('ProviderConfig')).toBe(false);
    // Tenants themselves are the boundary, not a thing inside it.
    expect(tenantScopedModels.has('Tenant')).toBe(false);
    // Auth sessions resolve *to* a tenant, so they cannot be filtered by one.
    expect(tenantScopedModels.has('AuthSession')).toBe(false);
  });
});

describe.runIf(hasTestDatabase)('tenant isolation (ADR-011)', () => {
  let alpha: TestTenant;
  let beta: TestTenant;

  beforeEach(async () => {
    await resetTestDatabase();
    alpha = await createTestTenant('alpha-clinic');
    beta = await createTestTenant('beta-clinic');
  });

  async function seedWorkflow(tenant: TestTenant, name: string): Promise<string> {
    return runWithTenant({ tenantId: tenant.id }, async () => {
      const workflow = await db.workflow.create({
        data: { tenantId: tenant.id, name },
        select: { id: true },
      });
      return workflow.id;
    });
  }

  it('stamps the tenant on writes without the caller filtering', async () => {
    const id = await seedWorkflow(alpha, 'alpha intake');
    const row = await platformOps.prisma.workflow.findUniqueOrThrow({ where: { id } });
    expect(row.tenantId).toBe(alpha.id);
  });

  it('hides another tenant’s rows from findMany', async () => {
    await seedWorkflow(alpha, 'alpha intake');
    await seedWorkflow(beta, 'beta intake');

    const visible = await runWithTenant({ tenantId: alpha.id }, () => db.workflow.findMany());

    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('alpha intake');
  });

  it('returns null when tenant A fetches tenant B’s row by primary key', async () => {
    const betaId = await seedWorkflow(beta, 'beta intake');

    const stolen = await runWithTenant({ tenantId: alpha.id }, () =>
      db.workflow.findUnique({ where: { id: betaId } }),
    );

    expect(stolen).toBeNull();
  });

  it('refuses to update or delete across the tenant boundary', async () => {
    const betaId = await seedWorkflow(beta, 'beta intake');

    await runWithTenant({ tenantId: alpha.id }, async () => {
      await expect(
        db.workflow.update({ where: { id: betaId }, data: { name: 'hijacked' } }),
      ).rejects.toThrow();
      const removed = await db.workflow.deleteMany({ where: { id: betaId } });
      expect(removed.count).toBe(0);
    });

    const survivor = await platformOps.prisma.workflow.findUniqueOrThrow({ where: { id: betaId } });
    expect(survivor.name).toBe('beta intake');
  });

  it('counts only the current tenant', async () => {
    await seedWorkflow(alpha, 'a1');
    await seedWorkflow(alpha, 'a2');
    await seedWorkflow(beta, 'b1');

    const count = await runWithTenant({ tenantId: alpha.id }, () => db.workflow.count());
    expect(count).toBe(2);
  });

  it('throws rather than querying every tenant when there is no context', async () => {
    await expect(db.workflow.findMany()).rejects.toThrow(MissingTenantContextError);
  });
});

describe.runIf(hasTestDatabase)('append-only guarantees (ADR-010)', () => {
  let tenant: TestTenant;
  let sessionId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    tenant = await createTestTenant('append-only-clinic');

    sessionId = await runWithTenant({ tenantId: tenant.id }, async () => {
      const workflow = await db.workflow.create({
        data: { tenantId: tenant.id, name: 'wf' },
        select: { id: true },
      });
      const version = await platformOps.prisma.workflowVersion.create({
        data: { workflowId: workflow.id, semver: '1.0.0', dslDocument: {} },
        select: { id: true },
      });
      const session = await db.intakeSession.create({
        data: {
          tenantId: tenant.id,
          workflowVersionId: version.id,
          mode: 'touch',
          surface: 'pwa',
          language: 'en',
        },
        select: { id: true },
      });
      await db.evidenceEvent.create({
        data: {
          tenantId: tenant.id,
          sessionId: session.id,
          seq: 1,
          type: 'session.created',
          actor: { kind: 'system' },
        },
      });
      return session.id;
    });
  });

  it('blocks evidence updates at the application layer with an explanation', async () => {
    await runWithTenant({ tenantId: tenant.id }, async () => {
      await expect(
        db.evidenceEvent.updateMany({ where: { sessionId }, data: { type: 'session.failed' } }),
      ).rejects.toThrow(AppendOnlyViolationError);
    });
  });

  it('blocks evidence updates at the database, even through the raw client', async () => {
    // The app-layer guard is convenience; this is the guarantee. A raw client, a psql
    // session, or a future service all hit the same trigger.
    await expect(
      platformOps.prisma.$executeRawUnsafe(
        `UPDATE evidence_events SET type = 'session.failed' WHERE "sessionId" = $1::uuid`,
        sessionId,
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('blocks evidence deletes at the database', async () => {
    await expect(
      platformOps.prisma.$executeRawUnsafe(
        `DELETE FROM evidence_events WHERE "sessionId" = $1::uuid`,
        sessionId,
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('blocks audit updates and deletes at the database', async () => {
    await platformOps.prisma.auditEvent.create({
      data: { action: 'test.action', tenantId: tenant.id },
    });

    await expect(
      platformOps.prisma.$executeRawUnsafe(`UPDATE audit_events SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/i);
    await expect(platformOps.prisma.$executeRawUnsafe(`DELETE FROM audit_events`)).rejects.toThrow(
      /append-only/i,
    );
  });

  it('freezes a published workflow version but leaves drafts editable', async () => {
    const workflowId = await runWithTenant({ tenantId: tenant.id }, async () => {
      const workflow = await db.workflow.create({
        data: { tenantId: tenant.id, name: 'freeze test' },
        select: { id: true },
      });
      return workflow.id;
    });

    const draft = await platformOps.prisma.workflowVersion.create({
      data: { workflowId, semver: '0.1.0', dslDocument: { nodes: [] } },
      select: { id: true },
    });

    // Draft: editable, and the publish transition itself is an allowed update.
    await platformOps.prisma.workflowVersion.update({
      where: { id: draft.id },
      data: { changelog: 'still a draft' },
    });
    await platformOps.prisma.workflowVersion.update({
      where: { id: draft.id },
      data: { publishedAt: new Date() },
    });

    // Published: frozen, because sessions pin this version id (ADR-007).
    await expect(
      platformOps.prisma.workflowVersion.update({
        where: { id: draft.id },
        data: { dslDocument: { nodes: ['rewritten'] } },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      platformOps.prisma.workflowVersion.delete({ where: { id: draft.id } }),
    ).rejects.toThrow(/immutable/i);
  });
});
