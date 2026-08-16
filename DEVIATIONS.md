# Deviations from the roadmap plan

Every entry: session, what the plan said, what was done instead, why, and what it costs later.
Contracts in docs 05–08 are binding — a deviation must preserve them (protocol §4).

## S01

### D-001 — `eslint.config.mjs` instead of `eslint.config.js`

- **Plan:** doc 04 §3 / S01 task 3 say "ESLint flat config".
- **Done:** the file is `eslint.config.mjs`, and each package lints with
  `eslint --config ../../eslint.config.mjs <dirs>`.
- **Why:** the root `package.json` is CommonJS (Next.js and several tools still expect that at
  the workspace root), so a `.js` flat config using `import` fails to load. The explicit
  `--config` path also makes lint work from any package directory regardless of ESLint's
  config lookup rules.
- **Cost:** none.

### D-002 — Console served under `/console` basePath

- **Plan:** doc 10 §2 describes nginx fronting runner + console; it does not fix the URL layout.
- **Done:** Next.js `basePath: '/console'`; nginx serves the runner at `/` and the console at
  `/console` on a single port (8080 locally).
- **Why:** one LAN URL for a clinic box; patients get the bare host, staff get `/console`.
  Doc 10's staging model (separate vhost per app) still works — basePath is a config flip.
- **Cost:** any absolute console link must include `/console`; noted for S06.

### D-003 — Placeholder PWA icons

- **Plan:** S01 task 7 — PWA manifest.
- **Done:** `apps/runner/public/icon.svg` plus programmatically generated solid-colour
  `icon-192.png` / `icon-512.png`.
- **Why:** no brand assets exist yet; installability needs real PNG icons.
- **Cost:** replace with designed icons during S05 mobile polish.

### D-004 — Docker images copy the whole workspace

- **Plan:** none (implementation detail).
- **Done:** each app Dockerfile does `COPY . .` (filtered by `.dockerignore`), then
  `pnpm --filter @dhara/<app>... run build`.
- **Why:** `pnpm install --frozen-lockfile` fails when workspace projects referenced by the
  lockfile are absent from the build context.
- **Cost:** slightly larger build context and non-minimal runtime images for api/worker.
  Revisit with `pnpm deploy --prod` when image size matters (M6 pilot hardening).

## S02

### D-005 — Append-only enforced by triggers, not by revoking role privileges

- **Plan:** S02 task 2 offers a choice: "DB-level (revoke UPDATE/DELETE from app role) or
  Prisma-extension guard".
- **Done:** `BEFORE UPDATE OR DELETE` triggers on `evidence_events` and `audit_events`, plus a
  frozen-row trigger on published `workflow_versions`. The Prisma extension is kept as a
  second layer that fails at the call site with a readable message.
- **Why:** a revoke binds one role. The moment a migration, a psql session, or a future
  service connects as anyone else, the guarantee is silently gone — and a permission error
  does not explain itself. A trigger is attached to the table and holds for every connection,
  superuser included.
- **Cost:** the retention worker (S17) must redact transcript payloads in place (doc 05 §6),
  which the trigger forbids. A single narrow escape hatch exists for it:
  `SET LOCAL dhara.append_only_override = 'on'` inside its own transaction. No other code may
  emit that statement; enforce in review.

### D-006 — `evidence_events.type` is a string column, not a Prisma enum

- **Plan:** doc 05 §4 defines a fixed taxonomy.
- **Done:** `type String`, validated on every write against `evidenceEventTypes` in
  `@dhara/contracts`.
- **Why:** the taxonomy values contain dots (`session.created`), which Postgres/Prisma enum
  identifiers cannot hold. Renaming them to fit the database would have made the wire
  contract and the storage disagree.
- **Cost:** integrity is enforced in the application rather than the column type. Mitigated by
  `emitEvent` being the only write path and by tests over the full taxonomy.

### D-007 — Tenant scoping covers models with a _required_ `tenantId` only

- **Plan:** ADR-011 — "all queries auto-filtered by `tenant_id`".
- **Done:** the scoped set is derived from the Prisma DMMF: a model is filtered exactly when it
  has a non-nullable `tenantId`. `prompt_audio`, `provider_configs` and `routing_policies` hold
  platform-shared rows alongside tenant rows (nullable `tenantId`) and are excluded; `packs` /
  `pack_versions` are platform-global with no tenant column.
- **Why:** a blanket filter on the dual-scope tables would hide the platform-shared rows from
  every tenant, which is what those tables exist to provide. Deriving the set from the schema
  rather than a hand-kept list means new tables inherit protection automatically.
- **Cost:** queries against the three dual-scope tables must filter explicitly
  (`tenantId: { in: [current, null] }`). Revisit at S07/S19 when they are first written to.

### D-008 — Relation `include`/`select` traversals are not re-filtered

- **Plan:** none (implementation detail of ADR-011).
- **Done:** the extension filters top-level operations. Rows reached through a relation
  (`authSession.findUnique({ select: { user: … } })`) are not filtered again.
- **Why:** Prisma runs a nested read as part of one query, so extension hooks do not see it.
  In practice the relation _is_ the boundary — reaching a row requires already holding a row
  legitimately linked to it — and the alternative (banning `include` entirely) would push
  callers toward raw queries, which are worse.
- **Cost:** a relation from a non-scoped model into a scoped one could cross tenants. Today the
  only such path is `AuthSession → User`, which is the intended one. Any new relation from a
  non-scoped model must be reviewed against this.

### D-009 — Login rate limiting is per API process

- **Plan:** doc 09 §4 — "rate limiting: per-IP on auth".
- **Done:** `@fastify/rate-limit` with its default in-memory store.
- **Why:** one API container until M6; a Redis store is configuration, not redesign.
- **Cost:** with several API replicas the effective limit multiplies by replica count. Switch
  to the Redis store at S24 (load + failure hardening), where the multi-replica setup lands.

### D-010 — React types pinned per app in tsconfig `paths`

- **Plan:** none (S01 scaffolding; surfaced during S02 CI).
- **Done:** `apps/console/tsconfig.json` and `apps/runner/tsconfig.json` map `react` /
  `react-dom` to their own `node_modules/@types` copies. `*.tsbuildinfo` is now gitignored.
- **Why:** the workspace holds two React majors on purpose — the runner is React 18, the
  console React 19 — and pnpm hoists exactly one `@types/react` into the shared virtual
  store. Packages that resolve React types by plain node resolution (next's `.d.ts` files
  do) land on whichever copy got hoisted, and that choice is not stable across machines: S02
  typechecked clean locally and failed on CI with `ReactNode is not assignable to
React.ReactNode`. A committed `tsconfig.tsbuildinfo` then masked the failure on re-runs.
  Verified by pointing the local hoist at 18.x and confirming the error appears without the
  pin and disappears with it.
- **Cost:** none while the split exists. If the runner moves to React 19 (a candidate during
  S05), the split disappears and these entries can go.
