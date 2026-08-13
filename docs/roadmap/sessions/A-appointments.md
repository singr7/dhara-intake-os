# Amendment sessions — Appointments & Access (Doc-13) · S06A, S15A, S28A

Adopted 2026-08-13 per [doc 13](../13-packaging-tiers-and-access.md). These sessions interleave with the M1–M9 files: **S06A after S06 (M1.5)**, **S15A after S15 (M3.5)**, **S28A after S28 (M7)**. Amendment notes for S12/S20/S26/S30 and deferrals for S29/S32 are at the end. The per-session protocol in [README.md](README.md) applies unchanged.

---

## S06A — Appointments core: resources, token queues, booking on the workflow engine

**Required reading:** docs 13 §3 (design), 05 §7 (entities), 06 §2 (`action` node), 07 §8 (routes), 03 (ADR-017, 019).
**Preconditions:** S01–S06 complete (session engine, runner touch mode, console v0 all working).

**Tasks**
1. Migrations for doc 05 §7 scheduling entities: `resources`, `schedule_templates`, `schedule_exceptions`, `appointments` (all statuses, `bookingSessionId`/`intakeSessionId` links, `rescheduledFromId`). Availability computation service: per resource+date → token numbers with estimated time bands (`tokenBandMinutes` × position ÷ capacity) or timed slots or walk-in; respects exceptions, capacity, priority classes, overbooking rules. Unit-test the band math and edge cases (leave day, capacity full, priority insertion).
2. **DSL `action` node** (doc 06 §2 amendment) in `packages/dsl` + contracts: `actionKind book|reschedule|cancel|notify|escalate`, `params` bound from committed fields via the expression grammar, `onFailure` transition. Interpreter treats it as a server-side effect node: emit `action.requested` → execute via a code-owned action registry → `action.executed`/`action.failed` → transition. Validator: action params type-check against registry signatures; `book` requires a verified-phone field upstream (enforced check). **The registry is code; DSL can never define new action kinds.**
3. New evidence event types wired (`action.*`, `checkin.completed` — doc 05 §4 addendum) in `contracts/events.ts`.
4. Booking API (doc 07 §8): staff routes (`/resources`, `/appointments`, `/queue`, `/appointments/:id/checkin`) + public routes (`/book/availability`, `/book/otp` + `/book/verify` (SMS OTP can stub to log in dev; real gateway lands S15A), `/book/appointments` with idempotency-key, signed reschedule/cancel links). Error codes `SLOT_TAKEN, RESOURCE_CLOSED`. Concurrency: token assignment race-safe (tx + unique (resource, date, tokenNumber)).
5. **`appointment-booking` pack v0** (`packs/appointment-booking/`): identify (phone → OTP verify node) → name → reason (choice grid reusing OPD complaint taxonomy) → resource/date/token selection (new touch UI schema kinds: `resourcePicker`, `datePicker`, `tokenPicker` fed by availability endpoint) → `action: book` → confirmation end screen (token number, time band, add-to-calendar link). en/hi text. Reschedule + cancel workflows (entered via signed links).
6. Runner: render the three new touch UI kinds; booking flow works as a plain shareable link (no staff-created session needed — public booking mints its own session against the booking pack; rate-limited).
7. Console **queue board v0**: today's appointments per resource, status columns (booked/arrived/in_service/done/no_show), manual status transitions, staff walk-in booking form (3-tap), check-in button → generates/links intake session and shows its join QR (**the stitch**: `appointments.intakeSessionId`). Intake-status chip (none/in-progress/completed/red-flag) via the linked session.
8. Tenant settings: default scheduling mode, token band minutes, OPD hours quick-setup wizard (one screen: days, hours, capacity → generates templates).
9. Tests: end-to-end booking via public link → appears on queue board → check-in → intake session linked → both sessions' evidence streams correct; double-booking race test; reschedule/cancel flows; ADR-017 non-goal guard — grep-level check that no billing/payment fields crept into schemas.

**Acceptance**
- M1.5 demo (record in `docs/demos/M1.5.md`): on staging, a patient books token via web link on a phone (OTP stubbed or real), receptionist sees them on the queue board, check-in launches the OPD intake, completed intake shows as a chip on the queue. Availability math unit tests green; booking is an auditable evidence trail (show `action.executed` in the detail view).

---

## S15A — Notifications, reminders & the front-door stitch

**Required reading:** docs 13 §3.5 + §7 risk 3 (deliverability lead times), 05 §7 (notification/campaign/optout tables), 07 §8, 09 (consent/opt-out posture).
**Preconditions:** S06A + S12–S15 complete (booking live, review console + analytics v0 exist). **Lead-time note:** WABA (WhatsApp Business) template approval and Indian DLT SMS registration take days-to-weeks — the founder should initiate registrations when S12 starts, not today; this session must work with whatever is approved, falling back cleanly.

**Tasks**
1. Notification service (worker): channel adapters — WhatsApp Cloud API template sender, SMS gateway (pick an Indian DLT-compliant provider: MSG91/Kaleyra-class; record choice), and a `link-only` fallback channel (on-screen/printed token when nothing is approved yet). Adapter interface mirrors `packages/providers` discipline; delivery status webhooks → `notifications.status`; cost recorded (`cost_records kind=notification`).
2. Tables + logic: `notification_templates` (approval status tracked), `notifications` scheduling (BullMQ delayed jobs), `optouts` (STOP handling per channel), quiet hours per tenant, language selection from appointment/patientRef.
3. Reminder rules engine on appointments: confirm-on-book, T-1day, T-2hr **with intake deep link** ("finish your history before you arrive" — creates/links the intake session token), no-show follow-up (status → no_show fires winback message with one-tap rebook link), report-ready (manual staff trigger v1). Rules configurable per tenant (on/off + timing), sensible defaults seeded.
4. Reschedule/cancel signed links in messages round-trip to the S06A flows; every notification emits evidence on the appointment's booking session (`action.executed kind=notify`).
5. Front-door analytics additions (doc 02 §3.10 metrics): out-of-hours bookings, no-show rate (and delta once history accrues), % arrivals with completed history, reminder delivery/response rates; tiles on the analytics page + pilot dashboard.
6. Consent/compliance pass: transactional-message classification, opt-out honored across channels (test), templates carry clinic identity, no health details in message bodies (booking + link only — doc 09 posture).
7. Tests: scheduling correctness (timezone/quiet-hours fixtures), opt-out suppression, fallback ladder (WABA unapproved → SMS → link-only), no-show winback flow.

**Acceptance**
- M3.5 demo: book → WhatsApp/SMS confirmation arrives → T-2hr reminder (compressed clock in staging) with intake link → patient completes history at home → queue chip shows "history ready" at check-in → mark no-show on another appointment → winback message with rebook link works. Delivery statuses and costs visible; opt-out proven.

---

## S28A — Concierge tier (T3): tool-bridge, knowledge base, campaigns, tier metering

**Required reading:** docs 13 §4–5 (the agentic verdict — binding), 03 (ADR-018, 019), 07 §8 (tool-bridge contract), 05 §7 (kb tables, `tool.invoked`), 08 §5 (budgets).
**Preconditions:** S26–S28 complete (Mode-3 relay, LiveKit/SIP telephony, follow-up pack). S26's amendment (below) done.

**Tasks**
1. **Tool-bridge** (`packages/contracts/tools.ts` + relay wiring): registry `find_availability, book_appointment, reschedule_appointment, cancel_appointment, get_appointment_status, kb_search, escalate_to_human` mapped 1:1 to internal endpoints; expose via function calling to both Gemini Live and OpenAI Realtime adapters. Relay refuses unregistered tool names; booking tools gated on in-call phone verification (OTP read-back or registered caller-ID match — implement both, config per tenant); every invocation emits `tool.invoked` with args-hash + result ref; failures returned as structured errors the agent must read back and confirm, never guess past (system-contract line + harness case).
2. **Tenant knowledge base**: `kb_articles` CRUD in console (tenant-approved content only: hours, directions, prep instructions, fees, FAQs; per-language), embedding + retrieval (pgvector; keep it boring), `kb_search` tool returns article excerpts with ids → `kb.answer_served` events. The agent's system contract forbids answering front-door facts from model memory (ADR-018) — harness red-team cases enforce.
3. **Concierge session flavor** of Mode 3: front-door system instruction (greet, identify intent: book/reschedule/status/question/intake, use tools, escalate on anything else), inbound phone line + WhatsApp text chat surface (text concierge reuses the same tool loop with a cheap non-realtime model — the affordable sibling), human-handoff path (transfer to staff number / callback ticket in console).
4. **Campaign orchestration** (doc 05 §7 `campaigns`): recall (due follow-ups by rule over past appointments/sessions) and no-show winback as scheduled campaigns — audience query → notification or outbound Mode-3 call (S27 machinery) per tier config; per-campaign stats and cost.
5. **Tier machinery (ADR-019)**: tenant `tier` config mapping to router policies + feature flags + budget caps (T1 deterministic-only policy set, T2 hybrid-voice set, T3 + concierge flags + realtime caps); per-workflow tier override; platform-ops tier switch UI; T3 metering — per-interaction premium + minute passthrough lines in the billing aggregation (S36 will consume); margin-visibility report (our cost vs charged) per doc 13 §7 risk 4.
6. Harness: concierge suite — booking-by-phone happy path, tool-failure read-back, KB-grounding red-team ("what are your charges" answered only from KB; "what disease do I have" → intake-only refusal + escalate), verification-gate bypass attempts, cap-kill mid-tool-call (must not double-book: idempotency proven).
7. Pricing sheet + demo update: T1/T2/T3 one-pager per doc 13 §5–6; M7 demo re-recorded leading with the front door.

**Acceptance**
- A real phone call to the concierge line books an appointment end-to-end (verification → availability → book → confirmation read-back + WhatsApp confirmation message), with every tool call visible as evidence and the call's full cost decomposed; KB question answered with article provenance; red-team harness green; flipping a demo tenant T3→T1 removes concierge cleanly with zero code change.

---

## Amendments to existing sessions (apply when executing them)

- **S12 (Review console):** add the queue board as a first-class console tab beside the review queue; intake chips and red-flag badges shared between both views.
- **S20 (Packs):** mature `appointment-booking` pack alongside the OPD pack — mr language, department-routing reuse, priority classes; harness cases for booking flows.
- **S26 (Realtime relay):** implement function-calling plumbing in both realtime adapters (tool schema in, tool-call events out) even though tools ship in S28A — protocol message `{type:"tool_call"...}`/`{type:"tool_result"...}` added to doc 07 §5's table.
- **S30 (WhatsApp):** scope reduced to *full Business API inbound* (document upload, two-way text concierge transport, template lifecycle management) — the outbound template sender already exists from S15A.

## Deferrals (Doc-13 §8.3)

- **S29 (offline camp mode)** and **S32 (local models)** shift one milestone later; M8 order becomes S30 → S31 → S29 → S32. Pilot 3 (NGO camp) follows S29's completion. Rationale: front-door revenue wedge outranks the social-proof pilot; nothing architectural is lost by the slip.
