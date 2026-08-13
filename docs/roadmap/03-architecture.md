# 03 — System Architecture & ADRs

## 1. System overview

```
                        ┌──────────────────────────────────────────────┐
                        │                 nginx / CDN                  │
                        └───────┬──────────────┬───────────────┬───────┘
                                │              │               │
                     ┌──────────▼───┐   ┌──────▼──────┐  ┌─────▼─────────┐
                     │ Runner PWA   │   │ Console app │  │  REST + WS    │
                     │ (Vite/React) │   │ (Next.js)   │  │  API (Fastify)│
                     └──────────┬───┘   └──────┬──────┘  └─────┬─────────┘
                                │  HTTPS/WSS   │               │
                                └──────────────┴───────┬───────┘
                                                       │
      ┌────────────────────────────────────────────────▼─────────────────────────────┐
      │                              API service (Node/TS)                           │
      │  ┌────────────┐ ┌───────────────┐ ┌───────────┐ ┌──────────┐ ┌────────────┐  │
      │  │ Workflow   │ │ Session state │ │ Model     │ │ Evidence │ │ Auth/RBAC/ │  │
      │  │ engine     │ │ machine       │ │ router    │ │ & audit  │ │ tenancy    │  │
      │  └────────────┘ └───────────────┘ └───────────┘ └──────────┘ └────────────┘  │
      └───────┬───────────────┬──────────────────┬──────────────────┬────────────────┘
              │               │                  │                  │
       ┌──────▼─────┐  ┌──────▼──────┐   ┌───────▼────────┐  ┌──────▼──────┐
       │ Postgres   │  │ Redis       │   │ Provider       │  │ S3 (MinIO/  │
       │ (system of │  │ (queue,     │   │ adapters: STT/ │  │ AWS): audio,│
       │  record)   │  │  cache,     │   │ LLM/TTS/       │  │ docs, evid. │
       │            │  │  pubsub)    │   │ realtime       │  │ artifacts   │
       └────────────┘  └──────┬──────┘   └────────────────┘  └─────────────┘
                              │
                       ┌──────▼──────┐
                       │ Worker      │  async extraction, summaries, exports,
                       │ (BullMQ)    │  PDF, webhooks, TTS pre-render, eval runs
                       └─────────────┘
```

Later additions (milestone-tagged): telephony gateway (LiveKit SIP or Twilio) M7; WhatsApp adapter M8; local model host M8.

## 2. Architecture Decision Records (binding)

### ADR-001 — New monorepo, demo repo frozen
The platform is built in a **new repository `dhara-intake-os`** (pnpm workspaces + Turborepo). `v2v-vocalbridge-demo` remains a demo/reference; proven code (relay protocol, AudioWorklet capture/playback, audio unlock, Capacitor call UX, FCM sender) is **ported and rewritten in TS**, never imported. Rationale: the demo is vanilla-JS, single-file, in-memory state — the platform needs typed contracts, tests, and multi-tenancy from line 1.

### ADR-002 — Postgres is the system of record
Workflow definitions, versions, sessions, evidence events, audit, tenancy, users: **Postgres 16 + Prisma**. Versioned workflow definitions and analytics need relational integrity and JSONB. No Mongo in v1 (one fewer store to operate). Session payload snapshots and DSL documents live in JSONB columns with schema validation in code (Zod).

### ADR-003 — TypeScript everywhere, one language for v1
API, worker, runner, console all TypeScript. Python enters only later for local model serving / eval tooling (M8), as a separate service. Rationale: one toolchain, shared types package (`@dhara/contracts`) makes the API/DSL/event contracts compile-checked across every surface.

### ADR-004 — Fastify API + BullMQ worker, modular monolith
One deployable API service (Fastify, tRPC-free, plain REST + Zod validation + OpenAPI generation) and one worker process. **No microservices** in v1–v2. Modules are folders with enforced boundaries (`workflow/`, `session/`, `router/`, `evidence/`, `auth/`). Split-out only when a pilot proves a scaling need.

### ADR-005 — Two frontends: Runner (Vite+React PWA) and Console (Next.js)
- **Runner** must be tiny, offline-capable, kiosk-safe, and run on cheap Android phones — Vite + React + Workbox PWA, no SSR.
- **Console** (Workflow Studio + Review Console + Analytics + admin) — Next.js App Router, ideal for authenticated dashboards.
Both consume `@dhara/contracts`.

### ADR-006 — Session state machine is authoritative on the server
The runner is a dumb renderer of server-issued "step envelopes". All transition logic, validation, extraction, and red-flag evaluation happen server-side. Rationale: audit integrity, kiosk trustworthiness, thin clients on all future surfaces (phone/WhatsApp reuse the same engine). Offline camp mode (M8) runs a sandboxed copy of the interpreter with deferred authoritative replay on sync.

### ADR-007 — Workflow DSL is data (JSON), versioned and immutable once published
The DSL (doc 06) is a JSON document validated by Zod + custom graph checks. Publishing creates an immutable `WorkflowVersion` row; sessions pin `workflowVersionId`. No code-in-DSL (no eval); conditions use a small expression grammar evaluated by our interpreter.

### ADR-008 — Cascaded pipeline default; realtime speech-to-speech is a mode, not the architecture
Default voice path: pre-recorded/cached prompt audio → browser capture → streaming STT → LLM interpretation → confirmation UI. Native realtime (Gemini Live / OpenAI Realtime, both already proven in the demo relays) is used only in Mode 3, behind the same session state machine, with hard cost caps (terminate upstream first — demo-proven pattern).

### ADR-009 — Provider abstraction from day one of voice work
Uniform adapter interfaces for STT/LLM/TTS/Realtime (doc 08). No provider SDK type may leak beyond its adapter. Routing decisions (provider, model, mode) are recorded per step in the evidence graph.

### ADR-010 — Evidence graph as append-only event stream
Every session emits typed events (doc 05 §4) appended to `evidence_events` (never updated/deleted; corrections are new events). Final structured output is a **projection** of the stream plus explicit field commits. This is the audit trail, the provenance model, and the future training/eval dataset in one.

### ADR-011 — Multi-tenancy: single database, `tenant_id` on every row, enforced in a repository layer
Row-level tenancy with a mandatory tenant-scoped query layer (Prisma client extension that injects `tenant_id`). Per-tenant S3 prefixes. No cross-tenant queries outside platform-ops module. Dedicated-DB tenants only if an enterprise deal demands it (M9+).

### ADR-012 — AuthN: server-side sessions, cookie-based; no third-party auth SaaS
Email+password (argon2) + optional OTP later; server-side session table; HttpOnly cookies. Rationale: India data residency, clinics don't have Google Workspace, no vendor dependency. Kiosk/runner sessions use short-lived signed intake tokens (QR/link), not user accounts — the demo's join-link pairing pattern generalized.

### ADR-013 — Realtime transport: plain WebSocket relay v1, LiveKit when telephony arrives
The demo proved a WS relay (browser PCM16 ↔ server ↔ provider) works well and is fully controllable (cost caps, telemetry). Keep it for M2–M6. Adopt LiveKit (self-hosted or cloud) at M7 when SIP/telephony and multi-party (assisted mode observers) justify it. The relay protocol (`ready`/binary PCM/`turn`/`interrupted`/`usage`/`ended`/`summary`) is carried over from the demo and formalized in doc 07 §5.

### ADR-014 — Deployment: Docker Compose on the owned Linux box first, AWS ECS at pilot scale
Dev + first pilot run on the user's Linux server (`omen.radpretation.ai`, nginx + Cloudflare — already battle-tested with the demo). Everything is containerized from S01 so the ECS move (M6/M9) is a config change, not a rewrite. See doc 10.

### ADR-015 — Safety boundary enforced in three layers
(1) DSL cannot express diagnosis outputs — output schema fields are typed data, summaries come from templates + constrained generation; (2) all LLM prompts include the intake-only contract and generated text passes a deny-list/classifier filter before display; (3) eval harness includes scope-adherence tests that gate releases. Consent is a state-machine state — no consent, no questions, ever.

### ADR-016 — i18n as first-class data
Every user-facing string in workflows is `{lang → text}` maps with mandatory fallback language; prompt audio is addressed by `(workflowVersion, nodeId, lang, voice)` and content-hashed for caching. UI chrome uses standard message catalogs (en/hi/mr at launch).

### ADR-017 — Appointments are a thin access layer on the workflow engine, token-queue-first *(Doc-13 amendment)*
Booking = a workflow whose terminal `action` node performs an audited side-effect against the scheduling tables (doc 05 §7). Per-resource scheduling modes `token | slot | walkin`, with token as the Indian-OPD default. We are the lightweight appointment book for clinics that have none, and an adapter peer where an HMS exists. Hard non-goals: billing, payments, payer/insurance logic, staff rostering, calendar-optimization. Rationale + competitive frame: doc 13 §1–3.

### ADR-018 — Agentic tier = provider function-calling over our tool-bridge; no external agent runtime *(Doc-13 amendment)*
The T3 concierge is a Mode-3 realtime session whose tools are our own APIs (booking, queue, tenant KB retrieval, escalation), exposed via a tool-bridge in the relay; every tool invocation is an evidence event and every session sits under our budget caps (upstream-kill-first). We do **not** adopt Vertex AI Agent Engine/Agent Builder or any hosted agent runtime: its cost floor (~$500–2,000+/mo per production agent), residency questions, and lock-in would destroy the affordability gradient and duplicate our session engine. ADK/A2A are watched for interop, not built upon. Google (and any provider) participates as live models + function calling through the existing adapter layer — a tier option, never a dependency.

### ADR-019 — Tiers are configuration: router policy + feature flags + budgets *(Doc-13 amendment)*
T1/T2/T3 (doc 13 §5) map to per-tenant routing policies, flags, and budget caps. No code forks, no tier-specific builds; tiers may be mixed per workflow within one tenant. Upgrading a clinic is a policy flip.

## 3. Key flows

### 3.1 Hybrid intake step (Mode 2, the default)
1. Runner requests next step → API returns **step envelope** (node, text per lang, audio URL, allowed answer modes, UI schema).
2. Runner plays cached/pre-recorded audio (no TTS call for fixed prompts).
3. Patient speaks → streaming STT via WS (or taps → skip to 6).
4. API interprets transcript against the node's answer schema; cheap deterministic parse first, LLM extraction only if ambiguous. Confidence + ambiguity markers recorded.
5. Runner shows interpreted answer → patient confirms (touch/voice) or re-answers; after N failures node falls back to touch.
6. API validates, commits `field.committed` event, evaluates red-flag + transition rules, returns next step envelope.
7. On terminal node: output projection built, summary generated from template (+constrained LLM polish), session → `completed`, review queue notified.

### 3.2 Review flow
Queue → detail (fields + confidence + provenance + audio snippets) → corrections (events) → approve → export jobs (webhook/PDF/etc.) → `exported`. Red flags surface at the top and on the queue badge.

### 3.3 Conversational mode (M7)
Same state machine; the realtime agent receives the workflow as its instruction contract, but every field is committed only through the extraction+confirmation path; hard caps terminate upstream provider first, then graceful close (demo-proven).

## 4. Scaling path

M1–M6: one box (Compose: nginx, api, worker, postgres, redis, minio). M7–M9: AWS — RDS Postgres, ElastiCache, S3, ECS services (api ×N, worker ×N, relay ×N), CloudFront for runner assets, LiveKit for realtime. Stateless API (sessions in PG/Redis) makes horizontal scale trivial; WS relay nodes are sticky per session. Load target checkpoints in doc 10 §6.
