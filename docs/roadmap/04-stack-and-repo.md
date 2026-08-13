# 04 — Platform Stack, Repo Layout & Conventions

Binding for all sessions. Deviations require a `DEVIATIONS.md` entry (README protocol §4).

## 1. Stack (v1)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x everywhere (ADR-003) | `strict: true`; Node 22 LTS |
| Monorepo | pnpm workspaces + Turborepo | `apps/*`, `packages/*` |
| API | Fastify 5 + Zod + `fastify-type-provider-zod`; OpenAPI generated from Zod schemas | REST + WS (`@fastify/websocket`) |
| ORM / DB | Prisma + Postgres 16 | JSONB for DSL docs, session snapshots |
| Queue / cache | Redis 7 + BullMQ | jobs: extraction, summaries, exports, TTS pre-render, webhooks, eval runs |
| Object storage | S3 API — MinIO locally/on-box, AWS S3 later | buckets: `audio`, `documents`, `exports`; per-tenant prefixes |
| Runner frontend | Vite + React 18 + Workbox PWA, Tailwind | no SSR; must run on cheap Android Chrome |
| Console frontend | Next.js 15 App Router + Tailwind + shadcn/ui | Studio, Review, Analytics, Admin |
| Auth | Custom: argon2 passwords, server-side session table, HttpOnly cookies (ADR-012); signed short-lived intake tokens for runner sessions | no auth SaaS |
| Validation/contracts | Zod schemas in `packages/contracts`, shared by API + both frontends | single source of truth |
| Realtime voice | WS relay (ported from demo `live-relay.js`/`openai-relay.js`, rewritten TS) | LiveKit at M7 |
| STT (cloud, v1) | Adapter slots: Google STT v2 (hi/mr strong), Deepgram or OpenAI `gpt-realtime-whisper` for en | pick per language via router config; verify current pricing/models at build time |
| LLM (v1) | Adapter slots: Gemini Flash (interpretation/extraction), OpenAI mini-class fallback | JSON-schema-constrained outputs only |
| TTS (v1) | Adapter slots: Google TTS (hi/mr voices), cached to S3 by content hash; human-recorded prompt audio preferred | doc 08 |
| PDF | `@react-pdf/renderer` or headless Chromium in worker | choose in S14, record decision |
| Telemetry | pino logs → Loki (or file+logrotate on box); OpenTelemetry traces optional; Prometheus metrics endpoint | Grafana dashboards M4 |
| Tests | Vitest (unit), Playwright (e2e), harness runner (doc 12) | CI-gated |
| CI | GitHub Actions: lint, typecheck, unit, build, prisma validate; e2e nightly | doc 10 |

## 2. Repo layout (`dhara-intake-os`)

```
dhara-intake-os/
├── HANDOFF.md                  # session-to-session log (S01 creates; every session updates)
├── DEVIATIONS.md               # plan deviations log
├── docker-compose.yml          # postgres, redis, minio, api, worker, runner, console, nginx
├── turbo.json  pnpm-workspace.yaml  .github/workflows/
├── apps/
│   ├── api/                    # Fastify service
│   │   └── src/
│   │       ├── modules/        # auth/ tenancy/ workflow/ session/ router/ evidence/
│   │       │                   # review/ export/ analytics/ admin/
│   │       ├── plugins/        # db, redis, s3, auth, tenancy-scope, error, openapi
│   │       ├── ws/             # intake step WS + voice relay WS
│   │       └── index.ts
│   ├── worker/                 # BullMQ processors (same module imports as api)
│   ├── runner/                 # patient PWA (Vite)
│   └── console/                # Next.js studio/review/analytics/admin
├── packages/
│   ├── contracts/              # Zod schemas: DSL, API DTOs, events, step envelopes
│   ├── dsl/                    # DSL parser, validator, graph checks, interpreter
│   ├── providers/              # STT/LLM/TTS/Realtime adapter interfaces + implementations
│   ├── db/                     # prisma schema + client + tenant-scoped extension
│   └── ui/                     # shared UI tokens (optional, add when duplication hurts)
├── packs/                      # workflow packs as versioned JSON + prompt-audio manifests
│   ├── radiology-intake/  opd-general/  camp-survey/
├── harness/                    # eval harness cases + runner (doc 12)
└── infra/                      # nginx conf, systemd, deploy scripts, ECS terraform (M9)
```

## 3. Conventions

- **Module boundaries:** `apps/api/src/modules/*` may import from `packages/*` and their own module; cross-module imports only via each module's `index.ts` public surface. Enforce with ESLint `import/no-restricted-paths`.
- **Tenancy:** every Prisma query goes through the tenant-scoped client from `packages/db`. Raw `prisma.` usage outside `platform-ops` and migrations is a review-blocking error (ESLint rule + code review).
- **IDs:** `cuid2` strings. Table names snake_case, TS camelCase.
- **Events:** evidence/audit events are typed in `contracts/events.ts`; emitting an untyped event must not compile.
- **Errors:** API errors are RFC 7807 problem+json with stable `code` strings (doc 07 §7).
- **Env:** `.env` files gitignored; `packages/contracts/env.ts` Zod-validates process.env at boot; missing key = crash at start, never at call time (demo lesson: silent no-key fallback cost a debugging day).
- **Commits:** `S<NN>: <summary>` prefix per session; conventional-commit style body.
- **Feature flags:** simple per-tenant flags table read through config service; no external flag SaaS.
- **No diagnosis strings:** lint-level deny-list check on prompt templates and summary templates (`diagnos*`, `you have`, `treatment`, `prescri*` etc.) as a CI guard (ADR-015).
- **Definition of done (every session):** typecheck+lint+unit green; acceptance checks in the session file pass; `HANDOFF.md` updated; committed.
