# 01 — Vision & Business Case

## 1. Thesis

> Most organizations do not need an AI that talks endlessly. They need a reliable way to convert unstructured human responses into verified structured records.

**Dhara Intake OS** is a configurable, multilingual, voice-and-touch intake intelligence platform. It converts messy human conversations into validated, auditable, structured data for healthcare, field surveys, compliance, and operational workflows.

We do **not** build a general voice-agent platform (crowded: LiveKit Agents, Retell, Vapi, Bland, Twilio, Dialogflow CX, OpenAI Realtime, Gemini Live). We build a **controlled intake operating system** where voice is one interaction mode among four, and where the product wins on **intake quality**: completion, correctness, low cost, low hallucination, structured output, consent, auditability, human correction, workflow integration, language and noise robustness — with the hard boundary "collect information, not diagnose."

## 2. Why now

- Voice AI crossed the demo threshold: LiveKit positions itself as infrastructure for realtime programmable voice agents with SIP/telephony; healthcare voice agents (Hippocratic AI) are a validated non-diagnostic commercial category.
- Cost curves favor hybrid designs: Gemini audio ≈ $0.0368/min; OpenAI GPT-Realtime-Whisper $0.017/min, Realtime-Translate $0.034/min (2026 pricing). Cheap enough to deploy, expensive enough that a cost router is a real differentiator.
- Research consensus still favors **streaming cascaded pipelines** (STT → LLM → TTS) over native speech-to-speech for enterprise reliability, and warns that realtime agents fail under realistic noise, accents, and grounded task constraints. Our hybrid, deterministic-first design is aligned with the evidence, not against it.
- We already proved the hard demo pieces in `v2v-vocalbridge-demo`: server-relayed Gemini Live and OpenAI Realtime speech-to-speech, mobile audio unlock, native Android ring/earpiece, cost caps, token telemetry.

## 3. The wedge

**Healthcare and field intake for India**: OPD, diagnostic-center, radiology, NGO health camps, community surveys, screening programs, follow-up calls.

Why this wedge fits us: existing Radpretation/radiology domain knowledge; Next.js/Node/Python/AWS/LiveKit competence; NGO/rural exposure; Marathi/Hindi/English focus; kiosks and noisy OPD realism; and a clear understanding of the difference between "AI diagnosis" (unsafe, unsellable) and "AI-supported intake" (operational, sellable).

First use cases: OPD registration symptom intake · radiology history intake before X-ray/CT/MRI · health-camp screening intake · vaccination/reminder eligibility · lab/report upload + nurse confirmation · post-procedure follow-up intake · NGO beneficiary surveys.

**[Doc-13 amendment — the package]:** the go-to-market package is the **AI front door for Indian healthcare** — Book → Remind → Intake → Queue → Review → Follow-up on one engine, sold in tiers T1 (Front Desk Lite, near-zero AI cost) / T2 (Voice) / T3 (Agentic Concierge). Appointments are a thin, token-queue-first access layer on the same workflow engine (ADR-017), not a PMS. Competitive frame vs Pype AI / Hello Patient, the tier ladder, and the agentic-tier verdict live in [doc 13](13-packaging-tiers-and-access.md). The intake-intelligence thesis in this document is unchanged — it is the engine underneath that package.

**Route:** B2B/B2B2C — sell to clinics, diagnostic centers, NGOs, hospitals, screening programs; patients use it inside that workflow. A consumer "visit preparedness" app is deferred (high CAC, trust barrier, privacy burden, app-store medical risk, slow monetization).

## 4. The four interaction modes (one output contract)

| Mode | Description | When |
|---|---|---|
| **1 — Touch-first deterministic** | Icons, large buttons, pre-recorded questions, minimal open speech | Noisy environments, low literacy; cheapest, most reliable |
| **2 — Hybrid voice + touch** *(default MVP)* | User speaks short answers, system shows interpreted answer, confirm by touch/voice; LLM interprets, never free-chats | Default for OPD/kiosk |
| **3 — Fully conversational** *(premium)* | Natural voice, interruptions, follow-ups; higher cost/risk | Phone calls, remote intake, elderly, follow-up care |
| **4 — Assisted human intake** | Nurse asks; system listens, structures, suggests missing fields; human confirms | Safest enterprise adoption path |

The moat: **all four modes emit the same structured output contract** (doc 05).

## 5. The IP

Not the speech model, not the voice, not LiveKit. The proprietary assets, in order of compounding value:

1. **Intake Workflow DSL** (doc 06) — domain experts define questions, answer types, conditions, modes, validation, risk flags, review rules, output mapping.
2. **Intake schema pack library** — reusable, versioned packs (radiology, OPD, camp survey, chronic follow-up, MRI safety, contrast allergy, insurance, ESG…), each with questions, follow-up rules, safety boundaries, summary templates, red-flag escalation, review requirements, export schema.
3. **Intake Evidence Graph** (doc 05 §4) — every session becomes a structured graph: consent state, language, question asked, prompt audio, response audio, transcript, extracted answer, confidence, ambiguity markers, retries, touch confirmations, human corrections, final JSON, export destination, audit trail, safety flags, time/cost per step. Staff see *why* the system believes the patient said something.
4. **Conversation-to-structured-data evaluation harness** (doc 12) — per-workflow test suites of clean/noisy/partial/contradictory/code-switched/elderly/proxy-speaker answers, scoring next-question choice, extraction accuracy, over-inference, confirmation, escalation, scope adherence, completion.
5. **Cost-routing engine** (doc 08) — every step routed by cost and risk; the platform reports **cost per completed intake**, not cost per minute.
6. **Noisy/rural India mode** — hybrid design, touch fallback, operator assist, short answer windows, offline-first camp capture. Underbuilt by every competitor.
7. **Human correction dataset** — every nurse correction is a labeled training/eval example.
8. **Field-level provenance model + review/audit UX.**
9. **Integration adapters** — HMS/EMR, Sheets, WhatsApp summary, PDF, Radpretation study records, FHIR/ABDM-ready (sandbox later, designed-for from v1).

Fake moats we refuse to rely on: "we use LiveKit", "we support OpenAI/Gemini", nice voices, prompts, Hindi support, a form, telephony.

## 6. Commercial model

**Price per completed reviewed intake**, not per minute. Minute pricing makes buyers focus on our cost; completed-intake pricing makes them focus on staff time saved, doctor context quality, queue reduction, structured records, follow-up readiness.

| Segment | Pricing |
|---|---|
| Small clinic | ₹5–₹20 per completed intake |
| Diagnostic center | ₹10,000–₹50,000/month + usage |
| Health camp / NGO | Per camp + per completed intake |
| Hospital OPD | Department license + usage |
| Enterprise survey | Per completed survey/intake |
| Premium telephony | Platform fee + pass-through/minute costs |

**[Doc-13 amendment]:** the segment table above is now expressed through the tier ladder (doc 13 §5): T1 Front Desk Lite ₹1,500–₹5,000/mo or ₹2–5/interaction; T2 Voice ₹5–20/completed reviewed intake + platform fee; T3 Concierge platform fee + premium per interaction + minute passthrough with margin. Tiers are router-policy + budget configuration, never code forks (ADR-019).

Internal cost targets (planning ranges): hybrid PWA intake AI cost **₹1–₹5**/completed intake; telephony conversational **₹5–₹20+**; enterprise price ₹10–₹50+; hospital/diagnostic on subscription + usage. The router and prompt cache exist to hold these lines.

Four businesses hidden inside the idea, in build order: **A — Healthcare Intake OS** (first), **B — Survey/Field Intake OS** (second, lower clinical risk), **C — Enterprise BYOM voice platform** (v2/v3 feature, not MVP identity), **D — own TTS/STT models** (a trap as a first move; the first "model IP" is the cost-orchestration layer, with selective local models later).

## 7. Pilot strategy

**Pilot 1 — Diagnostic center / radiology intake.** 1 center, X-ray + CT, 100–300 intakes, Hindi/English, nurse review mandatory, no autonomous diagnosis. Metrics: completion rate, average time, nurse correction rate, radiologist usefulness rating, % missing-history reduction, cost per completed intake, patient confusion rate, language failure rate.

**Pilot 2 — OPD clinic intake.** Metrics: doctor satisfaction, field completeness, queue-time reduction, correction time, department-routing accuracy after staff confirmation.

**Pilot 3 — NGO health camp.** Metrics: completion under noise, operator assistance required, offline/poor-network handling, data completeness, follow-up/referral capture. Strongest social proof.

## 8. Positioning & naming

Product name: **DharaIntake** (already established, appId `ai.radpretation.dharaintake`).

- Master line: *"Voice-and-touch intake workflows that convert patient and field conversations into verified structured data."*
- Healthcare: *"Collect better patient history before the consultation, with multilingual voice, touch confirmation, and nurse-reviewed structured summaries."*
- NGO/survey: *"Run multilingual field intake and surveys with voice, touch, offline-friendly workflows, and structured exports."*

Safe positioning: "Collects and structures patient-provided information for review by healthcare staff." Never: "AI diagnoses patients before they see the doctor."

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Becomes a chatbot demo | Build workflow engine, schema output, review console **first**; voice second (milestone order enforces this) |
| Conversational mode too costly | Hybrid default, cached prompts, touch for structured answers, cheap STT for short answers, LLM only when needed, per-tenant budget caps, cost-per-completed-intake dashboards |
| Medical liability | No diagnosis/treatment advice anywhere (UX, prompts, API, sales); human review; red-flag escalation; disclaimers; consent; audit trail |
| Noisy environment failure | Hybrid design, touch fallback, operator-assisted mode, short answer windows, confirmation UI, noise test harness |
| Weak IP | DSL + packs + harness + router + evidence graph + correction dataset |
| Too many verticals | Radiology + OPD + health camp only; expand via workflow packs, not new products |

## 10. Explicitly deferred (do not build in v1)

Full telemedicine app · full EMR · ABHA **production** integration (sandbox-design-ready only) · app-store consumer app · autonomous diagnosis · native-mobile-first · own speech model · BYOM marketplace · insurance billing · e-prescription · payments · longitudinal family health record · clinical decision support.

## 11. The 90-day proof (inside the larger arc)

Milestones M1–M5 (doc 11) must demonstrate: (1) a non-technical admin configures an intake flow; (2) a patient completes it in Hindi/English with voice + touch; (3) structured JSON + doctor/nurse-ready summary; (4) a nurse reviews and corrects quickly; (5) dashboard shows completion, correction rate, cost per intake; (6) a pilot site says "this reduces our intake burden and improves data quality." The roadmap continues well past this into telephony, WhatsApp, offline camps, integrations, and enterprise — see doc 11.
