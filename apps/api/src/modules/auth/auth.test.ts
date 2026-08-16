import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AUTH_COOKIE_NAME, authUserSchema, problemSchema } from '@dhara/contracts';
import { db, platformOps, runWithTenant } from '@dhara/db';
import { createTestTenant, hasTestDatabase, resetTestDatabase } from '@dhara/db/testing';
import { API_PREFIX, buildServer } from '../../server.js';
import { cookieAttributes, cookieValue, testEnv } from '../../test-support.js';
import { registerUser } from './service.js';

/**
 * The auth flow end-to-end through the HTTP surface (ADR-012, doc 09 §4): login sets a
 * session cookie, `/auth/me` reads it back, logout revokes it, and one tenant's credentials
 * are useless against another's.
 */

const env = testEnv();
const PASSWORD = 'correct-horse-battery-staple';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(env);
});

afterAll(async () => {
  await app.close();
});

describe.runIf(hasTestDatabase)('auth', () => {
  let alphaId: string;
  let betaId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    alphaId = (await createTestTenant('alpha-clinic', 'Alpha Clinic')).id;
    betaId = (await createTestTenant('beta-clinic', 'Beta Clinic')).id;

    await registerUser({
      tenantId: alphaId,
      email: 'nurse@alpha.test',
      password: PASSWORD,
      name: 'Alpha Nurse',
      roles: ['reviewer'],
    });
    await registerUser({
      tenantId: betaId,
      email: 'admin@beta.test',
      password: PASSWORD,
      name: 'Beta Admin',
      roles: ['owner', 'admin'],
    });
  });

  // The login throttle counts per IP against one shared server instance, so tests that are
  // not about throttling each speak from their own address. (Finding worth keeping in mind:
  // the counter is in-process, so it is per-replica in production — see HANDOFF.)
  let clientCounter = 0;

  async function login(tenantSlug: string, email: string, password = PASSWORD) {
    clientCounter += 1;
    return app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { tenantSlug, email, password },
      remoteAddress: `10.0.0.${clientCounter % 250}`,
    });
  }

  it('logs in and returns the user with their roles', async () => {
    const response = await login('alpha-clinic', 'nurse@alpha.test');

    expect(response.statusCode).toBe(200);
    const { user } = response.json();
    expect(authUserSchema.parse(user)).toMatchObject({
      email: 'nurse@alpha.test',
      tenantSlug: 'alpha-clinic',
      roles: ['reviewer'],
      platformRoles: [],
    });
  });

  it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const response = await login('alpha-clinic', 'nurse@alpha.test');
    const attributes = cookieAttributes(response.headers['set-cookie'], AUTH_COOKIE_NAME);

    expect(cookieValue(response.headers['set-cookie'], AUTH_COOKIE_NAME)).toBeTruthy();
    expect(attributes).toContain('httponly');
    expect(attributes).toContain('samesite=lax');
    expect(attributes).toContain('path=/');
  });

  it('stores only a hash of the session token, never the token itself', async () => {
    const response = await login('alpha-clinic', 'nurse@alpha.test');
    const token = cookieValue(response.headers['set-cookie'], AUTH_COOKIE_NAME);

    const rows = await platformOps.prisma.authSession.findMany({ select: { tokenHash: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a wrong password without saying which part was wrong', async () => {
    const response = await login('alpha-clinic', 'nurse@alpha.test', 'wrong');

    expect(response.statusCode).toBe(401);
    const problem = problemSchema.parse(response.json());
    expect(problem.code).toBe('AUTH_REQUIRED');
    expect(problem.detail).toBe('Invalid credentials');
  });

  it('gives an unknown user and an unknown tenant the identical answer', async () => {
    const unknownUser = await login('alpha-clinic', 'nobody@alpha.test');
    const unknownTenant = await login('no-such-clinic', 'nurse@alpha.test');

    expect(unknownUser.statusCode).toBe(401);
    expect(unknownTenant.statusCode).toBe(401);
    expect(unknownUser.json()).toEqual({ ...unknownTenant.json(), requestId: expect.any(String) });
  });

  it('refuses a valid password against the wrong tenant', async () => {
    // The same email and password combination that works for beta must not work when
    // presented against alpha's slug — the tenant is part of the credential (ADR-011).
    const response = await login('alpha-clinic', 'admin@beta.test');
    expect(response.statusCode).toBe(401);
  });

  it('refuses login to a suspended tenant', async () => {
    await platformOps.prisma.tenant.update({
      where: { id: alphaId },
      data: { status: 'suspended' },
    });

    const response = await login('alpha-clinic', 'nurse@alpha.test');
    expect(response.statusCode).toBe(403);
    expect(problemSchema.parse(response.json()).code).toBe('TENANT_SUSPENDED');
  });

  it('returns the current user from /auth/me with the cookie', async () => {
    const token = cookieValue(
      (await login('alpha-clinic', 'nurse@alpha.test')).headers['set-cookie'],
      AUTH_COOKIE_NAME,
    );

    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      cookies: { [AUTH_COOKIE_NAME]: token as string },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe('nurse@alpha.test');
  });

  it('answers /auth/me with 401 when there is no cookie', async () => {
    const response = await app.inject({ method: 'GET', url: `${API_PREFIX}/auth/me` });

    expect(response.statusCode).toBe(401);
    expect(problemSchema.parse(response.json()).code).toBe('AUTH_REQUIRED');
  });

  it('rejects a forged cookie value', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      cookies: { [AUTH_COOKIE_NAME]: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const token = cookieValue(
      (await login('alpha-clinic', 'nurse@alpha.test')).headers['set-cookie'],
      AUTH_COOKIE_NAME,
    ) as string;

    const logout = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/logout`,
      cookies: { [AUTH_COOKIE_NAME]: token },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      cookies: { [AUTH_COOKIE_NAME]: token },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const token = cookieValue(
      (await login('alpha-clinic', 'nurse@alpha.test')).headers['set-cookie'],
      AUTH_COOKIE_NAME,
    ) as string;

    await platformOps.prisma.authSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/auth/me`,
      cookies: { [AUTH_COOKIE_NAME]: token },
    });
    expect(response.statusCode).toBe(401);
  });

  it('binds the request to the caller’s tenant, so a handler cannot see another’s data', async () => {
    await runWithTenant({ tenantId: alphaId }, () =>
      db.workflow.create({ data: { tenantId: alphaId, name: 'alpha workflow' } }),
    );
    await runWithTenant({ tenantId: betaId }, () =>
      db.workflow.create({ data: { tenantId: betaId, name: 'beta workflow' } }),
    );

    const token = cookieValue(
      (await login('alpha-clinic', 'nurse@alpha.test')).headers['set-cookie'],
      AUTH_COOKIE_NAME,
    ) as string;

    // A probe route stands in for the S03 workflow routes: what matters here is that the
    // tenant context established by the auth plugin reaches an ordinary handler, with no
    // tenant filter written anywhere in that handler.
    const probeApp = await buildServer(env);
    probeApp.get(`${API_PREFIX}/__probe/workflows`, async () => ({
      names: (await db.workflow.findMany({ select: { name: true } })).map((w) => w.name),
    }));

    const response = await probeApp.inject({
      method: 'GET',
      url: `${API_PREFIX}/__probe/workflows`,
      cookies: { [AUTH_COOKIE_NAME]: token },
    });
    await probeApp.close();

    expect(response.json().names).toEqual(['alpha workflow']);
  });

  it('audits both successful and failed logins (doc 09 §4)', async () => {
    await login('alpha-clinic', 'nurse@alpha.test');
    await login('alpha-clinic', 'nurse@alpha.test', 'wrong');

    const actions = await platformOps.prisma.auditEvent.findMany({
      orderBy: { createdAt: 'asc' },
      select: { action: true, tenantId: true },
    });

    expect(actions.map((a) => a.action)).toEqual(['auth.login.succeeded', 'auth.login.failed']);
    // A failed login has no authenticated tenant to attribute the row to.
    expect(actions[0]?.tenantId).toBe(alphaId);
    expect(actions[1]?.tenantId).toBeNull();
  });

  it('rate-limits repeated login attempts from one IP (doc 09 §4)', async () => {
    // A fresh instance so the counter is not already warm from earlier tests.
    const limited = await buildServer(env);
    let last = await limited.inject({ method: 'POST', url: `${API_PREFIX}/auth/login` });
    for (let i = 0; i <= env.LOGIN_RATE_LIMIT_PER_MINUTE; i += 1) {
      last = await limited.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/login`,
        payload: { tenantSlug: 'alpha-clinic', email: 'nurse@alpha.test', password: 'wrong' },
      });
    }
    await limited.close();

    expect(last.statusCode).toBe(429);
    expect(problemSchema.parse(last.json()).code).toBe('RATE_LIMITED');
  });
});
