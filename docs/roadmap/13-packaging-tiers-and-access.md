# 13 — Packaging: The Front Door, Appointments, Tiers & the Agentic Question

**Status: adopted 2026-08-13. This document amends docs 01–12; where it conflicts with them, this doc wins. The concrete deltas it introduces are listed in §8 and embedded in the amended docs and sessions.**

## 1. Competitive frame: what Pype and HelloPatient actually are

| | **Pype AI** | **Hello Patient** |
|---|---|---|
| Product | AI voice agents for patient communications (voice, WhatsApp, SMS, email) | "Mia" — AI assistant for calls/SMS/chat, front+back office |
| Anchor jobs | Appointment scheduling/reminders/rescheduling, post-discharge follow-up, chronic-care check-ins, pre-procedure instructions | 24/7 scheduling, insurance verification, intake, no-show recovery, recall campaigns, bill pay |
| Market | US hospitals/health systems (India-founded, US-selling; $1.2M pre-seed) | US practices across 20+ specialties |
| Moat claims | EMR integrations (Epic/Cerner/Meditech), specialty tuning, HIPAA/SOC2, self-hosted VPC | EHR integrations (ModMed, Athena, eCW…), 100% answer rate, HIPAA/SOC2 |
| Pricing | Undisclosed (US enterprise sales motion) | Undisclosed (demo-call sales motion) |
| Architecture posture | Conversation-first: the agent IS the product | Conversation-first: the agent IS the product |

**What they prove:** the buyer category is real and funded — clinics buy "an AI that answers every patient interaction" framed as front-desk relief, and **the appointment is the anchor event**. Intake, reminders, follow-ups all hang off a booking.

**Where they are weak (our critique, and our openings):**

1. **Conversation-first economics.** Every interaction is a full conversational-AI session — their unit cost is minutes of premium voice AI. They cannot profitably serve a ₹200-consultation Indian clinic. Our hybrid/deterministic-first architecture (docs 03/08) makes the *same jobs* 10–50× cheaper per completed interaction.
2. **No evidence layer.** They produce call outcomes and notes; we produce field-level provenance, confidence, and human-verifiable audit (the Evidence Graph). In healthcare, "why does the system believe this" is trust, compliance, and a dataset. Neither competitor has this as a product object.
3. **US-shaped scheduling.** Timed slots against an EHR calendar. Indian OPD reality is **tokens, queues, and walk-ins** — a first-class token/queue model is a genuine product gap, not a localization detail.
4. **Black-box workflows.** Their flows are configured by their team per customer. Our Workflow DSL + Studio makes the customer (or our engineer, in an hour) the author — the pack library compounds; their services effort doesn't.
5. **English-plus.** "20+ languages" claims ≠ Marathi OPD noise robustness with touch fallback and assisted mode. Our noisy/rural mode is unaddressed by both.

**Verdict on merit:** the user's instinct is right, with one discipline condition. Adding appointments transforms us from "a better intake form" (a feature buyers must be educated about) into **the clinic's AI front door** (a category buyers already want) — and every architectural asset we planned (DSL, state machine, evidence graph, cost router, review console) applies *directly* to booking, reminders, and follow-ups. The discipline condition: **appointments must be a thin access layer on the existing engine, not a practice-management system** (ADR-017). The moment we build billing, payer rules, or full calendar administration, we become a shallow clone of ten products.

## 2. Repositioning

> **DharaIntake — the AI front door for Indian healthcare.** Patients book, check in, and give their history in their own language — by phone, WhatsApp, kiosk, or web. Staff get a clean queue, verified structured records, and automated reminders and follow-ups. Clinics pay per completed interaction, at Indian prices.

The intake-intelligence thesis (doc 01) is unchanged — it is the *engine*. The *package* leads with the front door: **Book → Remind → Intake → Queue → Review → Follow-up.** One patient journey, one evidence graph, one price per completed step.

What we deliberately still refuse: diagnosis, triage advice, EMR-replacement, billing/payments, insurance adjudication (India context makes the US insurance-verification job mostly irrelevant for our wedge anyway).

## 3. The Appointments & Access layer (what we actually build)

Design principle (**ADR-017**): *scheduling is intake of {who, why, when} plus a side-effect.* Booking runs on the same workflow engine — an appointment-booking flow is a workflow whose terminal node performs a booking action. Same DSL, same evidence events (auditability of every booking, reschedule, cancellation — no competitor has this), same four interaction modes, same tiers.

Components (full spec embedded in docs 02 §3.10, 05 §7, 06 §2, 07 §8):

1. **Resource & schedule model** — practitioners/rooms/devices, weekly templates, exceptions/leaves, capacity.
2. **Token-queue-first scheduling** — three modes per resource: `token` (numbered, est. time band — the Indian OPD default), `slot` (timed), `walkin` (pure queue). Overbooking rules, priority classes (elderly, follow-up, report-collection).
3. **Booking workflows** — pack `appointment-booking`: identify/verify patient (phone+OTP or existing ref) → reason (uses OPD complaint taxonomy → department routing rule from the OPD pack) → resource/day/token selection → confirmation. Reschedule/cancel flows. Runs in every mode: web/WhatsApp link, kiosk, phone call (M7), assisted (receptionist).
4. **Queue board** — console live view: today's tokens per resource, arrived/waiting/in-consult/done, **intake-status chip per patient** (the stitch: "T-14, history ready, 1 red flag"). Check-in on arrival (QR/token number) triggers or links the intake session.
5. **Reminder & recall engine** — scheduled notifications (WhatsApp template/SMS/voice per tier): confirmation, T-1day, T-2hr with intake link ("finish your history before you arrive" — this is the wedge stitch that neither the booking-only nor intake-only products have), no-show follow-up, report-ready, recall campaigns (due follow-ups). Quiet hours, language, opt-out.
6. **EMR posture** — for the majority of Indian small clinics: we are the (lightweight) appointment book. Where an HMS exists: read/write via the adapter framework (M9), never fighting it for system-of-record.

**Explicit non-goals:** billing, payments, payer/insurance logic, multi-location enterprise scheduling optimization, staff rostering.

## 4. The agentic question — seeing through the fluff

**Claim to evaluate:** "use Google's full agentic capabilities (Vertex AI Agent Builder / ADK / Agent Engine, or peers) as a tiered offering."

**What's real in 'agentic':** (a) tool-use — the model can *do* things (book, reschedule, look up hours) not just talk; (b) open-domain handling — patients ask arbitrary things (directions, prep instructions, fees, "is my report ready") and a scripted flow dead-ends where an agent answers; (c) multi-step orchestration across channels (call → no answer → WhatsApp → retry). These are genuinely valuable **at the front door**, where conversations are open-ended in a way intake is not.

**What's fluff for us:** "autonomous agents" as an architecture. Our product's selling points are determinism, auditability, and cost control — handing the session to a self-directed agent loop dissolves all three. And adopting a hosted agent *runtime* means: Agent Engine-class pricing (~$0.086/vCPU-hr + per-event session storage; realistic production agents run **$500–$2,000+/month** before voice minutes), US/limited-region residency questions, framework lock-in, and a duplicate of the session/state/tooling layer we already own. That price floor alone kills the affordability story for mid-tier India.

**Verdict (ADR-018):** *Consume agentic capabilities as model features through our existing adapter layer; do not adopt an external agent runtime.* Concretely:

- Build a small **tool-bridge**: our booking/queue/KB/escalation APIs exposed as function-calling tools to Gemini Live and OpenAI Realtime sessions (both already in our M7 relay design). The "agent" is a Mode-3 session whose tools are our audited APIs — every tool call is an evidence event, every session capped by our budgets.
- Add a tenant **knowledge base** (hours, directions, prep instructions, fees, FAQs) with retrieval — the open-domain answers come from tenant-approved content, not model memory (hallucination and safety control).
- ADK/A2A are watched, not adopted: if a customer's enterprise stack demands interop later, our tool-bridge can be wrapped; nothing in v1 depends on it.
- The same tool-bridge works with *any* provider — Google is a tier option, not a dependency. That's the honest version of "Google agentic capabilities as a tiered offering": Google's live models + function calling at the premium tier, on our rails, with cost passthrough + margin.

This is also the durable position: model-side agentic capability is commoditizing fast; the tools, the evidence, the workflows, and the queue are ours.

## 5. The tier ladder (affordability as architecture)

The cost router (doc 08) becomes the **pricing gradient**. Same workflows, same evidence graph, same console at every tier — the tier only changes interaction richness and the AI cost ceiling. Nobody in the category prices this way; it is our structural answer to "highly affordable."

| Tier | Name | What the patient gets | AI cost profile | Indicative price (planning) |
|---|---|---|---|---|
| **T1** | **Front Desk Lite** | Web/WhatsApp-link booking + token queue + reminders + touch/hybrid-lite intake + review console | Near-zero (deterministic + cached prompts; LLM only for extraction edge cases) | ₹1,500–₹5,000/mo small clinic, or ₹2–5/completed interaction |
| **T2** | **Voice** | Everything in T1 with full hybrid voice intake (en/hi/mr) + voice booking on kiosk/web; telephony intake at M7 | STT + selective LLM (₹1–5/intake by design) | ₹5–20/completed reviewed intake + modest platform fee |
| **T3** | **Concierge (Agentic)** | 24/7 conversational front door on phone/WhatsApp: books, reschedules, answers KB questions, runs recall/no-show campaigns, hands off to humans | Realtime voice models + tools, hard-capped per session/tenant | Platform fee + per-completed-interaction premium + minute passthrough with margin |

Tier enforcement is configuration, not code forks (**ADR-019**): tiers map to router policies + feature flags + budget caps per tenant. A clinic upgrades by flipping policy, and can mix tiers per workflow (T3 concierge line + T1 kiosk intake) — "choose your AI intensity per workflow" is a sales feature.

Affordability mechanics that make T1 honest, not a crippled demo: token-queue booking and touch intake are *fully* deterministic; reminders are template messages; the only AI spend is occasional extraction. A T1 clinic at 1,500 patients/month costs us single-digit ₹100s in COGS.

## 6. Commercial packaging

- **Land** with T1/T2 at diagnostic centers and OPD clinics (existing pilot motion, doc 01 §7 unchanged) — now demoable as the front door in one sentence: *"Your patients book on WhatsApp, arrive to a token, give their history in Marathi before the doctor calls them in."*
- **Expand** to T3 where call volume justifies it (multi-doctor clinics, diagnostics chains) — T3 is also the mindshare/PR tier ("agentic") that earns attention without being load-bearing for revenue.
- **Metrics that sell** (add to analytics): answer rate on the front-door line, bookings completed outside office hours, no-show rate delta, front-desk minutes saved, % patients arriving with completed history.
- Anti-claims we keep: no diagnosis, human review on health data, evidence for every AI action — this is the *trust* differentiation against conversation-first competitors when hospital procurement asks hard questions.

## 7. Critical risks of this amendment (stated honestly)

1. **Scope gravity toward PMS.** Guard: ADR-017 non-goals list; any feature request touching billing/rostering/payer logic is out-of-scope by default.
2. **Two-sided demo burden** (booking + intake) makes M-level demos heavier. Guard: the booking pack reuses the engine — S06A is one session because it is mostly schema + one new DSL node type.
3. **Notification deliverability** (WhatsApp template approvals, DLT SMS registration in India) has lead times. Guard: start registrations at S15A kickoff, not at code-complete; degrade to link-on-screen + printed token where channels lag.
4. **T3 margin illusion.** Realtime minutes are passthrough-priced; margin must come from platform fee + orchestration, and caps must be enforced upstream-kill-first (already our pattern). Guard: T3 launches only with per-tenant budget hard-stops proven (M4 machinery).
5. **Deferral cost.** §8 pushes offline camp mode and local models out one milestone; Pilot 3 (NGO camp) slips accordingly. Acceptable: camps are the social-proof pilot, not the revenue wedge; nothing in the deferral breaks the architecture.

## 8. Roadmap deltas (binding summary; embedded in docs 02/03/05/06/07/11 and sessions)

1. **New sessions** (specs in `sessions/A-appointments.md`):
   - **S06A** (M1.5): Appointments core — resource/schedule/token model, booking action node in DSL, booking API, `appointment-booking` pack v0, queue board v0. Runs after S06.
   - **S15A** (M3.5): Notification service v1 (WhatsApp template + SMS gateway + DLT/WABA registrations), reminder scheduling, check-in → intake stitch, front-door analytics. Runs after S15.
   - **S28A** (M7): Concierge tier — tool-bridge (function-calling over booking/KB/escalation), tenant knowledge base + retrieval, campaign orchestration (recall, no-show), tier packaging + T3 metering. Runs after S28.
2. **Amended sessions:** S12 (queue board integration in console), S20 (booking pack matures alongside OPD pack), S26 (relay gains the tool-bridge hooks), S30 (becomes full WhatsApp Business inbound; the minimal sender moved earlier to S15A).
3. **Deferrals:** S29 (offline camp mode) and S32 (local models) shift one milestone later (M8 stretches; Pilot 3 timing follows S29). M9 unchanged. Nothing else cut.
4. **New ADRs:** ADR-017 (thin access layer, token-first, not a PMS), ADR-018 (agentic = tools on our rails; no external agent runtime), ADR-019 (tiers = policy + flags + budgets, no code forks) — in doc 03.
5. **Data model:** doc 05 §7 adds resources, schedules, appointment, queue, notification, campaign, KB tables.
6. **DSL:** doc 06 adds the `action` node type (audited side-effects: book/reschedule/cancel/notify/escalate).
7. **API:** doc 07 §8 adds appointments/queue/notifications/KB routes and tool-bridge contract.
8. **Positioning:** doc 01 amended (§2a competitive frame, §8 packaging line); doc 02 gains module 3.10 Appointments & Access + tier table.
