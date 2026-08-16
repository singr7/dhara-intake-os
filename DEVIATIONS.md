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

## S03

### D-011 — `NOT_IMPLEMENTED` added to the stable problem-code list

- **Plan:** doc 07 §7 fixes the stable `code` list; S03 task 6 says the from-pack and packs
  routes "may 501 until M5".
- **Done:** added `NOT_IMPLEMENTED` (501) to `problemCodes` in `packages/contracts`, and the
  three pack routes throw it.
- **Why:** the routes exist in the doc 07 surface and clients will discover them, so they
  have to answer something. Answering `200 {packs: []}` is worse than a 501: an empty
  catalogue and an unbuilt feature are indistinguishable to the caller, which is the same
  silent-degradation failure the health endpoint was designed to avoid in S01. Every other
  option reuses a code that means something else.
- **Cost:** one more code in the enum. The routes stop throwing it at S19.

### D-012 — Problem envelope carries an optional `issues[]` extension member

- **Plan:** doc 07 §7 defines the envelope as `{type, title, status, code, detail, requestId}`.
- **Done:** added an optional `issues: [{code, message, path}]` member, populated only by
  `DSL_VALIDATION_FAILED`.
- **Why:** a failed publish is genuinely a _list_ of problems, and an author fixing a
  workflow needs all of them in one pass — fixing one error per round trip through a 200-node
  document is not a workable authoring loop. RFC 7807 §3.2 explicitly permits extension
  members, so this stays inside the standard rather than beside it. The alternative — a
  200 response carrying a failure — would make publish indistinguishable from success to
  every generic client.
- **Cost:** clients that validate the envelope strictly must tolerate the extra member; the
  Zod schema in contracts marks it optional so nothing is required to read it.

### D-013 — Deny-list rules are scoped to questions or statements

- **Plan:** S03 task 3 seeds a flat deny-list (`diagnos*`, `prescri*`, `treatment`,
  `"you have"`, disease-name placeholder).
- **Done:** each rule carries `scopes: ('question' | 'statement')[]`. `diagnos*`, `prescri*`,
  `treatment`, advice and dosage patterns apply everywhere; `"you have"`-style phrasing and
  the disease-name list apply only to strings that _tell_ the patient something (info and end
  prompts, red-flag `patientMessage`, validation messages, consent text) — not to questions,
  help text or answer option labels.
- **Why:** a flat list makes the OPD workflow — the actual product — unpublishable. "Do you
  have diabetes?" is history-taking: the patient asserts it about themselves, and an intake
  form that cannot ask it is useless. "You have diabetes" is a diagnosis. The words are
  identical and only the direction differs, so the direction is what the rule keys on. A
  deny-list that blocks correct authoring gets suppressed or deleted within a month, which
  costs more safety than it buys.
- **Cost:** a patient-facing _question_ could in principle name a condition suggestively
  ("Do you think you have TB?"). The clinical pack review at M5 owns the disease-name list
  and can promote rules back to global scope with one edit per rule.

### D-014 — Cycles are rejected outright, with no clarification exception yet

- **Plan:** doc 06 §7 — "no cycles except via explicit `clarification`".
- **Done:** `validate()` rejects every cycle in the node graph.
- **Why:** there is no `clarification` node type in doc 06 §2 — clarification is a _runtime_
  rung of the extraction ladder (doc 06 §3), bounded by `settings.clarificationMaxAttempts`,
  and it re-asks the same node rather than routing back to an earlier one. A cycle in the
  authored graph is therefore always an error today. Allowing one would also break the
  field-before-use dataflow analysis, which needs a topological order.
- **Cost:** if a future node type does need a back edge, the check needs an exception list
  and the dataflow pass needs a fixpoint iteration instead of a single topological sweep.
