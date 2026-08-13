# 05 — Data Model, Evidence Graph & Output Contracts

Authoritative for Prisma schema design (S02) and all later migrations. Field lists are the required minimum; sessions may add columns but never repurpose or drop these.

## 1. Entity overview

```
Tenant ─┬─ User ── UserRole
        ├─ Workflow ── WorkflowVersion ──┬─ IntakeSession ──┬─ EvidenceEvent (append-only)
        ├─ LanguagePack / PromptAudio    │                  ├─ FieldValue (projection)
        ├─ ReviewPolicy                  │                  ├─ ConsentRecord
        ├─ ExportTarget                  │                  ├─ MediaObject (audio/doc → S3)
        ├─ Budget / UsageRecord          │                  ├─ CostRecord
        └─ AuditEvent                    │                  └─ ExportRecord
Pack ── PackVersion (platform-global, instantiated into tenant Workflows)
ProviderConfig / RoutingPolicy (platform + tenant scope)
```

## 2. Core tables (minimum fields)

### tenants
`id, name, slug, status(active|suspended), settings jsonb (branding, defaultLanguages[], retention: {audioDays, transcriptDays, structuredDays}), createdAt`

### users / sessions_auth / user_roles
`users: id, tenantId, email unique-per-tenant, passwordHash(argon2), name, status, createdAt`
`sessions_auth: id, userId, tokenHash, expiresAt, ip, userAgent`
`user_roles: userId, role enum(owner|admin|reviewer|operator|viewer)` — platform staff have `platformRole` on a separate table.

### workflows / workflow_versions
`workflows: id, tenantId, name, description, packRef nullable ({packId, packVersion}), status(draft|active|archived)`
`workflow_versions: id, workflowId, semver, dslDocument jsonb (doc 06), compiledGraph jsonb (validator output), publishedAt, publishedBy, changelog text` — **immutable once publishedAt set** (DB trigger or app-layer guard).

### intake_sessions
`id, tenantId, workflowVersionId, mode(touch|hybrid|conversational|assisted), surface(pwa|kiosk|phone|whatsapp|assisted), language, state (§3), currentNodeId, snapshot jsonb (answers so far, retry counters), patientRef jsonb (external MRN/token — we hold minimal identity), operatorUserId nullable, startedAt, completedAt, reviewedAt, exportedAt, abandonReason nullable, intakeTokenHash (runner access), costTotalPaise int, redFlagCount int`

### evidence_events (append-only — ADR-010)
`id, sessionId, tenantId, seq (monotonic per session), type (§4), payload jsonb, actor jsonb ({kind: system|patient|operator|provider, id?}), createdAt` — no UPDATE/DELETE ever; enforce via DB permissions.

### field_values (projection, rebuildable from events)
`id, sessionId, fieldKey, value jsonb, valueType, confidence float, provenance jsonb ({eventIds[], transcript?, audioObjectId?, method: touch|voice|assisted|inferred}), confirmedByPatient bool, correctedBy nullable userId, status(committed|corrected|reviewOverridden)`

### consent_records
`id, sessionId, purposeVersion, language, method(touch|voice|operator), granted bool, textShown, audioObjectId nullable, createdAt`

### media_objects
`id, tenantId, sessionId nullable, kind(promptAudio|responseAudio|document|export), s3Key, mime, bytes, sha256, retentionClass(audio|document|export), createdAt, deletedAt nullable (soft, then hard-delete job)`

### prompt_audio (cache index)
`id, workflowVersionId nullable (null = shared), nodeId, lang, voice, source(recorded|tts), contentHash, mediaObjectId` — key insight: prompt audio addressed by `(nodeId, lang, voice, contentHash)` so TTS is rendered once, ever (ADR-016).

### cost_records
`id, tenantId, sessionId, stepSeq nullable, provider, model, kind(stt|llm|tts|realtime|telephony), units jsonb (tokens/seconds/chars), costPaise int, latencyMs, createdAt`

### review + export
`review_actions: id, sessionId, userId, action(approve|correct|return|escalate), fieldKey nullable, before/after jsonb, note, createdAt`
`export_targets: id, tenantId, kind(webhook|pdf|sheets|whatsapp|emr), config jsonb, secretRef, active`
`export_records: id, sessionId, targetId, status(pending|sent|failed), attempt, responseMeta jsonb, payloadHash, createdAt`

### audit_events (platform audit — distinct from evidence)
`id, tenantId, userId nullable, action (login, view_session, export, delete, config_change, key_change...), objectRef jsonb, ip, createdAt` — append-only.

### budgets / provider config
`budgets: tenantId, period(month), capPaise, softAlertPct, hardStop bool`
`provider_configs: id, scope(platform|tenant), kind, provider, model, credentialsRef, langs[], priority, active`
`routing_policies: id, scope, rules jsonb (doc 08 §4)`

### packs
`packs: id, key, name, domain, description` · `pack_versions: id, packId, semver, dslDocument jsonb, promptManifest jsonb, changelog, publishedAt`

## 3. Session state machine (authoritative — ADR-006)

States: `created → consent_pending → in_progress ⇄ clarification_needed → completed → reviewed → exported`, plus `human_assistance_needed` (from in_progress; resumable), `failed`, `abandoned`.

Legal transitions only via the session module; every transition emits `session.state_changed`. **No question may be asked in any state except `in_progress`/`clarification_needed`, and those are reachable only through `consent_pending` with a granted ConsentRecord** (ADR-015).

## 4. Evidence event taxonomy (the Intake Evidence Graph)

Event `type` values and required payload keys:

| type | payload (min) |
|---|---|
| `session.created` | mode, surface, workflowVersionId, initiator |
| `consent.requested` / `consent.granted` / `consent.declined` | purposeVersion, language, method |
| `session.state_changed` | from, to, reason |
| `node.entered` | nodeId, promptAudioId?, lang |
| `prompt.played` | nodeId, promptAudioId, source(recorded|ttsCache|ttsLive) |
| `answer.audio_captured` | nodeId, mediaObjectId, durationMs |
| `answer.transcribed` | nodeId, provider, model, transcript, confidence, langDetected |
| `answer.touch` | nodeId, value |
| `answer.interpreted` | nodeId, method(deterministic|llm), value, confidence, ambiguityMarkers[], promptVersion?, model? |
| `answer.confirmation_shown` / `answer.confirmed` / `answer.rejected` | nodeId, method |
| `clarification.asked` | nodeId, question, attempt |
| `fallback.triggered` | nodeId, from(voice), to(touch), reason |
| `field.committed` | fieldKey, value, confidence, sourceEventIds[] |
| `redflag.raised` | ruleId, fieldKeys[], severity, escalation |
| `assistance.requested` / `assistance.provided` | nodeId, operatorId? |
| `review.correction` | fieldKey, before, after, userId, note? |
| `review.approved` / `review.returned` / `review.escalated` | userId |
| `summary.generated` | templateId, model?, promptVersion?, outputHash |
| `export.sent` / `export.failed` | targetId, payloadHash |
| `cost.recorded` | ref to cost_records id |
| `session.completed` / `session.abandoned` / `session.failed` | reason? |

This stream **is** the audit trail, the provenance source (every FieldValue lists its `sourceEventIds`), and the eval/training dataset (nurse corrections = labels).

## 5. Structured output contract (all four modes emit this)

```jsonc
{
  "session": { "id": "...", "workflow": "opd-general", "workflowVersion": "1.3.0",
               "mode": "hybrid", "language": "hi", "startedAt": "...", "completedAt": "...",
               "consent": { "granted": true, "purposeVersion": "2026-07-01", "method": "touch" } },
  "fields": {
    "chief_complaint": { "value": "cough", "valueType": "choice",
      "confidence": 0.92, "confirmedByPatient": true, "reviewedBy": null,
      "provenance": { "method": "voice", "transcript": "paanch din se khaansi hai",
                      "audioRef": "media:abc", "eventIds": ["e41","e42"] } },
    "duration_days": { "value": 5, "valueType": "number", "confidence": 0.95,
      "confirmedByPatient": true, "provenance": { "method": "voice", "eventIds": ["e42"] } }
  },
  "redFlags": [ { "ruleId": "fever_high", "severity": "medium", "fields": ["fever"], "raisedAt": "..." } ],
  "routing": { "suggestedDepartment": "General Medicine", "basis": ["cough","fever"],
               "requiresHumanConfirmation": true, "confirmedBy": null },
  "summary": { "text": "…", "templateId": "opd-doctor-summary@2", "editedByReviewer": false },
  "review": { "status": "reviewed", "correctionCount": 1, "reviewedBy": "user:...", "reviewedAt": "..." },
  "costs": { "totalPaise": 312, "byKind": { "stt": 120, "llm": 92, "tts": 0, "realtime": 0 } },
  "meta": { "durationSec": 214, "fallbacks": 1, "clarifications": 2 }
}
```

Rules: structured `fields` are primary, `summary` secondary; every field carries provenance; `routing` is always `requiresHumanConfirmation: true` in healthcare packs; no field may contain diagnosis/treatment text (schema-typed values prevent it).

## 6. Retention model

Three clocks per tenant (settings): **audio** (shortest, e.g. 30d), **transcripts** (e.g. 180d), **structured data** (e.g. 3y or per contract). Worker job hard-deletes expired MediaObjects and redacts transcript payloads in evidence events (replaces with `{redacted: true, sha256}` — the hash preserves audit integrity without content). Deletion requests (DPDP): per-session purge job with an audit event, exportable proof.

## 7. Appointments & Access entities *(Doc-13 amendment; built in S06A/S15A/S28A)*

### resources / schedules
`resources: id, tenantId, kind(practitioner|room|device|service), name, specialty?, schedulingMode(token|slot|walkin), settings jsonb (tokenBandMinutes, slotMinutes, capacityPerSession, overbook rules, priorityClasses[]), active`
`schedule_templates: id, resourceId, weekday, startTime, endTime, capacity` · `schedule_exceptions: id, resourceId, date, kind(leave|extra|modified), detail jsonb`

### appointments / queue
`appointments: id, tenantId, resourceId, patientRef jsonb (phone, name?, externalRef?), date, tokenNumber nullable, slotStart nullable, priorityClass?, status(booked|confirmed|arrived|in_service|done|no_show|cancelled|rescheduled), source(web|whatsapp|phone|kiosk|assisted|concierge), bookingSessionId nullable (the workflow session that created it), intakeSessionId nullable (**the stitch**: linked intake), rescheduledFromId nullable, createdAt, statusChangedAt`
Booking/reschedule/cancel/check-in each emit evidence events on the booking session (`action.executed`, §4 addendum below) and audit rows — the audited appointment trail is a differentiator (doc 13 §1).
Queue board is a projection over today's appointments per resource; `arrived` transition = check-in (QR/token), which links or spawns the intake session.

### notifications / campaigns
`notification_templates: id, tenantId nullable(platform defaults), kind(confirm|reminder_1d|reminder_2h|no_show|report_ready|recall|custom), channel(whatsapp|sms|voice), lang, body/templateRef, approvalStatus (WABA/DLT)`
`notifications: id, tenantId, appointmentId?/sessionId?, templateId, channel, to, scheduledAt, sentAt, status(scheduled|sent|delivered|failed|optedOut), providerMeta jsonb`
`optouts: tenantId, phone, channel, createdAt`
`campaigns: id, tenantId, kind(recall|no_show_winback|followup), workflowVersionId?, audienceQuery jsonb, schedule jsonb, status, stats jsonb`

### knowledge base (T3 concierge)
`kb_articles: id, tenantId, title, body (tenant-approved content only), lang, tags[], embedding vector?, updatedBy, updatedAt` — retrieval source for concierge answers; the model never answers front-door questions from its own memory (ADR-018).

### §4 event-taxonomy addendum
New evidence event types: `action.requested` / `action.executed` / `action.failed` (payload: actionKind book|reschedule|cancel|notify|escalate, params, resultRef) · `checkin.completed` · `tool.invoked` (T3: tool name, args hash, resultRef, sessionCostPaise) · `kb.answer_served` (articleIds, question). Cost records gain kind `notification`.
