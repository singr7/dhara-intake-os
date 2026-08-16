import { z } from 'zod';

/**
 * Request/response DTOs for the Workflows block of doc 07 §1.
 *
 * The DSL document itself is carried as an opaque object rather than as
 * `workflowDocumentSchema`. That is deliberate: a draft is allowed to be invalid — that is
 * what "draft" means — and rejecting it at the HTTP boundary would make the studio unable
 * to save work in progress. Validation is a separate, explicit step whose whole job is to
 * produce a readable list of what is wrong, and it is the gate on *publishing*, not on
 * saving.
 */

/** The DSL document as it travels over the wire: an object, contents unchecked here. */
export const dslDocumentEnvelopeSchema = z.record(z.string(), z.unknown());

export const workflowVersionSummarySchema = z.object({
  id: z.string().uuid(),
  semver: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().uuid().nullable(),
  changelog: z.string().nullable(),
  createdAt: z.string(),
});

export type WorkflowVersionSummary = z.infer<typeof workflowVersionSummarySchema>;

export const workflowSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
  versions: z.array(workflowVersionSummarySchema),
});

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

export const createWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Seed document; omit to start from the built-in empty draft. */
  dslDocument: dslDocumentEnvelopeSchema.optional(),
});

export const workflowListResponseSchema = z.object({
  workflows: z.array(workflowSummarySchema),
});

export const workflowDetailResponseSchema = z.object({
  workflow: workflowSummarySchema,
  draft: z
    .object({ versionId: z.string().uuid(), dslDocument: dslDocumentEnvelopeSchema })
    .nullable(),
});

export const validationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** JSON pointer into the document, e.g. `/nodes/3/prompt/hi`. */
  path: z.string(),
});

export type ValidationIssueDto = z.infer<typeof validationIssueSchema>;

export const validationResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
});

export const putDraftRequestSchema = z.object({
  dslDocument: dslDocumentEnvelopeSchema,
});

/** `PUT /workflows/:id/draft` saves unconditionally and reports what it thinks of the doc. */
export const putDraftResponseSchema = z.object({
  versionId: z.string().uuid(),
  validation: validationResponseSchema,
});

export const validateRequestSchema = z.object({
  /** Omit to validate the stored draft. */
  dslDocument: dslDocumentEnvelopeSchema.optional(),
  /** Apply the stricter publish-time rules without publishing. */
  forPublish: z.boolean().optional(),
});

export const publishRequestSchema = z.object({
  changelog: z.string().max(2000).optional(),
});

export const publishResponseSchema = z.object({
  version: workflowVersionSummarySchema,
  /** How the version number moved, and why (doc 06 §8). */
  bump: z.enum(['major', 'minor', 'patch']),
  warnings: z.array(validationIssueSchema),
});

export const workflowVersionResponseSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  semver: z.string(),
  publishedAt: z.string().nullable(),
  changelog: z.string().nullable(),
  createdAt: z.string(),
  dslDocument: dslDocumentEnvelopeSchema,
  /** Present once published; `null` on a draft version. */
  compiledGraph: z.record(z.string(), z.unknown()).nullable(),
});

export const fromPackRequestSchema = z.object({
  packKey: z.string().min(1),
  packVersion: z.string().min(1).optional(),
});
