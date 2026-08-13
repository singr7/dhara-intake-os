# 10 — Deployment Plan

## 1. Environments

| Env | Where | Purpose |
|---|---|---|
| `dev` | developer machine, `docker compose up` | full stack incl. MinIO/PG/Redis; seed data + demo tenant |
| `staging` | omen.radpretation.ai (owned Linux box), separate compose project + subdomain | pre-pilot testing, harness runs |
| `pilot/prod` | omen box initially (ADR-014) → AWS at M9 | real tenants |

The omen box + nginx + Cloudflare topology is already battle-tested by the demo (WS upgrade map, TLS, systemd). Reuse `infra/nginx/` configs; key demo lessons encoded: env must be loaded explicitly (we crash at boot on missing env, never silently degrade), `/api/health` exposes provider-key presence, `map $http_upgrade $connection_upgrade` required for WS.

## 2. Containers & topology (compose)

`nginx` (TLS termination if not Cloudflare; static runner assets; proxy) · `api` · `worker` · `postgres:16` (volume + nightly `pg_dump` to S3) · `redis:7` · `minio` (until AWS S3). One compose file, per-env `.env`. Images built in CI, tagged by git SHA, pulled on deploy (`infra/deploy.sh`: pull → migrate (`prisma migrate deploy`) → restart api/worker → smoke check `/health`). Rollback = previous tag + `migrate resolve` policy (all migrations must be backward-compatible one release back — expand/contract pattern).

## 3. CI/CD (GitHub Actions)

- **PR/main:** lint, typecheck, unit (Vitest), `prisma validate`, DSL deny-list lint, build all apps, docker build.
- **Nightly:** Playwright e2e against ephemeral compose stack; harness smoke suite (doc 12) against staging.
- **Deploy:** manual dispatch → build+push images → SSH deploy script to omen (staging auto on main, prod manual). At M9: same pipeline targets ECS via Terraform in `infra/terraform/`.

## 4. Monitoring & ops

- `/health` (liveness: db, redis, s3, provider keys booleans) + `/metrics` (Prometheus: request latency, WS session counts, queue depth, provider latency/error rates, cost counters).
- Grafana + Loki on the box (M4 session); alerts: API 5xx rate, queue backlog, provider error spike, budget threshold, disk, cert expiry.
- Structured pino logs, PII-redacted; request IDs propagated to worker jobs.
- Incident runbook + backup-restore drill documented in `infra/RUNBOOK.md` (M6).

## 5. AWS migration (M9 trigger: >2 paying tenants or >50 concurrent sessions sustained)

RDS Postgres (Multi-AZ, ap-south-1) · ElastiCache Redis · S3 (ap-south-1) · ECS Fargate services: api ×2+, worker ×2+, relay (sticky by session via ALB) · CloudFront for runner assets · Secrets Manager · CloudWatch+Grafana. LiveKit (self-hosted on EC2 or LiveKit Cloud India region check) lands with M7 telephony regardless of where the core runs.

## 6. Load checkpoints

| Milestone | Target | Test |
|---|---|---|
| M6 (pilot-ready) | 50 concurrent PWA hybrid sessions, p95 step < 2 s | k6 script in `infra/load/` against staging |
| M7 | +10 concurrent realtime voice sessions | relay-focused k6 + audio soak |
| M9 | 500 concurrent platform-wide | ECS scale test |

## 7. Data operations

Nightly `pg_dump` + WAL archiving (M9: RDS snapshots) · S3 lifecycle rules aligned with retention clocks · retention/purge worker runs daily with dry-run report mode · staging gets anonymized seed data only, never pilot PII.
