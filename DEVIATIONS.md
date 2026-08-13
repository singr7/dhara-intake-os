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
