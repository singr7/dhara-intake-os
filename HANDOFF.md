# HANDOFF — Dhara Intake OS

The session-to-session log. **Every coding session reads this file first and updates it last.**

## How to work in this repo (binding)

1. Read, in order: [`docs/roadmap/sessions/README.md`](docs/roadmap/sessions/README.md) (the
   execution protocol), your session's entry in `docs/roadmap/sessions/M<n>.md`, that session's
   "Required reading" docs from `docs/roadmap/`, and this file.
2. Verify the session's preconditions. If one fails, fix it first and log it here — never skip
   silently.
3. Contracts in docs 05–08 are binding; implementation details are yours. Ambiguity → simplest
   option consistent with the ADRs, recorded here.
4. Run the session's acceptance checks. They are commands and observable behaviours, not vibes.
5. Close out: update this file (done / deviations / next), add to
   [`DEVIATIONS.md`](DEVIATIONS.md) if the plan changed, commit as `S<NN>: <summary>`, push.
6. Never: weaken the safety boundary (doc 09 §1 — intake support, never diagnosis), skip
   consent/evidence writes, leak provider SDK types past adapters, bypass the tenant-scoped DB
   client, or commit secrets.

Execution order includes the doc-13 amendment sessions: … S06 → **S06A** → S07 … S15 → **S15A**
→ S16 … S28 → **S28A** …, and M8 runs S30 → S31 → S29 → S32.

## Local quickstart

```bash
corepack enable pnpm
pnpm install

cp .env.example .env
docker compose up --build -d             # migrate service runs, then the stack starts
pnpm --filter @dhara/db db:seed          # demo tenant + staff users
curl http://localhost:8088/api/v1/health # {"status":"ok","db":true,"redis":true,"s3":true}
open http://localhost:8088/              # runner PWA
open http://localhost:8088/console/login # staff console
```

Workspace gates. The database-backed suites (tenant isolation, append-only, auth, event
sequences) need a real Postgres and skip without `TEST_DATABASE_URL`; CI always sets it.

```bash
docker compose exec postgres createdb -U dhara dhara_test
DATABASE_URL=postgresql://dhara:dhara_dev_password@localhost:5442/dhara_test \
  pnpm --filter @dhara/db exec prisma migrate deploy
TEST_DATABASE_URL=postgresql://dhara:dhara_dev_password@localhost:5442/dhara_test \
  pnpm turbo lint typecheck test build
```

Hot reload for the Node services: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`.
Host ports live in `.env` and are deliberately off the usual defaults (8088 / 3011 / 5442 / 6389
/ 9010) so the stack coexists with other projects on the same box.

## Phase tracker

| Session | Scope                                              | Status               |
| ------- | -------------------------------------------------- | -------------------- |
| S01     | Repo scaffold + infrastructure skeleton            | ✅ done (2026-08-13) |
| S02     | Data model, multi-tenancy, auth                    | ✅ done (2026-08-15) |
| S03     | Workflow DSL package (parser, validator, compiler) | ⬜ next              |
| S04     | Session engine + runner API                        | ⬜                   |
| S05     | Runner PWA: touch-first intake                     | ⬜                   |
| S06     | Console v0 + M1 demo                               | ⬜                   |
| S06A    | Appointments core _(doc-13)_                       | ⬜                   |
| S07     | Provider adapters                                  | ⬜                   |
| S08     | Prompt-audio pipeline                              | ⬜                   |
| S09     | Runner voice capture                               | ⬜                   |
| S10     | Interpretation ladder                              | ⬜                   |
| S11     | Language packs + M2 demo                           | ⬜                   |
| S12     | Review console                                     | ⬜                   |
| S13     | Summaries + provenance UI                          | ⬜                   |
| S14     | Exports (webhook/PDF)                              | ⬜                   |
| S15     | Analytics v0                                       | ⬜                   |
| S15A    | Notifications + stitch _(doc-13)_                  | ⬜                   |
| S16     | Cost metering + budgets                            | ⬜                   |
| S17     | Audit + retention                                  | ⬜                   |
| S18     | Observability + harness seed                       | ⬜                   |
| S19     | Pack framework + radiology pack                    | ⬜                   |
| S20     | OPD + camp packs                                   | ⬜                   |
| S21     | Visual studio + simulation                         | ⬜                   |
| S22     | RBAC + tenant admin                                | ⬜                   |
| S23     | Kiosk + assisted mode                              | ⬜                   |
| S24     | Load + failure hardening                           | ⬜                   |
| S25     | Pilot kit                                          | ⬜                   |
| S26     | Realtime relay (Mode 3)                            | ⬜                   |
| S27     | LiveKit + SIP calls                                | ⬜                   |
| S28     | Follow-up workflows                                | ⬜                   |
| S28A    | Concierge tier _(doc-13)_                          | ⬜                   |
| S30     | WhatsApp adapter                                   | ⬜                   |
| S31     | Harness full automation                            | ⬜                   |
| S29     | Offline camp mode                                  | ⬜                   |
| S32     | Local model slots                                  | ⬜                   |
| S33     | AWS migration                                      | ⬜                   |
| S34     | Integration adapters                               | ⬜                   |
| S35     | FHIR / ABDM sandbox                                | ⬜                   |
| S36     | BYOM + enterprise hardening                        | ⬜                   |

---

## S01 — Repo scaffold + infrastructure skeleton (2026-08-13)

### Done

- **Workspace:** pnpm 9 workspaces + Turborepo. `apps/{api,worker,runner,console}`,
  `packages/{contracts,dsl,providers,db}`, plus `packs/`, `harness/`, `infra/`, `docs/`.
  TypeScript 5 `strict` (+ `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) via
  `tsconfig.base.json`; ESLint 9 flat config, Prettier, Vitest in every package.
- **Roadmap copied** to `docs/roadmap/` — it is the build contract from here on. The demo repo
  (`v2v-vocalbridge-demo`) is frozen reference only (ADR-001).
- **`packages/contracts`:** Zod env loader (`parseServerEnv` / `loadServerEnv`) that throws
  `EnvValidationError` listing _every_ offending variable — verified: the API container exits at
  boot with a readable message when `DATABASE_URL` is absent. Also the RFC 7807 problem envelope
  with the full stable code list from doc 07 §7 (incl. the doc-13 codes) and the `/health` schema.
- **`packages/{dsl,providers,db}`:** package boundaries + smoke tests only. No STT/TTS/LLM code
  exists anywhere in the repo (M1 sequencing rule 1).
- **`apps/api`:** Fastify 5 with the Zod type provider, `genReqId` + `x-request-id` echo, pino
  with a redact list (auth headers, cookies, `password`, `patientRef`, answer `value`,
  `transcript`), RFC 7807 error handler + not-found handler, `GET /api/v1/health` returning
  `{db:false, redis:false, s3:false}` placeholders.
- **`apps/worker`:** BullMQ `heartbeat` queue + worker; self-ticks every 15 s so the
  redis round-trip is visible in `docker compose logs worker`.
- **`apps/runner`:** Vite + React 18 + Tailwind + Workbox (`vite-plugin-pwa`) DharaIntake splash
  with a health probe that degrades to a waiting state instead of erroring; PWA manifest + icons.
- **`apps/console`:** Next.js 15 App Router shell, `/login` placeholder (inert form — no fake
  auth before S02), `basePath: '/console'`.
- **Compose:** postgres:16, redis:7, minio (+ one-shot bucket bootstrap: audio/documents/
  exports), api, worker, runner (static via nginx), console, nginx edge with the WS
  `map $http_upgrade $connection_upgrade` block and gzip. `docker-compose.dev.yml` adds
  bind-mount hot reload for api/worker.
- **CI:** `.github/workflows/ci.yml` — a `verify` job (format check + one turbo invocation
  covering lint/typecheck/test/build, with the turbo cache restored between runs) and a
  `docker` job building all four images. Doc-only changes are skipped; the image matrix runs
  on main (not PRs) and only when build inputs actually changed.
- **Remote:** https://github.com/singr7/dhara-intake-os, `main` tracked. Repo is **public** —
  note that `docs/roadmap/` includes vision, pricing and competitive positioning.

### Acceptance evidence

| Check                                  | Result                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm turbo lint typecheck test build` | green (19 tasks)                                                                     |
| `curl :8088/api/v1/health`             | `200 {"status":"ok","version":"0.1.0","db":false,"redis":false,"s3":false}`          |
| Unknown route                          | `404 application/problem+json`, `code:"NOT_FOUND"`, `requestId` present              |
| Runner through nginx                   | shell served, `sw.js` 200, `manifest.webmanifest` 200 as `application/manifest+json` |
| Console through nginx                  | `/console` → 307 → `/console/login`, page renders                                    |
| Worker                                 | `heartbeat job processed` in logs                                                    |
| MinIO bootstrap                        | buckets `audio`, `documents`, `exports` created                                      |
| Missing env                            | API container exits at boot listing the missing variable                             |
| GitHub Actions                         | green on the first push to `main` (all jobs)                                         |

### Decisions worth knowing

- Health reports `false` for db/redis/s3 rather than optimistic `true`: real probes land in S02.
  Reporting a dependency as healthy before it is probed is the silent-degradation failure mode
  the demo taught us to avoid.
- `import/no-restricted-paths` is wired with runner/console → api zones as a placeholder; the
  real module-boundary and raw-Prisma zones get added in S02 when those modules exist.
- Runtime images currently carry dev dependencies (see DEVIATIONS D-004). Fine for a LAN box,
  worth trimming at M6.

### Deviations

D-001 `eslint.config.mjs`; D-002 console under `/console` basePath; D-003 placeholder PWA icons;
D-004 Dockerfiles copy the whole workspace. Details in [`DEVIATIONS.md`](DEVIATIONS.md).

### Next — S02 (data model, multi-tenancy, auth)

Read `docs/roadmap/sessions/M1.md` §S02 + docs 05 (all), 03 (ADR-002/011/012), 09 §4.
Starting points in this repo:

- `packages/db` is an empty boundary — Prisma schema, migrations, append-only guards and the
  tenant-scoped client extension all go there; `checkDatabase()` is a placeholder for the real
  probe.
- `apps/api/src/modules/health/index.ts` is where `/health` flips to real db/redis/s3 checks.
- `apps/api/src/plugins/` holds the plugin slots; `auth`, `tenancy-scope`, `db` land next to
  `error` and `request-id`.
- Extend `serverEnvSchema` in `packages/contracts/src/env.ts` for any new variable — nothing
  reads `process.env` directly.

Nothing from S01 is left open.

---

## S02 — Data model, multi-tenancy, auth (2026-08-15)

### Done

- **`packages/db` — the data layer.** Prisma 6 schema covering every doc 05 §2 table
  (tenants, users, sessions_auth, user_roles + platform_users, workflows,
  workflow_versions, intake_sessions, evidence_events, field_values, consent_records,
  media_objects, prompt_audio, cost_records, review_actions, export_targets,
  export_records, audit_events, budgets, provider_configs, routing_policies, packs,
  pack_versions), snake_case table names, two committed migrations.
- **Append-only, enforced in SQL.** `BEFORE UPDATE OR DELETE` triggers on `evidence_events`
  and `audit_events`; a frozen-row trigger on published `workflow_versions` (drafts stay
  editable, and the draft→published update itself is allowed). Chosen over revoking role
  privileges — see D-005 for the reasoning and the one narrow override the S17 retention
  worker will need. The Prisma extension in `append-only.ts` is a second layer that fails at
  the call site with a readable message.
- **Tenant-scoped client (ADR-011).** A Prisma extension injects `tenantId` into `where` for
  reads/updates/deletes and into `data` for writes, reading the tenant from
  AsyncLocalStorage. The scoped model list is derived from the DMMF (any model with a
  required `tenantId`), so new tables are protected the moment they are migrated. Querying
  without a context throws instead of returning every tenant's rows. The raw client is
  reachable only through `platformOps`, and ESLint now blocks `@prisma/client` imports
  outside `packages/db`.
- **Auth (ADR-012).** argon2id hashing (OWASP 19 MiB / t=2 / p=1); `POST /auth/login`,
  `POST /auth/logout`, `GET /auth/me`; server-side `sessions_auth` rows storing an HMAC of
  the cookie token keyed with `SESSION_SECRET`, so a database dump cannot be replayed;
  HttpOnly + SameSite=Lax cookie, Secure in production; per-IP rate limit on login.
  `registerUser()` is a service, not a route — staff accounts are provisioned, never
  self-served. `requireUser` / `requireRole(...)` guards are in `plugins/auth.ts`.
- **Evidence module.** `emitEvent()` validates against the full doc 05 §4 taxonomy (defined
  now in `contracts/events.ts`, including the doc-13 addendum) _and_ against the required
  payload keys per type, then appends inside a transaction that increments
  `intake_sessions.eventSeq`. The row lock that UPDATE takes is what serialises concurrent
  writers — no `MAX(seq)+1` race, no advisory lock — with `@@unique([sessionId, seq])` as
  the assertion.
- **Audit module.** `audit()` writes through `platformOps.guarded` (audit rows have a
  nullable tenant; platform-level actions have none) and never throws, so an audit failure
  cannot fail a request that already succeeded. Wired into login success, login failure and
  logout as the first consumers.
- **Seed.** Platform tenant + `ops@dhara.health` (platformOps role), "Demo Clinic" with owner
  and reviewer users, and the current month's budget row. Idempotent; refuses to run with
  `NODE_ENV=production`.
- **`/health` is real.** Actual round-trips to Postgres (`SELECT 1`), Redis (`PING`) and S3
  (`HeadBucket`), each with a 2 s timeout, and `status: degraded` when any fails.
- **Compose.** A one-shot `migrate` service runs `prisma migrate deploy`; api and worker wait
  for it to complete successfully. Migration-on-boot was rejected: with several API replicas
  it is a race, and a bad migration should stop a deploy rather than crash-loop a container.
- **CI.** The `verify` job now runs a `postgres:16-alpine` service, applies migrations, and
  exports `TEST_DATABASE_URL`, so the integration suites gate every PR.

### Acceptance evidence

| Check                                                 | Result                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm turbo lint typecheck test build`                | green (32 tasks)                                            |
| `@dhara/db` suite                                     | 16 passed                                                   |
| `@dhara/api` suite                                    | 28 passed                                                   |
| Tenant A reading tenant B by primary key              | returns `null` (test)                                       |
| Tenant A updating/deleting tenant B's row             | rejected / 0 rows affected (test)                           |
| Query with no tenant context                          | throws `MissingTenantContextError` (test)                   |
| `UPDATE`/`DELETE` on `evidence_events` via raw client | rejected by trigger, message names ADR-010 (test)           |
| `UPDATE`/`DELETE` on `audit_events` via raw client    | rejected by trigger (test)                                  |
| Published `workflow_versions` edit                    | rejected as immutable; drafts still editable (test)         |
| 20 concurrent `emitEvent` calls on one session        | seq `1..20`, no gaps, no duplicates (test)                  |
| Login → cookie → `/auth/me`                           | 200 with roles; HttpOnly + SameSite=Lax asserted (test)     |
| Cross-tenant credentials                              | 401, identical body to unknown-user (test)                  |
| Logout, expiry, forged cookie                         | all 401 afterwards (test)                                   |
| Login audit rows                                      | `auth.login.succeeded` + `auth.login.failed` written (test) |
| Login rate limit                                      | 429 `RATE_LIMITED` past the per-IP threshold (test)         |
| `prisma migrate reset` + `db:seed`                    | both migrations replay onto an empty db; triggers restored  |
| `pnpm db:seed`, run twice                             | clean and idempotent                                        |
| `docker compose up` → `curl :8088/api/v1/health`      | `{"status":"ok","db":true,"redis":true,"s3":true}`          |
| curl login → cookie → `/auth/me` through nginx        | 200 with roles; cookie flagged HttpOnly in the jar          |
| curl `/auth/me` with no cookie, and after logout      | `401 application/problem+json`, `AUTH_REQUIRED`             |
| curl login with the right password, wrong tenant      | 401 `Invalid credentials`                                   |
| `UPDATE`/`DELETE audit_events` from a superuser psql  | rejected by the trigger; rows intact                        |

### Decisions worth knowing

- **The tenant context had to await inside its own scope.** Prisma queries are lazy:
  `db.x.findMany()` builds a promise and only runs when something calls `.then`. The first
  version of `runWithTenant` returned `storage.run(ctx, fn)` directly, so a caller awaiting
  outside it executed the query after the scope had closed — which surfaced as "no tenant
  context" on ordinary-looking code. `runWithTenant` is now async and awaits inside the
  scope. Anything else that wraps ALS around a lazy API needs the same treatment.
- **Relation traversals are not re-filtered** (D-008). `AuthSession → User` is the only such
  path today and it is the intended one; any new relation from a non-scoped model into a
  scoped one must be reviewed against this.
- **Login is deliberately uninformative.** Unknown tenant, unknown user and wrong password
  return byte-identical bodies, and a missing user still pays the argon2 cost against a dummy
  hash so response time is not an enumeration oracle. A test asserts the equality.
- **The login throttle is in-process** (D-009), so it is per-replica. Redis store at S24.
- `platformOps` has two clients: `prisma` (fully raw) and `guarded` (append-only guards still
  applied). Prefer `guarded` for platform writes; `prisma` is for reads, migrations and the
  auth session lookup that must run before a tenant context exists.

### Deviations

D-005 triggers over role revocation; D-006 `evidence_events.type` as a string column;
D-007 scoping covers required-`tenantId` models only; D-008 relation traversals unfiltered;
D-009 in-process login rate limit. Details in [`DEVIATIONS.md`](DEVIATIONS.md).

### Next — S03 (workflow DSL package: parser, validator, compiler)

Read `docs/roadmap/sessions/M1.md` §S03 + doc 06 (all — S03 implements it exactly) and
doc 05 §2 (workflow tables). Starting points in this repo:

- `packages/dsl` is still a bare boundary — the expression grammar parser, `validate()`, the
  `compiledGraph` builder and the pure interpreter core all land there. No `eval`, ever
  (ADR-007).
- `packages/contracts` is where the DSL document schemas go, next to `events.ts` and
  `auth.ts`. Follow the pattern in `events.ts`: define the whole contract now, even the parts
  that fire later.
- `workflow_versions` already has `dslDocument` and `compiledGraph` JSONB columns, a
  `@@unique([workflowId, semver])`, and a trigger that freezes a row once `publishedAt` is
  set — so publish must write `publishedAt` in the same update as the final content, not
  after it.
- API workflow routes go in `apps/api/src/modules/workflow/`; guard them with
  `requireRole('admin', 'owner')` from `plugins/auth.ts`.
- Writing evidence from new code? Use `emitEvent()` — it is the only sanctioned write path,
  and it rejects any type or payload the doc 05 §4 taxonomy does not describe.

Left open from S02: nothing blocking. Two follow-ups are recorded as deviations rather than
tasks — the Redis rate-limit store (S24) and explicit filtering for the three dual-scope
tables when they are first written to (S07/S19). The console login page is still the inert
S01 placeholder; wiring it to these routes is S06's task, per the session plan.
