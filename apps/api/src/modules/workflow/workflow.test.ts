import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AUTH_COOKIE_NAME, problemSchema } from '@dhara/contracts';
import { platformOps } from '@dhara/db';
import { createTestTenant, hasTestDatabase, resetTestDatabase } from '@dhara/db/testing';
import { API_PREFIX, buildServer } from '../../server.js';
import { cookieValue, testEnv } from '../../test-support.js';
import { registerUser } from '../auth/service.js';

/**
 * The workflow authoring surface end-to-end: create → edit draft → validate → publish, the
 * round-trip doc 07 §1 specifies. These run through HTTP rather than against the service
 * functions because the parts most likely to break — the role guard, the tenancy boundary
 * on a table that is not tenant-scoped, and the publish freeze — only exist at that level.
 */

const env = testEnv();
const PASSWORD = 'correct-horse-battery-staple';

const packPath = fileURLToPath(
  new URL('../../../../../packs/opd-general/workflow.json', import.meta.url),
);
const opdDocument = JSON.parse(readFileSync(packPath, 'utf8')) as Record<string, unknown>;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(env);
});

afterAll(async () => {
  await app.close();
});

describe.runIf(hasTestDatabase)('workflows', () => {
  let ownerCookie: string;
  let reviewerCookie: string;
  let otherTenantCookie: string;

  async function login(tenantSlug: string, email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { tenantSlug, email, password: PASSWORD },
      remoteAddress: `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    });
    expect(response.statusCode).toBe(200);
    return cookieValue(response.headers['set-cookie'], AUTH_COOKIE_NAME)!;
  }

  const as = (cookie: string) => ({ cookie: `${AUTH_COOKIE_NAME}=${cookie}` });

  beforeEach(async () => {
    await resetTestDatabase();
    const alpha = await createTestTenant('alpha-clinic', 'Alpha Clinic');
    const beta = await createTestTenant('beta-clinic', 'Beta Clinic');

    await registerUser({
      tenantId: alpha.id,
      email: 'owner@alpha.test',
      password: PASSWORD,
      name: 'Alpha Owner',
      roles: ['owner'],
    });
    await registerUser({
      tenantId: alpha.id,
      email: 'nurse@alpha.test',
      password: PASSWORD,
      name: 'Alpha Nurse',
      roles: ['reviewer'],
    });
    await registerUser({
      tenantId: beta.id,
      email: 'owner@beta.test',
      password: PASSWORD,
      name: 'Beta Owner',
      roles: ['owner'],
    });

    ownerCookie = await login('alpha-clinic', 'owner@alpha.test');
    reviewerCookie = await login('alpha-clinic', 'nurse@alpha.test');
    otherTenantCookie = await login('beta-clinic', 'owner@beta.test');
  });

  async function createWorkflow(cookie = ownerCookie, name = 'OPD General') {
    const response = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/workflows`,
      headers: as(cookie),
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { workflow: { id: string }; draft: { versionId: string } };
  }

  async function putDraft(id: string, document: unknown, cookie = ownerCookie) {
    return app.inject({
      method: 'PUT',
      url: `${API_PREFIX}/workflows/${id}/draft`,
      headers: as(cookie),
      payload: { dslDocument: document },
    });
  }

  async function publish(id: string, changelog?: string, cookie = ownerCookie) {
    return app.inject({
      method: 'POST',
      url: `${API_PREFIX}/workflows/${id}/publish`,
      headers: as(cookie),
      payload: changelog ? { changelog } : {},
    });
  }

  describe('the round trip', () => {
    it('creates, edits, validates and publishes the OPD document', async () => {
      const { workflow } = await createWorkflow();

      const saved = await putDraft(workflow.id, opdDocument);
      expect(saved.statusCode).toBe(200);
      expect(saved.json().validation).toMatchObject({ valid: true, errors: [], warnings: [] });

      const validated = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/workflows/${workflow.id}/validate`,
        headers: as(ownerCookie),
        payload: { forPublish: true },
      });
      expect(validated.json()).toEqual({ valid: true, errors: [], warnings: [] });

      const published = await publish(workflow.id, 'first cut');
      expect(published.statusCode).toBe(200);
      const body = published.json();
      expect(body.version.semver).toBe('1.0.0');
      expect(body.version.publishedAt).not.toBeNull();
      expect(body.version.changelog).toBe('first cut');

      // The published version carries the compiled graph, ready for S04 to execute.
      const version = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflow-versions/${body.version.id}`,
        headers: as(ownerCookie),
      });
      expect(version.statusCode).toBe(200);
      expect(version.json().compiledGraph.startNodeId).toBe('info_welcome');
      expect(version.json().compiledGraph.nodes.q_allergy.transitions).toHaveLength(2);
    });

    it('bumps the version on a second publish and records why', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      await publish(workflow.id);

      const retitled = structuredClone(opdDocument) as any;
      retitled.nodes[3].prompt.en = 'Do you have a fever at the moment?';
      await putDraft(workflow.id, retitled);
      const second = await publish(workflow.id, 'reworded the fever question');
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ bump: 'patch' });
      expect(second.json().version.semver).toBe('1.0.1');

      const structural = structuredClone(opdDocument) as any;
      delete structural.fields.cough;
      structural.nodes = structural.nodes.filter((node: any) => node.id !== 'q_cough');
      structural.nodes.find((node: any) => node.id === 'q_fever').next = 'q_chest_pain';
      await putDraft(workflow.id, structural);
      const third = await publish(workflow.id, 'dropped the cough question');
      expect(third.json()).toMatchObject({ bump: 'major' });
      expect(third.json().version.semver).toBe('2.0.0');
    });

    it('keeps every published version and leaves exactly one open draft', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      await publish(workflow.id);
      await publish(workflow.id);

      const detail = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows/${workflow.id}`,
        headers: as(ownerCookie),
      });
      const versions = detail.json().workflow.versions as { publishedAt: string | null }[];
      expect(versions.filter((v) => v.publishedAt === null)).toHaveLength(1);
      expect(versions.filter((v) => v.publishedAt !== null)).toHaveLength(2);
      expect(detail.json().workflow.status).toBe('active');
    });

    it('lists the tenant’s workflows', async () => {
      await createWorkflow(ownerCookie, 'First');
      await createWorkflow(ownerCookie, 'Second');
      const listed = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows`,
        headers: as(ownerCookie),
      });
      expect(
        listed
          .json()
          .workflows.map((w: { name: string }) => w.name)
          .sort(),
      ).toEqual(['First', 'Second']);
    });

    it('starts a new workflow from a document that already validates', async () => {
      const { workflow } = await createWorkflow(ownerCookie, 'Blank Slate');
      const published = await publish(workflow.id);
      expect(published.statusCode).toBe(200);
    });
  });

  describe('immutability', () => {
    it('refuses to rewrite a published version, at the database level', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      const versionId = (await publish(workflow.id)).json().version.id as string;

      await expect(
        platformOps.prisma.workflowVersion.update({
          where: { id: versionId },
          data: { changelog: 'rewriting history' },
        }),
      ).rejects.toThrow(/immutable|frozen|published/i);
    });

    it('leaves the draft editable after a publish', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      await publish(workflow.id);
      const again = await putDraft(workflow.id, opdDocument);
      expect(again.statusCode).toBe(200);
    });
  });

  describe('validation gates publishing', () => {
    it('saves an invalid draft but refuses to publish it, listing every problem', async () => {
      const { workflow } = await createWorkflow();
      const broken = structuredClone(opdDocument) as any;
      broken.nodes[1].next = 'q_does_not_exist';
      broken.rules.redFlags[0].when = 'f.chest_pain == "yes"';

      const saved = await putDraft(workflow.id, broken);
      expect(saved.statusCode).toBe(200);
      expect(saved.json().validation.valid).toBe(false);

      const refused = await publish(workflow.id);
      expect(refused.statusCode).toBe(422);
      const problem = problemSchema.parse(refused.json());
      expect(problem.code).toBe('DSL_VALIDATION_FAILED');
      expect(problem.issues?.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['unknown-node-ref', 'expression-type']),
      );
      expect(problem.issues?.[0]?.path).toMatch(/^\//);
    });

    it('refuses to publish a document missing a declared translation', async () => {
      const { workflow } = await createWorkflow();
      const untranslated = structuredClone(opdDocument) as any;
      delete untranslated.nodes[1].prompt.hi;

      const saved = await putDraft(workflow.id, untranslated);
      // A draft may be half-translated; that is a warning, not an error.
      expect(saved.json().validation.valid).toBe(true);
      expect(saved.json().validation.warnings[0].code).toBe('language-coverage');

      const refused = await publish(workflow.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().issues[0].code).toBe('language-coverage');
    });

    it('refuses to publish patient-facing text that crosses the safety boundary', async () => {
      const { workflow } = await createWorkflow();
      const unsafe = structuredClone(opdDocument) as any;
      unsafe.rules.redFlags[0].patientMessage.en = 'You may have pneumonia — please wait.';

      await putDraft(workflow.id, unsafe);
      const refused = await publish(workflow.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().issues[0].code).toBe('denied-language');
    });

    it('validates a document passed inline without saving it', async () => {
      const { workflow } = await createWorkflow();
      const response = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/workflows/${workflow.id}/validate`,
        headers: as(ownerCookie),
        payload: { dslDocument: { dslVersion: '1.0' } },
      });
      expect(response.json().valid).toBe(false);

      // The stored draft is untouched — validate does not save.
      const detail = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows/${workflow.id}`,
        headers: as(ownerCookie),
      });
      expect(detail.json().draft.dslDocument.key).toBe('opd-general');
    });
  });

  describe('authorization and tenancy', () => {
    it('requires a session', async () => {
      const response = await app.inject({ method: 'GET', url: `${API_PREFIX}/workflows` });
      expect(response.statusCode).toBe(401);
      expect(problemSchema.parse(response.json()).code).toBe('AUTH_REQUIRED');
    });

    it('refuses a reviewer: authoring is an admin/owner act', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows`,
        headers: as(reviewerCookie),
      });
      expect(response.statusCode).toBe(403);
      expect(problemSchema.parse(response.json()).code).toBe('FORBIDDEN');
    });

    it('hides another tenant’s workflow, by id and in the list', async () => {
      const { workflow } = await createWorkflow();

      const byId = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows/${workflow.id}`,
        headers: as(otherTenantCookie),
      });
      expect(byId.statusCode).toBe(404);

      const listed = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflows`,
        headers: as(otherTenantCookie),
      });
      expect(listed.json().workflows).toEqual([]);
    });

    it('hides another tenant’s workflow version, which is not tenant-scoped by the client', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      const versionId = (await publish(workflow.id)).json().version.id as string;

      const response = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/workflow-versions/${versionId}`,
        headers: as(otherTenantCookie),
      });
      expect(response.statusCode).toBe(404);
    });

    it('refuses another tenant’s draft write', async () => {
      const { workflow } = await createWorkflow();
      const response = await putDraft(workflow.id, opdDocument, otherTenantCookie);
      expect(response.statusCode).toBe(404);
    });

    it('audits a publish', async () => {
      const { workflow } = await createWorkflow();
      await putDraft(workflow.id, opdDocument);
      await publish(workflow.id);

      const rows = await platformOps.prisma.auditEvent.findMany({
        where: { action: 'workflow.published' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.objectRef).toMatchObject({ workflowId: workflow.id, semver: '1.0.0' });
    });
  });

  describe('pack routes', () => {
    it.each([
      ['GET', '/packs'],
      ['GET', '/packs/opd-general/versions'],
    ])('%s %s answers 501 rather than pretending to be empty', async (method, path) => {
      const response = await app.inject({
        method: method as 'GET',
        url: `${API_PREFIX}${path}`,
        headers: as(ownerCookie),
      });
      expect(response.statusCode).toBe(501);
      expect(problemSchema.parse(response.json()).code).toBe('NOT_IMPLEMENTED');
    });

    it('POST /workflows/from-pack answers 501', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/workflows/from-pack`,
        headers: as(ownerCookie),
        payload: { packKey: 'opd-general' },
      });
      expect(response.statusCode).toBe(501);
    });
  });
});
