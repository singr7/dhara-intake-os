import { z } from 'zod';

/**
 * The Intake Evidence Graph taxonomy (doc 05 §4, plus the doc-13 §7 addendum).
 *
 * The full list is defined now, in S02, even though most types do not fire until S04–S28.
 * The reason is that the taxonomy is a contract, not an implementation detail: the stream
 * *is* the audit trail, the provenance source behind every field value, and the eval
 * dataset. Adding names ad hoc as features land is how event streams become unqueryable.
 *
 * `type` is stored as a string column (the values contain dots, which Prisma enums cannot
 * hold); this enum is what every write is validated against.
 */
export const evidenceEventTypes = [
  // Lifecycle
  'session.created',
  'session.state_changed',
  'session.completed',
  'session.abandoned',
  'session.failed',

  // Consent (doc 09 §2 — no consent, no questions)
  'consent.requested',
  'consent.granted',
  'consent.declined',

  // Node traversal & prompts
  'node.entered',
  'prompt.played',

  // Answers
  'answer.audio_captured',
  'answer.transcribed',
  'answer.touch',
  'answer.interpreted',
  'answer.confirmation_shown',
  'answer.confirmed',
  'answer.rejected',
  'clarification.asked',
  'fallback.triggered',

  // Commits & safety
  'field.committed',
  'redflag.raised',
  'assistance.requested',
  'assistance.provided',

  // Review, summary, export, cost
  'review.correction',
  'review.approved',
  'review.returned',
  'review.escalated',
  'summary.generated',
  'export.sent',
  'export.failed',
  'cost.recorded',

  // Doc-13 amendment: appointments, access, agentic tier
  'action.requested',
  'action.executed',
  'action.failed',
  'checkin.completed',
  'tool.invoked',
  'kb.answer_served',
] as const;

export type EvidenceEventType = (typeof evidenceEventTypes)[number];

export const evidenceEventTypeSchema = z.enum(evidenceEventTypes);

export const evidenceActorKinds = ['system', 'patient', 'operator', 'provider'] as const;

export const evidenceActorSchema = z.object({
  kind: z.enum(evidenceActorKinds),
  /** User id for operator actors, provider name for provider actors. */
  id: z.string().optional(),
});

export type EvidenceActor = z.infer<typeof evidenceActorSchema>;

/**
 * Required payload keys per type (doc 05 §4). Payloads are open — a session may add
 * context — but the listed keys must be present, because downstream consumers (provenance
 * rendering, the review console, the eval harness) read them by name.
 *
 * Only the minimum from doc 05 is asserted here; richer per-type schemas arrive with the
 * sessions that actually emit them.
 */
export const requiredEventPayloadKeys: Record<EvidenceEventType, readonly string[]> = {
  'session.created': ['mode', 'surface', 'workflowVersionId', 'initiator'],
  'session.state_changed': ['from', 'to', 'reason'],
  'session.completed': [],
  'session.abandoned': [],
  'session.failed': [],

  'consent.requested': ['purposeVersion', 'language', 'method'],
  'consent.granted': ['purposeVersion', 'language', 'method'],
  'consent.declined': ['purposeVersion', 'language', 'method'],

  'node.entered': ['nodeId', 'lang'],
  'prompt.played': ['nodeId', 'promptAudioId', 'source'],

  'answer.audio_captured': ['nodeId', 'mediaObjectId', 'durationMs'],
  'answer.transcribed': ['nodeId', 'provider', 'model', 'transcript', 'confidence', 'langDetected'],
  'answer.touch': ['nodeId', 'value'],
  'answer.interpreted': ['nodeId', 'method', 'value', 'confidence', 'ambiguityMarkers'],
  'answer.confirmation_shown': ['nodeId', 'method'],
  'answer.confirmed': ['nodeId', 'method'],
  'answer.rejected': ['nodeId', 'method'],
  'clarification.asked': ['nodeId', 'question', 'attempt'],
  'fallback.triggered': ['nodeId', 'from', 'to', 'reason'],

  'field.committed': ['fieldKey', 'value', 'confidence', 'sourceEventIds'],
  'redflag.raised': ['ruleId', 'fieldKeys', 'severity', 'escalation'],
  'assistance.requested': ['nodeId'],
  'assistance.provided': ['nodeId'],

  'review.correction': ['fieldKey', 'before', 'after', 'userId'],
  'review.approved': ['userId'],
  'review.returned': ['userId'],
  'review.escalated': ['userId'],
  'summary.generated': ['templateId', 'outputHash'],
  'export.sent': ['targetId', 'payloadHash'],
  'export.failed': ['targetId', 'payloadHash'],
  'cost.recorded': ['costRecordId'],

  'action.requested': ['actionKind', 'params'],
  'action.executed': ['actionKind', 'params', 'resultRef'],
  'action.failed': ['actionKind', 'params', 'reason'],
  'checkin.completed': ['appointmentId'],
  'tool.invoked': ['tool', 'argsHash', 'resultRef'],
  'kb.answer_served': ['articleIds', 'question'],
};

export const evidenceEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number().int().positive(),
  type: evidenceEventTypeSchema,
  payload: z.record(z.unknown()),
  actor: evidenceActorSchema,
  createdAt: z.string(),
});

export type EvidenceEventView = z.infer<typeof evidenceEventSchema>;

/** Returns the payload keys doc 05 §4 requires for `type` that are missing from `payload`. */
export function missingPayloadKeys(
  type: EvidenceEventType,
  payload: Record<string, unknown>,
): string[] {
  return requiredEventPayloadKeys[type].filter((key) => !(key in payload));
}
