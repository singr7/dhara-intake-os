import { z } from 'zod';

/**
 * The intake workflow DSL (doc 06) as Zod schemas.
 *
 * Shape lives here, in contracts, because three packages need it: `@dhara/dsl` compiles and
 * interprets it, the API stores and serves it, and the studio (M5) edits it. Graph-level
 * checks — reachability, termination, field-before-use, deny-list — are *not* expressible
 * in Zod and live in `@dhara/dsl`'s `validate()`; this file is the shape gate only.
 *
 * The whole document is defined now, including the parts no session reads yet (`action`
 * nodes from the doc-13 amendment, `promptAudio` hints consumed in S08), for the same
 * reason the evidence taxonomy was: a document format that grows a field at a time is a
 * format nobody can version.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** BCP-47-ish language tag. Kept loose: pack authors write `en`, `hi`, `mr`, `bn-IN`. */
export const languageTagSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/, 'expected a language tag such as "en" or "hi"');

/**
 * Every patient-visible string is a `{lang → text}` map (doc 06 §6). Missing languages fall
 * back to `languages[0]`; the validator reports the gap (warning in draft, error on publish).
 */
export const localizedTextSchema = z
  .record(languageTagSchema, z.string().min(1))
  .refine((value) => Object.keys(value).length > 0, {
    message: 'needs text in at least one language',
  });

export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const localizedListSchema = z.record(languageTagSchema, z.array(z.string().min(1)));

/**
 * An expression in the doc 06 §4 grammar, branded so a plain string cannot be passed where
 * a parsed-and-type-checked expression is expected. Parsing happens in `@dhara/dsl` — never
 * `eval`, never a `Function` constructor (ADR-007).
 */
export const expressionSchema = z.string().min(1).brand<'DslExpression'>();
export type Expression = z.infer<typeof expressionSchema>;

/** Identifier for nodes, fields, rules: lowercase snake/kebab, stable across versions. */
export const dslIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'expected lower_snake_case starting with a letter');

/** The terminal marker usable anywhere a node id is expected. */
export const END_NODE_REF = '$end' as const;

export const nodeRefSchema = z.union([dslIdSchema, z.literal(END_NODE_REF)]);

export const sessionModeSchema = z.enum(['touch', 'hybrid', 'conversational', 'assisted']);
export type SessionModeName = z.infer<typeof sessionModeSchema>;

// ---------------------------------------------------------------------------
// Answer schemas (doc 06 §3)
// ---------------------------------------------------------------------------

export const choiceOptionSchema = z.object({
  value: z.string().min(1),
  label: localizedTextSchema,
  icon: z.string().min(1).optional(),
  /** Spoken variants matched deterministically before any LLM is asked (extraction rung 2). */
  synonyms: localizedListSchema.optional(),
});

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const durationUnitSchema = z.enum(['days', 'weeks', 'months', 'years']);

export const piiLevelSchema = z.enum(['none', 'low', 'high']);

const answerVariants = [
  z.object({ type: z.literal('choice'), options: z.array(choiceOptionSchema).min(1) }),
  z.object({
    type: z.literal('multiChoice'),
    options: z.array(choiceOptionSchema).min(1),
    max: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('boolean'),
    trueSynonyms: localizedListSchema.optional(),
    falseSynonyms: localizedListSchema.optional(),
  }),
  z.object({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().min(1).optional(),
    unitSynonyms: localizedListSchema.optional(),
  }),
  z.object({
    type: z.literal('duration'),
    units: z.array(durationUnitSchema).min(1).optional(),
    maxValue: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal('date'),
    min: z.string().optional(),
    max: z.string().optional(),
    relativeAllowed: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    maxLen: z.number().int().positive().max(4000).optional(),
    piiLevel: piiLevelSchema.optional(),
  }),
  z.object({ type: z.literal('phone'), pattern: z.string().min(1).optional() }),
  z.object({ type: z.literal('id'), pattern: z.string().min(1).optional() }),
  z.object({ type: z.literal('bodyLocation'), regions: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal('media'),
    accept: z.array(z.string().min(1)).min(1).optional(),
    maxFiles: z.number().int().positive().max(20).optional(),
  }),
] as const;

/** An answer schema without the field-level `required` flag (`question.answer` override). */
export const answerSchemaSchema = z.discriminatedUnion('type', [...answerVariants]);
export type AnswerSchema = z.infer<typeof answerSchemaSchema>;

export const answerTypes = answerVariants.map((v) => v.shape.type.value);
export type AnswerType = AnswerSchema['type'];

/** What a field declaration adds on top of its answer schema. */
const fieldMeta = {
  required: z.boolean().default(false),
  /** Retention class hint consumed by S17; recorded now so packs can declare it. */
  retention: z.enum(['standard', 'sensitive']).optional(),
};

const fieldVariants = answerVariants.map((variant) => variant.extend(fieldMeta));
type FieldVariant = (typeof fieldVariants)[number];

/** A field declaration: an answer schema plus whether the intake may finish without it. */
export const fieldSchemaSchema = z.discriminatedUnion(
  'type',
  fieldVariants as [FieldVariant, ...FieldVariant[]],
);

export type FieldSchema = z.infer<typeof fieldSchemaSchema>;

// ---------------------------------------------------------------------------
// Nodes (doc 06 §2)
// ---------------------------------------------------------------------------

/** One entry of a conditional `next` list. The final entry must omit `when` (validator). */
export const transitionSchema = z.object({
  when: expressionSchema.optional(),
  next: nodeRefSchema,
});

export type Transition = z.infer<typeof transitionSchema>;

/** `next` is either an unconditional target or an ordered transition list. */
export const nextSchema = z.union([nodeRefSchema, z.array(transitionSchema).min(1)]);
export type Next = z.infer<typeof nextSchema>;

export const skippableSchema = z.union([
  z.boolean(),
  z.object({ skippable: z.literal(true), reason: z.string().min(1) }),
]);

const nodeBase = {
  id: dslIdSchema,
  /** Per-node override of `defaultMode` (doc 06 §2). */
  mode: sessionModeSchema.optional(),
  skippable: skippableSchema.optional(),
};

export const promptAudioHintSchema = z.object({
  /** Pack-relative key of a human recording, resolved ahead of TTS (doc 06 §6). */
  recordingKey: z.string().min(1).optional(),
  voice: z.string().min(1).optional(),
  speed: z.number().positive().max(3).optional(),
});

export const confirmPolicySchema = z.enum(['always', 'lowConfidence', 'never']);
export type ConfirmPolicy = z.infer<typeof confirmPolicySchema>;

const questionNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('question'),
  fieldKey: dslIdSchema,
  prompt: localizedTextSchema,
  helpText: localizedTextSchema.optional(),
  promptAudio: promptAudioHintSchema.optional(),
  /** Overrides `fields[fieldKey]` for this node; the `type` must match (validator). */
  answer: answerSchemaSchema.optional(),
  confirm: confirmPolicySchema.default('lowConfidence'),
  next: nextSchema,
});

const infoNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('info'),
  prompt: localizedTextSchema,
  promptAudio: promptAudioHintSchema.optional(),
  next: nextSchema,
});

const branchNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('branch'),
  cases: z.array(z.object({ when: expressionSchema, next: nodeRefSchema })).min(1),
  else: nodeRefSchema,
});

const computedNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('computed'),
  fieldKey: dslIdSchema,
  expr: expressionSchema,
  next: nextSchema,
});

const uploadNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('upload'),
  fieldKey: dslIdSchema,
  prompt: localizedTextSchema,
  accept: z.array(z.string().min(1)).min(1),
  maxFiles: z.number().int().positive().max(20).default(1),
  next: nextSchema,
});

const handoffNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('handoff'),
  reason: z.string().min(1),
  resumable: z.boolean().default(true),
  prompt: localizedTextSchema.optional(),
  /** Where the intake continues once a staff member resumes it; omit for a dead end. */
  next: nextSchema.optional(),
});

const checkpointNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('checkpoint'),
  label: z.string().min(1).optional(),
  next: nextSchema,
});

const endNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('end'),
  outcome: z.enum(['completed', 'abandoned', 'handed_off']).default('completed'),
  prompt: localizedTextSchema.optional(),
});

/**
 * Doc-13 amendment (S06A). The only construct that mutates state outside the session, so
 * `actionKind` is a closed enum owned by code — a DSL author can invoke an action, never
 * define one.
 */
const actionNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('action'),
  actionKind: z.enum(['book', 'reschedule', 'cancel', 'notify', 'escalate']),
  params: z.record(
    z.string().min(1),
    z.union([expressionSchema, z.string(), z.number(), z.boolean()]),
  ),
  onFailure: nodeRefSchema,
  next: nextSchema,
});

export const nodeSchema = z.discriminatedUnion('type', [
  questionNodeSchema,
  infoNodeSchema,
  branchNodeSchema,
  computedNodeSchema,
  uploadNodeSchema,
  handoffNodeSchema,
  checkpointNodeSchema,
  endNodeSchema,
  actionNodeSchema,
]);

export type DslNode = z.infer<typeof nodeSchema>;
export type NodeType = DslNode['type'];

/** Node types that commit a field, and therefore participate in the field-before-use check. */
export const fieldCommittingNodeTypes = ['question', 'computed', 'upload'] as const;

// ---------------------------------------------------------------------------
// Rules, review, output (doc 06 §5, §1)
// ---------------------------------------------------------------------------

export const redFlagSeveritySchema = z.enum(['low', 'medium', 'high']);
export const redFlagEscalationSchema = z.enum([
  'flag_only',
  'notify_review',
  'alert_staff_immediately',
]);

export const redFlagSchema = z.object({
  id: dslIdSchema,
  when: expressionSchema,
  severity: redFlagSeveritySchema,
  escalation: redFlagEscalationSchema,
  /**
   * Shown to the patient when the flag fires. Never advice, never a diagnosis — the
   * deny-list scan in `validate()` is what enforces that (ADR-015, doc 09 §1).
   */
  patientMessage: localizedTextSchema.optional(),
  staffNote: z.string().min(1).optional(),
});

export type RedFlag = z.infer<typeof redFlagSchema>;

export const crossFieldValidationSchema = z.object({
  id: dslIdSchema,
  when: expressionSchema,
  assert: expressionSchema,
  message: localizedTextSchema,
  severity: z.enum(['block', 'warn']),
});

export type CrossFieldValidation = z.infer<typeof crossFieldValidationSchema>;

export const rulesSchema = z.object({
  redFlags: z.array(redFlagSchema).default([]),
  validations: z.array(crossFieldValidationSchema).default([]),
});

export const reviewPolicySchema = z.object({
  alwaysReview: z.array(dslIdSchema).default([]),
  confidenceThreshold: z.number().min(0).max(1).default(0.75),
  reviewRequired: z.boolean().default(true),
});

export const outputPolicySchema = z.object({
  schemaId: z.string().min(1),
  summaryTemplateId: z.string().min(1).optional(),
  routingRule: z.string().min(1).optional(),
});

export const workflowSettingsSchema = z.object({
  maxDurationSec: z.number().int().positive().max(7200).default(900),
  maxCostPaise: z.number().int().nonnegative().default(500),
  voiceFallbackAfterFailures: z.number().int().min(1).max(5).default(2),
  clarificationMaxAttempts: z.number().int().min(0).max(3).default(1),
});

export const consentBlockSchema = z.object({
  purposeVersion: z.string().min(1),
  text: localizedTextSchema,
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const DSL_VERSION = '1.0' as const;

export const workflowDocumentSchema = z.object({
  dslVersion: z.literal(DSL_VERSION),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'expected a lower-kebab-case key'),
  title: localizedTextSchema,
  /** First entry is the fallback language for every missing string (doc 06 §1). */
  languages: z.array(languageTagSchema).min(1),
  defaultMode: sessionModeSchema.default('hybrid'),
  consent: consentBlockSchema,
  settings: workflowSettingsSchema.default({}),
  fields: z.record(dslIdSchema, fieldSchemaSchema),
  nodes: z.array(nodeSchema).min(1),
  rules: rulesSchema.default({}),
  review: reviewPolicySchema.default({}),
  output: outputPolicySchema,
});

/** The document as authors write it — defaults not yet applied. */
export type WorkflowDocumentInput = z.input<typeof workflowDocumentSchema>;
/** The document after parsing: every default filled in. This is what the compiler sees. */
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
