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
pnpm turbo lint typecheck test build     # workspace gates

cp .env.example .env
docker compose up --build -d             # full stack
curl http://localhost:8088/api/v1/health # {"status":"ok",...}
open http://localhost:8088/              # runner PWA
open http://localhost:8088/console/login # staff console
```

Hot reload for the Node services: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`.
Host ports live in `.env` and are deliberately off the usual defaults (8088 / 3011 / 5442 / 6389
/ 9010) so the stack coexists with other projects on the same box.

## Phase tracker

| Session | Scope                                              | Status               |
| ------- | -------------------------------------------------- | -------------------- |
| S01     | Repo scaffold + infrastructure skeleton            | ✅ done (2026-08-13) |
| S02     | Data model, multi-tenancy, auth                    | ⬜ next              |
| S03     | Workflow DSL package (parser, validator, compiler) | ⬜                   |
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
