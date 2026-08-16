import {
  workflowDocumentSchema,
  type WorkflowSummary,
  type WorkflowVersionSummary,
} from '@dhara/contracts';
import { db, requireTenantId, type Workflow, type WorkflowVersion } from '@dhara/db';
import { INITIAL_SEMVER, bumpSemver, classifyChange, validate, type BumpKind } from '@dhara/dsl';
import { ApiError } from '../../plugins/error.js';

/**
 * Workflow authoring and publishing (doc 07 §1, doc 06 §7–8).
 *
 * The model is one editable draft row per workflow plus an append-only history of published
 * versions:
 *
 *   - Every workflow always has exactly one version row with `publishedAt = null`. That row
 *     is what `PUT /draft` rewrites, and it is the only row in the table that is mutable.
 *   - Publishing *promotes* that row — a single UPDATE setting content, semver and
 *     `publishedAt` together — and then opens a fresh draft carrying the same document.
 *
 * The single-UPDATE detail is not stylistic. The database trigger from S02 freezes a row the
 * moment `publishedAt` is set, and permits exactly one transition: draft → published. Writing
 * the content first and stamping `publishedAt` second would be rejected by the trigger on the
 * second write, and stamping first would freeze the row before the content landed.
 */

/**
 * The semver of the unpublished row. It is deliberately not a valid release version: it
 * sorts below every real one and it cannot collide with a published semver under
 * `@@unique([workflowId, semver])`.
 */
export const DRAFT_SEMVER = '0.0.0-draft';

export interface WorkflowWithVersions extends Workflow {
  versions: WorkflowVersion[];
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function versionSummary(version: WorkflowVersion): WorkflowVersionSummary {
  return {
    id: version.id,
    semver: version.semver,
    publishedAt: toIso(version.publishedAt),
    publishedBy: version.publishedBy,
    changelog: version.changelog,
    createdAt: version.createdAt.toISOString(),
  };
}

export function workflowSummary(workflow: WorkflowWithVersions): WorkflowSummary {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
    versions: workflow.versions.map(versionSummary),
  };
}

/** The draft row, or `null` if a workflow somehow has none (only possible by hand-editing). */
export function draftOf(workflow: WorkflowWithVersions): WorkflowVersion | null {
  return workflow.versions.find((version) => version.publishedAt === null) ?? null;
}

export function publishedVersions(workflow: WorkflowWithVersions): WorkflowVersion[] {
  return workflow.versions
    .filter((version) => version.publishedAt !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * A starting document that already validates, so a new workflow can be published, run and
 * *then* filled in. An empty skeleton that fails validation teaches the author that the
 * validator is an obstacle; one that passes teaches them what a valid document looks like.
 */
export function starterDocument(name: string): Record<string, unknown> {
  const key =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workflow';

  return {
    dslVersion: '1.0',
    key,
    title: { en: name },
    languages: ['en'],
    defaultMode: 'touch',
    consent: {
      purposeVersion: new Date().toISOString().slice(0, 10),
      text: {
        en: 'We will ask you a few questions and share your answers with the clinic staff who will see you.',
      },
    },
    fields: {},
    nodes: [
      {
        id: 'info_welcome',
        type: 'info',
        prompt: { en: 'A few quick questions before you are seen.' },
        next: 'end_done',
      },
      {
        id: 'end_done',
        type: 'end',
        outcome: 'completed',
        prompt: { en: 'Thank you. Please wait to be called.' },
      },
    ],
    rules: { redFlags: [], validations: [] },
    review: { alwaysReview: [], confidenceThreshold: 0.75, reviewRequired: true },
    output: { schemaId: `${key}-output@1` },
  };
}

// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<WorkflowWithVersions[]> {
  return db.workflow.findMany({
    include: { versions: true },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Loads one workflow with its versions, or 404s.
 *
 * Every version access in this module goes through here first. `workflow_versions` has no
 * `tenantId` of its own — it inherits tenancy from its parent — so it is *not* covered by
 * the scoped client (D-007). Reaching it only via a scoped `workflow` lookup is what keeps
 * that inheritance real rather than assumed.
 */
export async function getWorkflowOr404(id: string): Promise<WorkflowWithVersions> {
  const workflow = await db.workflow.findFirst({ where: { id }, include: { versions: true } });
  if (!workflow) throw new ApiError('NOT_FOUND', `workflow ${id}`);
  return workflow;
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  dslDocument?: Record<string, unknown>;
}): Promise<WorkflowWithVersions> {
  const document = input.dslDocument ?? starterDocument(input.name);

  return db.workflow.create({
    data: {
      // The scoped client injects this too; naming it keeps the Prisma input type honest
      // about a required relation instead of asserting it away.
      tenantId: requireTenantId(),
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      versions: {
        create: { semver: DRAFT_SEMVER, dslDocument: document as never },
      },
    },
    include: { versions: true },
  });
}

/** Replaces the draft document. Invalid drafts save — that is what a draft is. */
export async function replaceDraft(
  workflowId: string,
  dslDocument: Record<string, unknown>,
): Promise<WorkflowVersion> {
  const workflow = await getWorkflowOr404(workflowId);
  const draft = draftOf(workflow);
  if (!draft) {
    throw new ApiError('NOT_FOUND', `workflow ${workflowId} has no open draft`);
  }

  return db.workflowVersion.update({
    where: { id: draft.id },
    data: { dslDocument: dslDocument as never },
  });
}

export interface PublishResult {
  version: WorkflowVersionSummary;
  bump: BumpKind;
  warnings: { code: string; message: string; path: string }[];
}

export async function publishWorkflow(input: {
  workflowId: string;
  changelog?: string;
  userId: string;
}): Promise<PublishResult> {
  const workflow = await getWorkflowOr404(input.workflowId);
  const draft = draftOf(workflow);
  if (!draft) throw new ApiError('NOT_FOUND', `workflow ${input.workflowId} has no open draft`);

  const result = validate(draft.dslDocument, { forPublish: true });
  if (result.errors.length > 0 || !result.compiledGraph) {
    // The whole list, not the first line of it: an author fixing a workflow needs to see
    // every problem in one pass (RFC 7807 extension member — see `problem.ts`).
    throw new ApiError(
      'DSL_VALIDATION_FAILED',
      `${result.errors.length} problem(s) must be fixed before publishing`,
      { issues: result.errors },
    );
  }

  const document = workflowDocumentSchema.parse(draft.dslDocument);
  const previous = publishedVersions(workflow).at(-1);
  const bump: BumpKind = previous ? classifyChange(previous.dslDocument, document) : 'major';
  const semver = previous ? bumpSemver(previous.semver, bump) : INITIAL_SEMVER;

  const published = await db.$transaction(async (tx) => {
    // One UPDATE: content, version and `publishedAt` together. See the note at the top of
    // this file for why splitting it would be rejected by the freeze trigger.
    const version = await tx.workflowVersion.update({
      where: { id: draft.id },
      data: {
        semver,
        dslDocument: draft.dslDocument as never,
        compiledGraph: result.compiledGraph as never,
        changelog: input.changelog ?? null,
        publishedAt: new Date(),
        publishedBy: input.userId,
      },
    });

    // The next draft starts from what was just published, so editing continues seamlessly.
    await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        semver: DRAFT_SEMVER,
        dslDocument: draft.dslDocument as never,
      },
    });

    await tx.workflow.update({ where: { id: workflow.id }, data: { status: 'active' } });
    return version;
  });

  return { version: versionSummary(published), bump, warnings: result.warnings };
}

/** A published or draft version by id, tenant-checked through its parent workflow. */
export async function getVersionOr404(versionId: string): Promise<WorkflowVersion> {
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError('NOT_FOUND', `workflow version ${versionId}`);
  // `workflow_versions` is not tenant-scoped by the client extension, so the parent lookup
  // below is the tenancy check, not a convenience.
  const parent = await db.workflow.findFirst({
    where: { id: version.workflowId, tenantId: requireTenantId() },
    select: { id: true },
  });
  if (!parent) throw new ApiError('NOT_FOUND', `workflow version ${versionId}`);
  return version;
}

/** Validates a document without saving anything (doc 07 §1). */
export function validateDocument(
  document: unknown,
  options: { forPublish?: boolean } = {},
): {
  valid: boolean;
  errors: { code: string; message: string; path: string }[];
  warnings: { code: string; message: string; path: string }[];
} {
  const result = validate(document, options);
  return { valid: result.errors.length === 0, errors: result.errors, warnings: result.warnings };
}
