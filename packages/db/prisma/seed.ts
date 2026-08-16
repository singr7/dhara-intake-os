/**
 * Development seed (doc 05, S02).
 *
 * Creates the smallest world the rest of the build needs: a platform operator, one demo
 * clinic, its owner and reviewer, and an empty budget row for the current month. Idempotent
 * — running it twice leaves the same rows, so `db:reset` and a re-seed on a half-populated
 * database behave the same way.
 *
 * Passwords come from the environment when set; the defaults are development-only and the
 * script refuses to run against NODE_ENV=production.
 */
import argon2 from 'argon2';
import { PrismaClient, TenantRole, PlatformRole } from '@prisma/client';

const prisma = new PrismaClient();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DEMO_TENANT_SLUG = 'demo-clinic';

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

async function upsertUser(params: {
  tenantId: string;
  email: string;
  name: string;
  password: string;
  roles: TenantRole[];
  platformRoles?: PlatformRole[];
}): Promise<string> {
  const passwordHash = await argon2.hash(params.password, ARGON2_OPTIONS);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: params.tenantId, email: params.email } },
    update: { name: params.name, passwordHash },
    create: {
      tenantId: params.tenantId,
      email: params.email,
      name: params.name,
      passwordHash,
    },
    select: { id: true },
  });

  for (const role of params.roles) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role } },
      update: {},
      create: { userId: user.id, role },
    });
  }
  for (const role of params.platformRoles ?? []) {
    await prisma.platformUser.upsert({
      where: { userId_role: { userId: user.id, role } },
      update: {},
      create: { userId: user.id, role },
    });
  }

  return user.id;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const password = process.env.SEED_PASSWORD ?? 'dhara-dev-password';

  // The platform tenant is where staff accounts live. It is a real tenant row so that the
  // tenant-scoped client applies to platform staff too — there is no unscoped user.
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: {},
    create: {
      slug: 'platform',
      name: 'Dhara Platform',
      settings: { defaultLanguages: ['en'] },
    },
    select: { id: true },
  });

  await upsertUser({
    tenantId: platformTenant.id,
    email: 'ops@dhara.health',
    name: 'Platform Ops',
    password,
    roles: [TenantRole.owner],
    platformRoles: [PlatformRole.platformOps],
  });

  const demo = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: {},
    create: {
      slug: DEMO_TENANT_SLUG,
      name: 'Demo Clinic',
      settings: {
        branding: { displayName: 'Demo Clinic' },
        defaultLanguages: ['en', 'hi'],
        // Three clocks, doc 05 §6. Audio is the shortest by design.
        retention: { audioDays: 30, transcriptDays: 180, structuredDays: 1095 },
      },
    },
    select: { id: true },
  });

  await upsertUser({
    tenantId: demo.id,
    email: 'owner@demo-clinic.test',
    name: 'Demo Owner',
    password,
    roles: [TenantRole.owner, TenantRole.admin],
  });

  await upsertUser({
    tenantId: demo.id,
    email: 'reviewer@demo-clinic.test',
    name: 'Demo Reviewer',
    password,
    roles: [TenantRole.reviewer],
  });

  await prisma.budget.upsert({
    where: { tenantId_period: { tenantId: demo.id, period: currentPeriod() } },
    update: {},
    create: { tenantId: demo.id, period: currentPeriod(), capPaise: 0, softAlertPct: 80 },
  });

  console.log(
    [
      'Seed complete:',
      `  platform ops   ops@dhara.health          (tenant "platform")`,
      `  demo owner     owner@demo-clinic.test    (tenant "${DEMO_TENANT_SLUG}")`,
      `  demo reviewer  reviewer@demo-clinic.test (tenant "${DEMO_TENANT_SLUG}")`,
      process.env.SEED_PASSWORD
        ? '  password from SEED_PASSWORD'
        : `  password "${password}" — development only`,
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
