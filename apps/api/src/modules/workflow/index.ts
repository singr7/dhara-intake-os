import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createWorkflowRequestSchema,
  fromPackRequestSchema,
  publishRequestSchema,
  publishResponseSchema,
  putDraftRequestSchema,
  putDraftResponseSchema,
  validateRequestSchema,
  validationResponseSchema,
  workflowDetailResponseSchema,
  workflowListResponseSchema,
  workflowVersionResponseSchema,
} from '@dhara/contracts';
import { ApiError } from '../../plugins/error.js';
import { requireRole, requireUser } from '../../plugins/auth.js';
import { audit, auditActions } from '../audit/index.js';
import {
  createWorkflow,
  draftOf,
  getVersionOr404,
  getWorkflowOr404,
  listWorkflows,
  publishWorkflow,
  replaceDraft,
  validateDocument,
  workflowSummary,
} from './service.js';

/**
 * Workflow routes — the Studio surface of doc 07 §1.
 *
 * Authoring a workflow is a privileged act: a published version decides what every patient
 * in the tenant is asked, so the whole module is behind `admin`/`owner` and every publish
 * lands in the audit trail. Reviewers and staff read workflows through the sessions that
 * pin them, not through here.
 */

const idParamsSchema = z.object({ id: z.string().uuid() });

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const authoring = { preHandler: requireRole('admin', 'owner') };

  routes.get(
    '/workflows',
    { ...authoring, schema: { response: { 200: workflowListResponseSchema } } },
    async () => ({ workflows: (await listWorkflows()).map(workflowSummary) }),
  );

  routes.post(
    '/workflows',
    {
      ...authoring,
      schema: {
        body: createWorkflowRequestSchema,
        response: { 201: workflowDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const workflow = await createWorkflow(request.body);
      const draft = draftOf(workflow);
      void reply.code(201);
      return {
        workflow: workflowSummary(workflow),
        draft: draft
          ? { versionId: draft.id, dslDocument: draft.dslDocument as Record<string, unknown> }
          : null,
      };
    },
  );

  routes.get(
    '/workflows/:id',
    {
      ...authoring,
      schema: { params: idParamsSchema, response: { 200: workflowDetailResponseSchema } },
    },
    async (request) => {
      const workflow = await getWorkflowOr404(request.params.id);
      const draft = draftOf(workflow);
      return {
        workflow: workflowSummary(workflow),
        draft: draft
          ? { versionId: draft.id, dslDocument: draft.dslDocument as Record<string, unknown> }
          : null,
      };
    },
  );

  routes.put(
    '/workflows/:id/draft',
    {
      ...authoring,
      schema: {
        params: idParamsSchema,
        body: putDraftRequestSchema,
        response: { 200: putDraftResponseSchema },
      },
    },
    async (request) => {
      const version = await replaceDraft(request.params.id, request.body.dslDocument);
      // Saved either way; the validation result is advice for the editor, not a gate.
      return { versionId: version.id, validation: validateDocument(request.body.dslDocument) };
    },
  );

  routes.post(
    '/workflows/:id/validate',
    {
      ...authoring,
      schema: {
        params: idParamsSchema,
        body: validateRequestSchema,
        response: { 200: validationResponseSchema },
      },
    },
    async (request) => {
      let document = request.body.dslDocument;
      if (!document) {
        const workflow = await getWorkflowOr404(request.params.id);
        const draft = draftOf(workflow);
        if (!draft)
          throw new ApiError('NOT_FOUND', `workflow ${request.params.id} has no open draft`);
        document = draft.dslDocument as Record<string, unknown>;
      }
      return validateDocument(document, { forPublish: request.body.forPublish ?? false });
    },
  );

  routes.post(
    '/workflows/:id/publish',
    {
      ...authoring,
      schema: {
        params: idParamsSchema,
        body: publishRequestSchema,
        response: { 200: publishResponseSchema },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const result = await publishWorkflow({
        workflowId: request.params.id,
        changelog: request.body.changelog,
        userId: user.id,
      });

      await audit({
        action: auditActions.workflowPublished,
        objectRef: {
          workflowId: request.params.id,
          versionId: result.version.id,
          semver: result.version.semver,
          bump: result.bump,
        },
        tenantId: user.tenantId,
        userId: user.id,
        ip: request.ip,
      });

      return result;
    },
  );

  routes.get(
    '/workflow-versions/:id',
    {
      ...authoring,
      schema: { params: idParamsSchema, response: { 200: workflowVersionResponseSchema } },
    },
    async (request) => {
      const version = await getVersionOr404(request.params.id);
      return {
        id: version.id,
        workflowId: version.workflowId,
        semver: version.semver,
        publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
        changelog: version.changelog,
        createdAt: version.createdAt.toISOString(),
        dslDocument: version.dslDocument as Record<string, unknown>,
        compiledGraph: (version.compiledGraph as Record<string, unknown> | null) ?? null,
      };
    },
  );

  /**
   * Pack routes. The pack *tables* exist (S02) but nothing populates them until the pack
   * framework lands in S19, and a route that answers with an empty list is indistinguishable
   * from a tenant with no packs — so these say 501 rather than lie by omission.
   */
  const notImplemented = (feature: string) => async (): Promise<never> => {
    throw new ApiError('NOT_IMPLEMENTED', `${feature} lands with the pack framework in S19`);
  };

  routes.post(
    '/workflows/from-pack',
    { ...authoring, schema: { body: fromPackRequestSchema } },
    notImplemented('creating a workflow from a pack'),
  );
  routes.get('/packs', authoring, notImplemented('the pack catalogue'));
  routes.get(
    '/packs/:key/versions',
    { ...authoring, schema: { params: z.object({ key: z.string().min(1) }) } },
    notImplemented('pack versions'),
  );
}
