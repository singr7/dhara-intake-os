import { beforeEach, describe, expect, it } from 'vitest';
import { evidenceEventTypes, missingPayloadKeys, type EvidenceEventType } from '@dhara/contracts';
import { db, platformOps, runWithTenant } from '@dhara/db';
import { createTestTenant, hasTestDatabase, resetTestDatabase } from '@dhara/db/testing';
import { emitEvent, EvidenceContractError, listEvents } from './index.js';

/**
 * The evidence graph writer (ADR-010, doc 05 §4). The property that matters is the
 * sequence: it must be unique and gap-free per session no matter how many writers race.
 */

describe('event taxonomy contract', () => {
  it('covers the doc 05 §4 taxonomy including the doc-13 addendum', () => {
    expect(evidenceEventTypes).toContain('session.created');
    expect(evidenceEventTypes).toContain('field.committed');
    expect(evidenceEventTypes).toContain('redflag.raised');
    expect(evidenceEventTypes).toContain('tool.invoked');
    expect(new Set(evidenceEventTypes).size).toBe(evidenceEventTypes.length);
  });

  it('names the payload keys a type is missing', () => {
    expect(missingPayloadKeys('field.committed', { fieldKey: 'fever' })).toEqual([
      'value',
      'confidence',
      'sourceEventIds',
    ]);
    expect(missingPayloadKeys('session.completed', {})).toEqual([]);
  });
});

describe.runIf(hasTestDatabase)('emitEvent', () => {
  let tenantId: string;
  let otherTenantId: string;
  let sessionId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    tenantId = (await createTestTenant('evidence-clinic')).id;
    otherTenantId = (await createTestTenant('other-clinic')).id;

    sessionId = await runWithTenant({ tenantId }, async () => {
      const workflow = await db.workflow.create({
        data: { tenantId, name: 'wf' },
        select: { id: true },
      });
      const version = await platformOps.prisma.workflowVersion.create({
        data: { workflowId: workflow.id, semver: '1.0.0', dslDocument: {} },
        select: { id: true },
      });
      const session = await db.intakeSession.create({
        data: {
          tenantId,
          workflowVersionId: version.id,
          mode: 'touch',
          surface: 'pwa',
          language: 'en',
        },
        select: { id: true },
      });
      return session.id;
    });
  });

  it('appends the first event at seq 1', async () => {
    const event = await runWithTenant({ tenantId }, () =>
      emitEvent({
        sessionId,
        type: 'session.created',
        payload: {
          mode: 'touch',
          surface: 'pwa',
          workflowVersionId: 'wv',
          initiator: 'operator',
        },
        actor: { kind: 'system' },
      }),
    );

    expect(event.seq).toBe(1);
    expect(event.tenantId).toBe(tenantId);
  });

  it('numbers events monotonically in emission order', async () => {
    await runWithTenant({ tenantId }, async () => {
      for (let i = 0; i < 5; i += 1) {
        await emitEvent({
          sessionId,
          type: 'node.entered',
          payload: { nodeId: `n${i}`, lang: 'en' },
          actor: { kind: 'system' },
        });
      }
    });

    const events = await runWithTenant({ tenantId }, () => listEvents(sessionId));
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((e) => (e.payload as { nodeId: string }).nodeId)).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
      'n4',
    ]);
  });

  it('assigns unique, gap-free sequences under concurrent writers', async () => {
    // The real failure mode this guards: a websocket push, an HTTP answer and a worker
    // callback appending to one session at the same moment. MAX(seq)+1 would collide here.
    const count = 20;
    await runWithTenant({ tenantId }, () =>
      Promise.all(
        Array.from({ length: count }, (_unused, i) =>
          emitEvent({
            sessionId,
            type: 'answer.touch',
            payload: { nodeId: `n${i}`, value: i },
            actor: { kind: 'patient' },
          }),
        ),
      ),
    );

    const events = await runWithTenant({ tenantId }, () => listEvents(sessionId));
    expect(events).toHaveLength(count);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: count }, (_u, i) => i + 1));
  });

  it('keeps sequences independent per session', async () => {
    const secondSessionId = await runWithTenant({ tenantId }, async () => {
      const version = await platformOps.prisma.workflowVersion.findFirstOrThrow({
        select: { id: true },
      });
      const session = await db.intakeSession.create({
        data: {
          tenantId,
          workflowVersionId: version.id,
          mode: 'touch',
          surface: 'pwa',
          language: 'en',
        },
        select: { id: true },
      });
      return session.id;
    });

    await runWithTenant({ tenantId }, async () => {
      await emitEvent({ sessionId, type: 'session.completed', actor: { kind: 'system' } });
      await emitEvent({
        sessionId: secondSessionId,
        type: 'session.completed',
        actor: { kind: 'system' },
      });
    });

    const first = await runWithTenant({ tenantId }, () => listEvents(sessionId));
    const second = await runWithTenant({ tenantId }, () => listEvents(secondSessionId));
    expect(first[0]?.seq).toBe(1);
    expect(second[0]?.seq).toBe(1);
  });

  it('refuses an event type outside the doc 05 §4 taxonomy', async () => {
    await runWithTenant({ tenantId }, async () => {
      await expect(
        emitEvent({
          sessionId,
          type: 'answer.vibes' as EvidenceEventType,
          actor: { kind: 'system' },
        }),
      ).rejects.toThrow(EvidenceContractError);
    });
  });

  it('refuses an event missing the payload keys its type requires', async () => {
    await runWithTenant({ tenantId }, async () => {
      await expect(
        emitEvent({
          sessionId,
          type: 'field.committed',
          payload: { fieldKey: 'fever' },
          actor: { kind: 'system' },
        }),
      ).rejects.toThrow(/value, confidence, sourceEventIds/);
    });
  });

  it('cannot append to another tenant’s session', async () => {
    await runWithTenant({ tenantId: otherTenantId }, async () => {
      await expect(
        emitEvent({ sessionId, type: 'session.completed', actor: { kind: 'system' } }),
      ).rejects.toThrow();
    });

    const events = await platformOps.prisma.evidenceEvent.findMany({ where: { sessionId } });
    expect(events).toHaveLength(0);
  });

  it('does not burn a sequence number when the write is rejected', async () => {
    await runWithTenant({ tenantId }, async () => {
      await expect(
        emitEvent({
          sessionId,
          type: 'field.committed',
          payload: { fieldKey: 'incomplete' },
          actor: { kind: 'system' },
        }),
      ).rejects.toThrow(EvidenceContractError);

      const event = await emitEvent({
        sessionId,
        type: 'session.completed',
        actor: { kind: 'system' },
      });
      expect(event.seq).toBe(1);
    });
  });
});
