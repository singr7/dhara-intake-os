# 09 — Security, Compliance & Safety Boundary

## 1. The safety boundary (non-negotiable, ADR-015)

DharaIntake is **intake support, never diagnosis**. This appears in UX copy, prompts, API contracts, summaries, and sales material.

- Safe: "Collects and structures patient-provided information for review by healthcare staff."
- Forbidden: naming/suggesting conditions, treatment or medication advice, triage instructions to the patient, "AI diagnoses patients."

Enforcement layers: (1) DSL output schemas are typed data — there is no place to put diagnosis text; (2) every LLM call is JSON-schema-constrained extraction or template-bound summary; all patient-visible generated text passes a deny-list + (later) classifier filter; (3) CI deny-list lint on prompt/summary templates; (4) harness scope-adherence suite gates releases; (5) department suggestion is always `requiresHumanConfirmation: true`.

Red flags escalate **to staff**, never to patient-facing advice ("A staff member will assist you shortly" is the ceiling).

## 2. Consent (state-machine enforced)

No consent → no questions (doc 05 §3). ConsentRecord stores purpose version, language, method (touch/voice/operator), timestamp, and shown text. Voice consent stores the audio. Telemedicine Practice Guidelines context: consent is necessary for tele-interactions and explicit when initiated by a health worker/RMP/caregiver — assisted and telephony modes therefore capture *who initiated* in `session.created`. Consent text is versioned; changing it is a workflow patch release. Decline routes to human intake gracefully.

## 3. DPDP Act 2023 + DPDP Rules 2025 posture

| Obligation | Implementation |
|---|---|
| Lawful, purpose-limited processing | Consent purpose versioning; fields collected only if a node needs them (DSL is the data-minimization instrument) |
| Notice | Consent screen in patient's language |
| Data minimization | No identity beyond `patientRef` needed by the clinic; PII typed fields flagged `piiLevel` |
| Retention limits | Three-clock retention (audio/transcript/structured) + hard-delete worker (doc 05 §6) |
| Data principal rights | Per-session export (structured contract) and purge (`DELETE /sessions/:id`), both audited |
| Security safeguards | §4 below |
| Children | Pediatric workflows require guardian consent variant (pack-level flag, M9) |
| Breach readiness | Audit trail + access logs make scope determination possible; incident runbook in `infra/` (M6) |

Data residency: all storage (PG, S3, backups) in India regions when on AWS; the interim on-prem box is inherently local. Cloud AI providers: send only the minimum utterance/transcript needed per step (never the whole record); note provider data-use terms per adapter in `provider_configs`.

## 4. Security controls

- **Transport:** TLS everywhere (Cloudflare/nginx already proven); HSTS; WSS only.
- **At rest:** disk encryption on box; RDS/S3 encryption on AWS; argon2id passwords; provider keys in env/secrets manager, never in DB plaintext (`credentialsRef` indirection), never committed (demo `.env` discipline continues).
- **AuthZ:** RBAC roles owner/admin/reviewer/operator/viewer; route guards + tenant-scoped DB client (ADR-011). Runner uses single-session intake tokens: short TTL, scope = one session, rotated on state change.
- **Kiosk safety:** session wipe on completion/timeout; no PII persisted in runner storage beyond active session; no back-navigation into a previous patient.
- **Audit:** append-only `audit_events` for logins, session views, media access (each signed-URL issuance logged), exports, deletions, config/key changes. Evidence events cover the intake itself.
- **Redaction:** transcripts redacted (hash-preserving) after transcript-retention expiry; logs must never contain transcripts or PII (pino redact paths, tested).
- **Rate limiting:** per-IP on auth, per-token on runner endpoints; upload size/mime caps; AV scan hook on documents (M6).
- **Backups:** nightly PG dumps + S3 versioning; restore drill at M6 (doc 10).
- **Dependency hygiene:** lockfile, `pnpm audit` in CI, Renovate.

## 5. Review requirement

Healthcare packs ship with `review.reviewRequired: true` — output is exported only after human approval. This is both a safety and a **product** stance: the sellable unit is a *completed reviewed intake*.
