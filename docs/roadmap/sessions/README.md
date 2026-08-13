# Session Instructions — how the Opus engine must work

One file per milestone (`M1.md` … `M9.md`), each containing that milestone's sessions (S01…S36). Sessions are designed to be executed **in order**, one per coding session, with no other conversation context.

## Per-session protocol (binding)

1. **Read first:** this file, the session's entry, its "Required reading" docs from `roadmap-voice-os-intake/` (copy this folder into the new repo at S01 as `docs/roadmap/`), and the repo's `HANDOFF.md`.
2. **Verify preconditions** listed in the session. If a precondition fails, fix it first (log in HANDOFF) — do not silently skip.
3. **Execute the task list.** Contracts in docs 05–08 are binding; internal implementation details are the engine's choice. Anything ambiguous: choose the simplest option consistent with the ADRs and record it in HANDOFF.
4. **Acceptance checks** at the end of each session must pass (they are commands or verifiable behaviors, not vibes).
5. **Close out:** update `HANDOFF.md` (done / deviations / next), update `DEVIATIONS.md` if the plan changed, commit `S<NN>: <summary>`, push.
6. **Never**: weaken the safety boundary (doc 09 §1), skip consent/evidence writes, leak provider SDK types past adapters, bypass the tenant-scoped DB client, commit secrets.

## Scope discipline

Each session ships its listed scope **working end-to-end**, even if visually plain. Prefer ugly-but-tested over pretty-but-stubbed. If time runs short, cut polish, never cut: migrations, evidence events, tests listed in acceptance, HANDOFF update.

## Session index

| Milestone | Sessions | File |
|---|---|---|
| M1 Workflow spine | S01 scaffold · S02 data model+auth · S03 DSL package · S04 session engine+runner API · S05 runner PWA (touch) · S06 studio v0 + M1 demo | [M1.md](M1.md) |
| M2 Hybrid voice | S07 provider adapters · S08 prompt-audio pipeline · S09 runner voice capture · S10 interpretation ladder · S11 language packs + M2 demo | [M2.md](M2.md) |
| M3 Review+export | S12 review console · S13 summaries+provenance UI · S14 exports (webhook/PDF) · S15 analytics v0 | [M3.md](M3.md) |
| M4 Cost+audit | S16 cost metering+budgets · S17 audit+retention · S18 observability+harness seed | [M4.md](M4.md) |
| M5 Packs+Studio | S19 pack framework + radiology pack · S20 OPD+camp packs · S21 visual studio + simulation | [M5.md](M5.md) |
| M6 Pilot hardening | S22 RBAC+tenant admin · S23 kiosk+assisted mode · S24 load+failure hardening · S25 pilot kit | [M6.md](M6.md) |
| M7 Conversational+telephony | S26 realtime relay (Mode 3) · S27 LiveKit+SIP calls · S28 follow-up workflows | [M7.md](M7.md) |
| M8 Field scale | S29 offline camp mode · S30 WhatsApp adapter · S31 harness full automation · S32 local model slots | [M8.md](M8.md) |
| M9 Enterprise | S33 AWS migration · S34 integration adapters · S35 FHIR/ABDM sandbox · S36 BYOM + enterprise hardening | [M9.md](M9.md) |
| **Doc-13 amendment** | **S06A** appointments core (after S06) · **S15A** notifications+stitch (after S15) · **S28A** concierge tier (after S28) · amendments to S12/S20/S26/S30 · S29/S32 deferred one milestone | [A-appointments.md](A-appointments.md) |

> **Execution order with the amendment:** …S06 → **S06A** → S07… · …S15 → **S15A** → S16… · …S26(amended) … S28 → **S28A** … · M8 runs S30 → S31 → S29 → S32.
