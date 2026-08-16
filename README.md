# Dhara Intake OS

A configurable, multilingual, voice-and-touch **intake intelligence platform**: it turns messy
human conversations into validated, auditable, structured data — for healthcare OPD, field
surveys, and operational workflows. Patient-facing product name: **DharaIntake**.

The core product is not voice. It is **reliable intake completion + structured evidence +
human-verifiable output**. Voice is used only where it improves completion, accessibility, speed
or trust.

> Safety boundary (doc 09 §1, ADR-015): this system supports intake. It never diagnoses,
> prescribes, or advises on treatment.

## Getting started

```bash
corepack enable pnpm
pnpm install

cp .env.example .env
docker compose up --build -d          # applies migrations, then starts the stack
pnpm --filter @dhara/db db:seed       # demo tenant + staff users
```

Workspace gates, including the integration suites that need a real Postgres:

```bash
createdb dhara_test                   # or: docker compose exec postgres createdb -U dhara dhara_test
DATABASE_URL=postgresql://dhara:dhara_dev_password@localhost:5442/dhara_test \
  pnpm --filter @dhara/db exec prisma migrate deploy

TEST_DATABASE_URL=postgresql://dhara:dhara_dev_password@localhost:5442/dhara_test \
  pnpm turbo lint typecheck test build
```

Without `TEST_DATABASE_URL` the database-backed suites skip and the rest still run — CI always
sets it, so tenant isolation and the append-only guards are never merged unverified.

Signing in (seed credentials, development only):

```bash
curl -sc /tmp/dhara.jar -X POST http://localhost:8088/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"demo-clinic","email":"owner@demo-clinic.test","password":"dhara-dev-password"}'
curl -sb /tmp/dhara.jar http://localhost:8088/api/v1/auth/me
```

| Surface              | URL                                 |
| -------------------- | ----------------------------------- |
| Runner PWA (patient) | http://localhost:8088/              |
| Console (staff)      | http://localhost:8088/console/login |
| API health           | http://localhost:8088/api/v1/health |
| MinIO console        | http://localhost:9011               |

Host ports are configurable in `.env` and default off the usual numbers so the stack coexists
with other local projects.

## Layout

```
apps/api        Fastify REST + WS API (modular monolith, ADR-004)
apps/worker     BullMQ processors
apps/runner     Patient PWA — Vite + React + Workbox (ADR-005)
apps/console    Staff console — Next.js App Router (studio / review / analytics / admin)
packages/contracts  Zod schemas: env, API DTOs, events, DSL — the shared source of truth
packages/dsl        Workflow DSL parser, validator, interpreter (doc 06)
packages/providers  STT / LLM / TTS / realtime adapters (doc 08, ADR-009)
packages/db         Prisma schema + migrations + tenant-scoped client (ADR-010, ADR-011)
packs/          Versioned workflow packs
harness/        Intake evaluation harness (doc 12)
infra/          nginx, deploy scripts, load tests
docs/roadmap/   The build contract: vision, architecture + ADRs, data model, DSL, API, sessions
```

## Working in this repo

Development runs session by session against `docs/roadmap/sessions/`. Start with
[`HANDOFF.md`](HANDOFF.md) — it holds the protocol, the phase tracker, and the state of play.
