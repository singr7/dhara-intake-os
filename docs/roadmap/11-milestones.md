# 11 — Milestone Map (full spectrum, M0→M10)

Each milestone ends with something demonstrably working ("quick milestones that build"). Sessions (S01…S36) are specified in `sessions/`. A session ≈ one focused Opus-engine coding session. Milestones M1–M6 correspond to the 12-week production-MVP arc; M7–M10 complete the full platform spectrum.

| M | Name | Sessions | Demo at the end ("definition of alive") |
|---|---|---|---|
| **M0** | Decisions locked | — (this folder) | Roadmap approved; repo name, stack, ADRs frozen |
| **M1** | Workflow spine — deterministic intake, no voice | S01–S06 | A patient completes a touch-only OPD intake on a phone PWA from a QR link; structured JSON with provenance + consent recorded; admin edited & published the workflow as JSON; all in a multi-tenant, containerized stack |
| **M2** | Hybrid voice + touch runner | S07–S11 | Same intake completed by *speaking* Hindi/English answers with cached prompt audio, interpreted-answer confirmation, clarification loop, automatic touch fallback; every voice step in the evidence graph |
| **M3** | Review console + structured output + export | S12–S15 | Nurse opens queue, sees confidence/red flags, plays an audio snippet, corrects a field, approves; JSON webhook + PDF summary fire; analytics v0 shows completion & drop-off |
| **M4** | Cost router + audit + observability | S16–S18 | Dashboard shows **cost per completed intake** by provider/kind; tenant budget hard-stop degrades to touch; append-only audit + retention purge proven; Grafana alerts live |
| **M5** | Pack library + Studio v1 | S19–S21 | Radiology, OPD, Camp packs instantiate per tenant; visual flow builder + simulation mode; radiologist-ready summary from the radiology pack |
| **M6** | Pilot hardening | S22–S25 | 50 concurrent sessions load-tested; full RBAC, tenant branding, kiosk auto-reset, assisted-intake mode; onboarding docs + demo script; **Pilot 1 (diagnostic center) starts** |
| **M7** | Conversational mode + telephony | S26–S28 | Mode-3 realtime voice intake (Gemini Live/OpenAI Realtime, hard cost caps) inside the state machine; LiveKit + SIP: an outbound phone call completes an intake; follow-up-call workflow live |
| **M8** | Field scale — offline, WhatsApp, local models, harness | S29–S32 | Offline camp mode on tablets with evening sync; WhatsApp document/summary flows; local STT/TTS slots evaluated via the full harness; noisy-mode certified; **Pilot 3 (health camp) runs** |
| **M9** | Enterprise & integrations | S33–S36 | AWS migration; HMS/EMR + Sheets adapters; FHIR mapping + ABDM sandbox; BYOM with harness gating; SLAs, 500-session scale |
| **M10** | Expansion (planned, not yet sessioned) | — | Survey/ESG vertical packs; additional languages; correction-dataset-driven model tuning; consumer "visit preparedness" exploration; Play Store kiosk app GA |

## Doc-13 amendment deltas (2026-08-13)

| Change | Detail |
|---|---|
| **M1.5 inserted** | **S06A — Appointments core** (resources, token-queue model, `action` DSL node, booking API + pack v0, queue board v0) runs after S06. M1.5 demo: patient books a token on a web link, receptionist sees the queue, check-in launches intake |
| **M3.5 inserted** | **S15A — Notifications & the stitch** (WhatsApp-template/SMS sender, DLT/WABA registration, reminders with intake link, check-in stitch polish, front-door analytics) runs after S15 |
| **M7 extended** | **S28A — Concierge tier (T3)** after S28: tool-bridge, tenant KB, campaigns, tier metering. S26 amended to include tool-bridge hooks |
| **Amended sessions** | S12 (queue board in console), S20 (booking pack matures), S26 (tool hooks), S30 (full WhatsApp inbound; minimal sender moved to S15A) |
| **Deferrals** | S29 offline camp mode and S32 local models slip one milestone (M8 stretches; Pilot 3 follows S29). Nothing else cut |
| **Positioning** | Milestone demos from M1.5 onward lead with the front door: Book → Remind → Intake → Queue → Review → Follow-up (doc 13 §2); tiers T1/T2/T3 per doc 13 §5 |

## Sequencing rules

1. **Workflow before voice** (risk #1 mitigation): M1 must complete before any STT/TTS code exists.
2. **Review before conversational**: Mode 3 (M7) is not started until nurses are correcting real output (M3+).
3. Pilots gate milestones, not the reverse: Pilot 1 feedback (M6→) feeds M7/M8 scope; Pilot 2 (OPD) starts during M7; Pilot 3 (camp) during M8.
4. The eval harness grows continuously: seeded in M4 (S18), gates every provider/model/pack change from M5 onward, fully automated in M8 (S31).
5. Every milestone ships to staging on the omen box; AWS only at M9.

## The 90-day proof (M1–M6) restated as acceptance

1. Non-technical admin configures an intake flow (M5 Studio).
2. Patient completes it in Hindi/English via voice + touch (M2).
3. Structured JSON + doctor-ready summary (M3).
4. Nurse reviews and corrects quickly (M3).
5. Dashboard shows completion, correction rate, cost per intake (M4).
6. Pilot site confirms reduced intake burden + better data quality (M6 exit).
