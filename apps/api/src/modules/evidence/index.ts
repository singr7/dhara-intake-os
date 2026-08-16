import {
  evidenceEventTypeSchema,
  missingPayloadKeys,
  type EvidenceActor,
  type EvidenceEventType,
} from '@dhara/contracts';
import { db, requireTenantId, type EvidenceEvent } from '@dhara/db';

/**
 * The evidence graph writer (ADR-010, doc 05 §4).
 *
 * Every intake fact enters the system through here. Rows are append-only at the database
 * level, so this module has exactly one job to get right: give each event a sequence number
 * that is unique and monotonic *per session*, even when a websocket push, an HTTP answer
 * and a worker callback all fire at once.
 *
 * How: the counter lives on `intake_sessions.eventSeq` and is incremented inside the same
 * transaction as the insert. The UPDATE takes a row lock, so concurrent emitters queue
 * behind it and cannot read the same value — no advisory locks, no retry loop, and no
 * `MAX(seq)+1` race. `@@unique([sessionId, seq])` is the assertion that this holds.
 */

export class EvidenceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceContractError';
  }
}

export interface EmitEventInput {
  sessionId: string;
  type: EvidenceEventType;
  payload?: Record<string, unknown>;
  actor: EvidenceActor;
}

/**
 * Appends one event and returns it. Requires a tenant context (the scoped client refuses
 * the write otherwise), which also means an event can never be attached to another
 * tenant's session.
 */
export async function emitEvent(input: EmitEventInput): Promise<EvidenceEvent> {
  const type = evidenceEventTypeSchema.safeParse(input.type);
  if (!type.success) {
    throw new EvidenceContractError(
      `Unknown evidence event type "${input.type}". Add it to evidenceEventTypes in ` +
        '@dhara/contracts (doc 05 §4) before emitting it.',
    );
  }

  const payload = input.payload ?? {};
  const missing = missingPayloadKeys(type.data, payload);
  if (missing.length > 0) {
    throw new EvidenceContractError(
      `Event ${type.data} is missing required payload keys: ${missing.join(', ')} (doc 05 §4).`,
    );
  }

  return db.$transaction(async (tx) => {
    // The row lock this UPDATE takes is what serialises concurrent emitters.
    const session = await tx.intakeSession.update({
      where: { id: input.sessionId },
      data: { eventSeq: { increment: 1 } },
      select: { eventSeq: true },
    });

    return tx.evidenceEvent.create({
      data: {
        sessionId: input.sessionId,
        // Overwritten by the tenant-scope extension; named here because Prisma's generated
        // create input requires it (see requireTenantId).
        tenantId: requireTenantId(),
        seq: session.eventSeq,
        type: type.data,
        payload: payload as never,
        actor: input.actor as never,
      },
    });
  });
}

/** The ordered event stream for a session — the provenance and audit view (doc 05 §4). */
export async function listEvents(sessionId: string): Promise<EvidenceEvent[]> {
  return db.evidenceEvent.findMany({ where: { sessionId }, orderBy: { seq: 'asc' } });
}
