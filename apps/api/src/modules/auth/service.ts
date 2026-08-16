import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import {
  db,
  platformOps,
  runWithTenant,
  TenantStatus,
  UserStatus,
  type PlatformRole,
  type TenantRole,
} from '@dhara/db';
import type { AuthUser, TenantRole as TenantRoleName } from '@dhara/contracts';

/**
 * Authentication service (ADR-012, doc 09 §4).
 *
 * Server-side sessions: the cookie carries an opaque random token, the database stores only
 * an HMAC of it keyed with SESSION_SECRET. A dump of `sessions_auth` therefore cannot be
 * replayed as a login, and the cookie value never appears in a log or a backup.
 */

/**
 * OWASP's argon2id baseline: 19 MiB, 2 iterations, 1 lane. Tuned for a clinic box that is
 * also running Postgres and a worker — login is not a hot path, but it must not stall the
 * event loop for other patients mid-intake either.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Verifying a real hash on a miss keeps login timing flat whether or not the email exists.
 * Without it, response time is a user-enumeration oracle. Generated once at module load.
 */
const DUMMY_HASH_PROMISE = argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

function tokenHashOf(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export interface RegisterInput {
  tenantId: string;
  email: string;
  password: string;
  name: string;
  roles: TenantRoleName[];
  platformRoles?: PlatformRole[];
}

/**
 * Creates a user. Seed-and-admin path only — there is no public registration route, because
 * a clinic's staff list is provisioned, never self-served (doc 02 §3.1).
 */
export async function registerUser(input: RegisterInput): Promise<{ id: string }> {
  const passwordHash = await hashPassword(input.password);
  return runWithTenant({ tenantId: input.tenantId }, async () => {
    const user = await db.user.create({
      data: {
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash,
        roles: { create: input.roles.map((role) => ({ role: role as TenantRole })) },
        ...(input.platformRoles?.length
          ? { platformRoles: { create: input.platformRoles.map((role) => ({ role })) } }
          : {}),
      },
      select: { id: true },
    });
    return user;
  });
}

export type LoginFailure = 'invalid_credentials' | 'tenant_suspended';

export interface LoginSuccess {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

export interface LoginContext {
  tenantSlug: string;
  email: string;
  password: string;
  secret: string;
  ttlHours: number;
  ip?: string;
  userAgent?: string;
}

/**
 * Verifies credentials and mints a session. Returns a failure reason rather than throwing:
 * the caller decides what the client is told, and callers must not leak which of the three
 * possible causes (no tenant, no user, wrong password) actually applied.
 */
export async function login(input: LoginContext): Promise<LoginSuccess | LoginFailure> {
  const tenant = await db.tenant.findUnique({
    where: { slug: input.tenantSlug.toLowerCase() },
    select: { id: true, slug: true, status: true },
  });

  if (!tenant) {
    // Still pay the hashing cost so a bad slug is indistinguishable from a bad password.
    await argon2.verify(await DUMMY_HASH_PROMISE, input.password).catch(() => false);
    return 'invalid_credentials';
  }
  if (tenant.status === TenantStatus.suspended) {
    return 'tenant_suspended';
  }

  const user = await runWithTenant({ tenantId: tenant.id }, () =>
    db.user.findFirst({
      where: { email: input.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        passwordHash: true,
        tenantId: true,
        roles: { select: { role: true } },
        platformRoles: { select: { role: true } },
      },
    }),
  );

  const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const passwordOk = await argon2.verify(hash, input.password).catch(() => false);

  if (!user || !passwordOk || user.status !== UserStatus.active) {
    return 'invalid_credentials';
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlHours * 60 * 60 * 1000);

  await platformOps.prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: tokenHashOf(token, input.secret),
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    },
  });

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      tenantSlug: tenant.slug,
      roles: user.roles.map((r) => r.role as TenantRoleName),
      platformRoles: user.platformRoles.map((r) => r.role),
    },
  };
}

/**
 * Resolves a cookie token to its user.
 *
 * Runs through `platformOps` by necessity: this is what *establishes* the tenant context,
 * so it cannot itself be tenant-scoped (ADR-011, the sanctioned exception).
 */
export async function resolveSession(token: string, secret: string): Promise<AuthUser | null> {
  const tokenHash = tokenHashOf(token, secret);

  const session = await platformOps.prisma.authSession.findUnique({
    where: { tokenHash },
    select: {
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          tenantId: true,
          roles: { select: { role: true } },
          platformRoles: { select: { role: true } },
          tenant: { select: { slug: true, status: true } },
        },
      },
    },
  });

  if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) return null;
  const { user } = session;
  if (user.status !== UserStatus.active || user.tenant.status === TenantStatus.suspended) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tenantId: user.tenantId,
    tenantSlug: user.tenant.slug,
    roles: user.roles.map((r) => r.role as TenantRoleName),
    platformRoles: user.platformRoles.map((r) => r.role),
  };
}

/** Revokes one session. Idempotent — logging out twice is not an error. */
export async function revokeSession(token: string, secret: string): Promise<void> {
  await platformOps.prisma.authSession.updateMany({
    where: { tokenHash: tokenHashOf(token, secret), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Constant-time string comparison for any future token equality checks. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
