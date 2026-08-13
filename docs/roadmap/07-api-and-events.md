# 07 — API Surface, Realtime Protocol & Webhooks

All DTOs are Zod schemas in `packages/contracts`; OpenAPI is generated from them. Base path `/api/v1`. AuthN: console routes need a session cookie; runner routes need an **intake token** (short-lived signed token minted per session, carried as `Authorization: Bearer`).

## 1. Console/API — resource routes

### Auth & tenancy
```
POST /auth/login | POST /auth/logout | GET /auth/me
GET/PATCH /tenant/settings          (owner/admin)
GET/POST/PATCH /tenant/users        (owner/admin; role assignment)
```

### Workflows (Studio)
```
GET  /workflows                      list w/ status+versions
POST /workflows                      create draft
GET  /workflows/:id                  detail + versions
PUT  /workflows/:id/draft            replace draft DSL document
POST /workflows/:id/validate         → {errors, warnings}   (does not save)
POST /workflows/:id/publish          → creates immutable WorkflowVersion {semver, changelog}
GET  /workflow-versions/:id          frozen DSL + compiledGraph
POST /workflows/from-pack            {packKey, packVersion} → new draft
GET  /packs | GET /packs/:key/versions
```

### Intake sessions (staff-side)
```
POST /sessions                       {workflowVersionId, mode, surface, language?, patientRef?}
                                     → {sessionId, intakeToken, joinUrl, qrSvgUrl}
GET  /sessions?state=&flag=&q=       review queue (filter: needs_review, red_flag, low_confidence)
GET  /sessions/:id                   full detail: fields+provenance+events+summary+costs
GET  /sessions/:id/events            evidence stream (paged)
GET  /sessions/:id/media/:mediaId    signed S3 URL (audit-logged access)
POST /sessions/:id/review            {action: approve|return|escalate}
POST /sessions/:id/corrections       {fieldKey, value, note?}
POST /sessions/:id/export            {targetId} (manual trigger; auto on approve per policy)
DELETE /sessions/:id                 DPDP purge (owner/admin; audited)
```

### Analytics / admin
```
GET /analytics/overview?from&to      completion, duration, drop-off per node, cost/intake
GET /analytics/quality               correction rate per field, red-flag freq, language stats
GET /analytics/costs                 by kind/provider/day; budget status
GET/POST /export-targets             webhook/pdf/sheets/whatsapp configs
GET/POST /provider-configs, /routing-policies, /budgets   (admin; platform scope for ops)
GET /health                          db/redis/s3/providers booleans (demo lesson: health must
                                     expose provider-key presence — silent no-key cost a day)
```

## 2. Runner API (intake-token auth)

```
GET  /run/session                    state, language opts, consent doc, progress
POST /run/consent                    {granted, method, language}
GET  /run/step                       current step envelope (see §3)
POST /run/answer                     {nodeId, kind: touch|voiceRef|upload, value?|mediaId?}
                                     → {interpretation? {value, display, confidence}, commit?, nextStep?}
POST /run/confirm                    {nodeId, confirmed: bool}
POST /run/assist                     request human help
POST /run/abandon
POST /run/media                      multipart upload (answer audio, documents) → {mediaId}
```

## 3. Step envelope (server → runner; ADR-006)

```jsonc
{ "sessionState": "in_progress", "progress": {"done": 4, "total": 11},
  "node": { "id": "q_duration", "type": "question",
    "prompt": {"text": "कितने दिनों से?", "audioUrl": "https://.../p/abc.opus", "lang": "hi"},
    "answer": {"type": "duration"},
    "modes": ["voice", "touch"],
    "touchUi": {"kind": "numberPad", "unitOptions": ["days","weeks"]},   // renderer schema
    "confirm": "lowConfidence",
    "voice": {"maxUtteranceSec": 12, "sttWsUrl": "wss://.../ws/stt?token=..."} } }
```

The runner renders exactly what the envelope says; it holds no workflow logic.

## 4. WebSockets

`/ws/run?token=` — step-stream channel: server pushes `step`, `interpretation`, `state`, `redflag_ack`; client sends heartbeats. (HTTP endpoints above remain the fallback for flaky networks.)

`/ws/stt?token=&nodeId=` — uplink binary PCM16 16 kHz 100 ms frames; downlink JSON `{type:"partial"|"final", transcript, confidence, langDetected}`. Relay terminates provider stream on `final`, silence timeout, or `maxUtteranceSec`.

## 5. Realtime voice relay protocol (Mode 3, M7) — carried over from demo

Browser ↔ `/ws/live?token=&provider=` speaks the demo-proven protocol, formalized:

| Direction | Message | Meaning |
|---|---|---|
| S→C | `{type:"ready"}` | upstream session established (only after provider setupComplete) |
| C→S | binary PCM16 16 kHz | mic frames |
| S→C | binary PCM16 24 kHz | agent audio |
| S→C | `{type:"turn", speaker, text}` | aggregated transcription |
| S→C | `{type:"interrupted"}` | flush playback (barge-in) |
| S→C | `{type:"usage", ...}` | token/cost telemetry |
| S→C | `{type:"field_commit", fieldKey, value, confidence}` | extraction checkpoint |
| S→C | `{type:"ended", reason: "cap"|"complete"}` | server-initiated end; **upstream socket terminated first** (cost-cap pattern) |
| S→C | `{type:"summary", data}` | post-call structured output |

## 6. Webhooks (export target kind `webhook`)

POST to customer URL with body = structured output contract (doc 05 §5). Headers: `X-Dhara-Event: intake.reviewed`, `X-Dhara-Signature: sha256=HMAC(secret, body)`, `X-Dhara-Delivery: <uuid>`. Retries: 5 attempts, exponential backoff, then `export_records.status=failed` + console alert. Events emitted: `intake.completed`, `intake.reviewed`, `intake.red_flag`, `intake.deleted`.

## 7. Errors

RFC 7807 `application/problem+json`: `{type, title, status, code, detail, requestId}`. Stable codes include `AUTH_REQUIRED, FORBIDDEN, TENANT_SUSPENDED, TOKEN_EXPIRED, CONSENT_REQUIRED, INVALID_TRANSITION, DSL_VALIDATION_FAILED, BUDGET_EXCEEDED, PROVIDER_UNAVAILABLE, RETENTION_PURGED`, and *(Doc-13)* `SLOT_TAKEN, RESOURCE_CLOSED, OPTED_OUT`. `PROVIDER_UNAVAILABLE` on voice endpoints must instruct the runner to degrade to touch mode, never dead-end the patient.

## 8. Appointments & Access routes *(Doc-13 amendment; S06A/S15A/S28A)*

### Staff/console
```
GET/POST/PATCH /resources  ·  /resources/:id/schedule (templates + exceptions)
GET  /queue?date&resourceId          queue board projection (token, status, intake chip, red-flag)
POST /appointments                   staff/assisted booking {resourceId, date, patientRef, priorityClass?}
PATCH /appointments/:id              status transitions (arrived|in_service|done|no_show|cancelled)
POST /appointments/:id/checkin       QR/token check-in → links/spawns intake session → {intakeJoinUrl}
GET  /appointments?date&resourceId&status
GET/POST /notification-templates  ·  GET /notifications?appointmentId  ·  POST /optouts
GET/POST /campaigns  ·  POST /campaigns/:id/run
GET/POST/PATCH /kb/articles          tenant knowledge base (T3)
```

### Public booking (rate-limited, OTP-gated; also consumed by the booking workflow's `action` nodes)
```
GET  /book/availability?tenant&resourceId&date   → token/slot availability
POST /book/otp  ·  POST /book/verify             phone verification
POST /book/appointments                          create (idempotency-key required)
POST /book/appointments/:id/reschedule|cancel    (signed link from reminder messages)
```

### Tool-bridge (T3 concierge; internal contract between relay and API — ADR-018)
Tools exposed to the realtime model via function calling, each mapping 1:1 to an authenticated internal endpoint and emitting `tool.invoked`:
`find_availability, book_appointment, reschedule_appointment, cancel_appointment, get_appointment_status, kb_search, escalate_to_human`. Contract file `packages/contracts/tools.ts` is the single registry; the relay refuses any tool name not in it. Booking tools require the session to have completed phone verification; all tool failures return structured errors the agent must read back for confirmation, never guess past.
