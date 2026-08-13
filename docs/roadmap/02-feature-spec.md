# 02 — Full Feature Specification

This is the product-manager-facing spec: every module, persona, and feature of the full platform (not just MVP). Milestone tags (M1…M10, per doc 11) show when each feature lands. A PM can lift any section into feature descriptions, sales collateral, and business cases.

## 1. Personas

| Persona | Description | Primary surface |
|---|---|---|
| **Patient / Respondent** | Person providing information: OPD patient, scan patient, camp beneficiary, survey respondent. May be low-literacy, elderly, accompanied by family, in a noisy queue. | Intake Runner (PWA / kiosk / phone call / WhatsApp) |
| **Operator / Nurse / Field worker** | Staff who supervise intake, review, correct, approve, and hand off to doctors. | Review Console; Assisted-intake mode |
| **Workflow Author (Admin)** | Clinic admin or Dhara solution engineer who configures intake flows, languages, and export targets. | Workflow Studio |
| **Doctor / Radiologist** | Consumer of the output: structured history + summary with provenance. | Summary view, EMR/PDF/WhatsApp export |
| **Tenant Owner** | Buys and administers the platform for an org: users, roles, budgets, branding, retention. | Tenant admin |
| **Platform Operator (us)** | Runs the SaaS: tenants, providers, costs, model routing, health. | Platform ops console |
| **Integrator** | External developer pushing intake output into HMS/EMR/CRM. | REST API + webhooks |

## 2. Module map

1. **Workflow Studio** — author intake flows (M1 JSON-based → M5 visual builder)
2. **Intake Runner** — patient-facing engine, all four modes (M1 touch → M2 hybrid voice → M7 conversational/telephony)
3. **Review Console** — nurse/operator queue and correction (M3)
4. **Model Router** — provider-agnostic STT/LLM/TTS routing with cost caps (M2 basic → M4 cost-aware)
5. **Evidence & Audit** — consent, provenance, corrections, exports, retention (M1 skeleton → M4 complete)
6. **Analytics** — completion, cost, correction, quality dashboards (M3 v0 → M6 full)
7. **Pack Library** — versioned domain workflow packs (M5)
8. **Eval Harness** — automated intake quality testing (M4 seed → M8 full)
9. **Integrations** — webhooks, PDF, Sheets, WhatsApp, HMS/EMR, FHIR/ABDM-ready (M3 → M9)
10. **Tenant & Platform Admin** — multi-tenancy, RBAC, budgets, branding (M1 skeleton → M6 hardened)
11. **Appointments & Access** *(Doc-13 amendment)* — token-queue-first booking, reminders/recalls, queue board, concierge tier (S06A → S15A → S28A)

## 3. Module specs

### 3.1 Workflow Studio

Admin creates and versions intake flows without code.

**Features**
- Workflow list per tenant with status (draft / published / archived) and semantic version. *(M1)*
- JSON/YAML workflow editor with server-side validation and human-readable errors. *(M1)*
- Question node editing: text per language, answer schema (choice, multi-choice, boolean, number+unit, duration, free-text, date, phone, photo/document upload, body-location picker), required/optional, interaction mode per question (touch / voice / hybrid / auto). *(M1–M2)*
- Branching & conditions: show/skip logic on prior answers, computed flags. *(M1)*
- Validation rules: ranges, regex, cross-field consistency, "must confirm" markers. *(M1)*
- Red-flag rules: answer patterns that raise safety flags and escalation instructions (e.g. chest pain + breathlessness → immediate staff alert, never advice to patient). *(M2)*
- Language packs per workflow: translated question text, prompt audio slots, per-language TTS voice config. *(M2)*
- Review policy per workflow: which fields always need human confirmation; confidence threshold routing. *(M3)*
- Output schema mapping: DSL fields → export JSON schema → summary template. *(M1)*
- Versioning: publishing freezes an immutable `WorkflowVersion`; running sessions pin their version forever. Diff view between versions. *(M1 core, M5 diff UI)*
- Visual drag/drop flow builder over the same DSL. *(M5)*
- Pack import/instantiate: start a workflow from a library pack, customize, keep provenance of pack version. *(M5)*
- Simulation mode: author steps through the flow as a fake patient, sees extraction and output JSON live. *(M5)*

**Key user stories**
- As an admin, I can publish v1.3 of "OPD General Intake" and know that every intake records which version collected it.
- As an admin, I can mark "current medications" as always-human-reviewed.
- As a Dhara engineer, I can instantiate the Radiology pack for a new diagnostic center in under an hour.

### 3.2 Intake Runner

The patient-facing engine. One session = one state machine (doc 05 §3), whatever the surface.

**Surfaces**: patient/kiosk PWA *(M1)* · operator-assisted mode *(M6)* · telephony *(M7)* · WhatsApp document/answer capture *(M8)* · Android kiosk app *(M8, ports demo's Capacitor learnings)*.

**Features**
- Consent screen first, always: purpose, data usage, recording notice; consent captured with timestamp, language, and method; declining routes to human intake. *(M1)*
- Language selection (English/Hindi/Marathi at launch; pack-extensible). *(M1)*
- Touch mode: large buttons, icons, minimal text, pre-recorded question audio playback. *(M1–M2)*
- Hybrid mode (default): question audio plays (cached/pre-recorded), patient answers by voice or touch; interpreted answer is **shown and confirmed** before commit; automatic per-question fallback voice→touch after N failures. *(M2)*
- Voice pipeline: VAD, noise suppression, streaming STT, language detection, short answer windows, retry/reprompt, barge-in. *(M2)*
- Clarification loop: ambiguous answers get one targeted clarifying question, then fall back to touch/skip+flag. *(M2)*
- Document/report/photo upload with type tagging. *(M3)*
- Progress indicator, pause/resume, session recovery on network drop. *(M2)*
- Completion screen: token number, department suggestion ("routing assistance", staff-confirmed), handoff instructions. *(M3)*
- Fully conversational mode: realtime speech-to-speech within workflow guardrails; every extracted field still confirmed and provenance-logged; per-session hard cost caps (proven pattern: demo's 2.5-min OpenAI cap). *(M7)*
- Assisted human intake: nurse conducts conversation, system live-structures, prompts for missing fields, nurse confirms. *(M6)*
- Offline camp mode: PWA caches workflow + prompt audio, captures answers/audio locally, syncs when online; conflict-safe. *(M8)*
- Kiosk mode: auto-reset between patients, no data leakage between sessions, wipe on timeout. *(M6)*

**Key user stories**
- As a patient with low literacy, I can complete intake by listening to Hindi questions and tapping big picture buttons.
- As an elderly patient on a follow-up call, I can just talk, and my daughter can answer for me (proxy speaker is flagged in provenance).
- As a camp field worker, I can run 40 intakes on one tablet with no connectivity and sync in the evening.

### 3.3 Review Console

**Features**
- Intake queue with status, workflow, language, red-flag and low-confidence badges, waiting time. *(M3)*
- Intake detail: extracted fields with per-field confidence and provenance (transcript snippet + audio playback on demand), missing-field alerts, red flags on top. *(M3)*
- One-click correction of any field; corrections recorded as evidence-graph events with author + timestamp. *(M3)*
- Approve / return-to-patient / escalate actions; department confirmation. *(M3)*
- Summary editor: generated doctor-ready summary, editable before approval; structured data remains primary. *(M3)*
- Red-flag workflow: escalations create alerts (console banner; later push/WhatsApp to staff). *(M4)*
- Correction analytics feed (which fields get corrected most → workflow fixes). *(M6)*

### 3.4 Model Router

**Features**
- Provider abstraction for STT, LLM, TTS, realtime-voice with uniform adapter interfaces (doc 08). *(M2)*
- Routing policy per step: pre-recorded audio for fixed prompts; cached TTS; cheap streaming STT for short answers; LLM only for ambiguity/extraction; premium realtime only in conversational mode. *(M2–M4)*
- Language-aware provider choice (e.g. best Marathi STT ≠ best English STT). *(M4)*
- Fallback chains and outage handling; latency monitoring per provider. *(M4)*
- Cost metering per call, per step, per session; per-tenant budgets and hard caps; kill-switch semantics proven in demo (terminate upstream socket first). *(M4)*
- Local model slots (whisper-class STT, local TTS, small classifier LLM) behind the same adapters. *(M8)*
- BYOM: enterprise tenants register their own endpoints/keys; harness gate before enablement. *(M9)*

### 3.5 Evidence & Audit

- Consent records (who, when, language, method, purpose version). *(M1)*
- Full Intake Evidence Graph per session (doc 05 §4). *(M2–M4)*
- Prompt/model/workflow version stamped on every AI-derived value. *(M2)*
- Append-only audit event log: access, exports, corrections, deletions. *(M4)*
- Retention policies per tenant (audio vs transcript vs structured data have separate clocks); deletion + export (data-subject requests). *(M4)*
- Access logs and field-level redaction for PII in logs. *(M4)*

### 3.6 Analytics

- Operational: completed intakes, completion rate, drop-off point per question, average duration, queue times. *(M3 v0)*
- Quality: correction rate per field, low-confidence rate, red-flag frequency, language-switching rate, escalation rate, workflow quality score. *(M6)*
- Cost: **cost per completed intake** (headline), broken down by STT/LLM/TTS/telephony; provider latency. *(M4)*
- Tenant-facing dashboard + our platform-ops view. *(M6)*

### 3.7 Pack Library (first three packs — M5)

**Pack 1 — Radiology Intake** *(unfair advantage; compounds Radpretation)*: chest X-ray history, CT history, MRI safety, contrast allergy, pregnancy screening, prior surgery/implant, previous reports upload, presenting complaint, referring doctor note, urgency marker → radiologist-ready history summary + structured flags; later OHIF/Radpretation study association.

**Pack 2 — OPD General Intake**: chief complaint, duration, symptom clusters (fever/cough/pain/GI), basic red flags, existing conditions, medications, allergies, prior reports, department **suggestion** (framed strictly as routing assistance).

**Pack 3 — NGO/Health Camp Survey**: demographics, household info, symptoms, chronic disease, medication adherence, screening eligibility, follow-up need, referral need. Built for noisy/offline/assisted operation.

Later packs (M9+): diabetes/hypertension follow-up, maternal screening, vaccination eligibility, dermatology, STI syndromic (supervised), insurance pre-auth, ESG field evidence.

### 3.8 Integrations

Webhook + REST pull of final JSON *(M3)* · PDF summary *(M3)* · Google Sheets sink *(M6)* · WhatsApp summary to staff *(M6)* · HMS/EMR adapters (per-pilot) *(M9)* · FHIR resource mapping + ABDM sandbox *(M9, design-ready from M1)* · Radpretation study-record link *(M9)*.

### 3.9 Tenant & Platform Admin

Multi-tenant isolation *(M1)* · users/roles: owner, admin, reviewer, operator, viewer *(M1 basic, M6 full RBAC)* · branding (name, logo, colors on runner) *(M6)* · budgets & usage *(M4)* · retention config *(M4)* · platform ops: tenant provisioning, provider keys, health, global cost dashboards *(M6)*.

### 3.10 Appointments & Access *(Doc-13 amendment — full rationale in doc 13 §3)*

Scheduling as intake-of-{who, why, when} plus an audited side-effect, on the same workflow engine (ADR-017). **Not a PMS**: no billing, payments, payer logic, or rostering.

**Features**
- Resource & schedule model: practitioners/rooms/devices, weekly templates, exceptions/leaves, capacity. *(S06A)*
- Token-queue-first scheduling: per-resource mode `token` (numbered + estimated time band — the Indian OPD default) / `slot` (timed) / `walkin` (pure queue); priority classes; overbooking rules. *(S06A)*
- `appointment-booking` workflow pack: patient identify (phone+OTP or existing ref) → reason (reuses OPD complaint taxonomy + department routing) → resource/day/token pick → confirmation; reschedule + cancel flows; every booking/reschedule/cancel is an evidence event. Runs in all four modes and every surface. *(S06A → matured S20)*
- Queue board (console): today's tokens per resource, arrived/waiting/in-consult/done, **intake-status chip per patient** ("T-14 · history ready · 1 red flag"); check-in by QR/token links or launches the intake session. *(S06A v0, S12 integration)*
- Reminder & recall engine: confirmation, T-1day, T-2hr **with intake link** ("finish your history before you arrive" — the stitch neither booking-only nor intake-only products have), no-show follow-up, report-ready, recall campaigns; WhatsApp template/SMS/voice per tier; quiet hours, language, opt-out, DLT/WABA compliance. *(S15A; campaigns orchestrated at S28A)*
- Concierge tier (T3): 24/7 conversational front door with tool-use — book/reschedule/cancel, tenant knowledge-base answers (hours, directions, prep, fees), escalation to humans; every tool call an evidence event; hard budget caps. *(S28A, on M7 Mode-3 rails; ADR-018)*
- EMR posture: system-of-record appointment book for clinics that have none; adapter read/write where an HMS exists *(M9)*.

**Key user stories**
- As a patient, I book on a WhatsApp link in Marathi, get token 14 with a time band, finish my history at home, and just show the token QR at the desk.
- As a receptionist, I see the live queue with who has completed intake and which arrivals have red flags, and I can book a walk-in in three taps (assisted mode).
- As a clinic owner on T3, my phone line answers at 9 pm, books the patient, and I see the call transcript, the booking evidence, and the cost the next morning.

**Front-door metrics** (added to Analytics): answer rate, out-of-hours bookings, no-show delta, front-desk minutes saved, % arrivals with completed history.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | Touch step commit < 300 ms; STT partials < 1 s; question-to-question < 2 s in hybrid mode; conversational first-audio < 1.5 s |
| Concurrency | 50 concurrent PWA sessions per pilot site at M6; 500 platform-wide at M9 |
| Availability | Pilot 99%; M9 target 99.9% for intake capture path (runner degrades to touch-only if AI providers are down — capture never fully fails) |
| Data | All PII encrypted at rest and in transit; audio stored in S3 with per-tenant prefixes; India data residency |
| Accessibility | Large-touch targets, audio-first flows, WCAG AA for consoles |
| Cost | Hybrid intake AI cost ₹1–₹5 per completed intake, enforced by router budgets |
| Safety | No diagnosis or treatment advice in any generated text — enforced by prompt contracts + output filters + harness tests |

## 5. Out of scope (see doc 01 §10)

Telemedicine consultation, EMR, prescriptions, payments, autonomous clinical decisions, consumer app (until M10 exploration).
