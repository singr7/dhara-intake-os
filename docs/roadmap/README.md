# Roadmap — Dhara Voice Intake OS

This folder is the complete execution plan for turning the DharaIntake demo into **Dhara Intake OS**: a configurable, multilingual, voice-and-touch intake intelligence platform that converts messy human conversations into validated, auditable, structured data — for healthcare, field surveys, and operational workflows.

The core product is **not voice**. It is **reliable intake completion + structured evidence + human-verifiable output**. Voice is used only where it improves completion, accessibility, speed, or trust.

## How to use this folder

Every document is written so that a coding agent (the "Opus engine") can execute a session with **no access to any other conversation** — each session file is self-sufficient, and the reference documents are the single source of truth for contracts.

| Doc | Purpose | Primary audience |
|---|---|---|
| [01-vision-and-business.md](01-vision-and-business.md) | Thesis, market, wedge, pricing, pilots, risks | Founder / PM / investors |
| [02-feature-spec.md](02-feature-spec.md) | Full product feature spec — every module, persona, user story | Product manager |
| [03-architecture.md](03-architecture.md) | System architecture + numbered ADRs (binding decisions) | Engineering |
| [04-stack-and-repo.md](04-stack-and-repo.md) | Platform stack, monorepo layout, coding conventions | Opus engine |
| [05-data-model.md](05-data-model.md) | Entities, tables, the Intake Evidence Graph, JSON contracts | Opus engine |
| [06-workflow-dsl.md](06-workflow-dsl.md) | The Workflow DSL — grammar, node types, validation, versioning | Opus engine / domain authors |
| [07-api-and-events.md](07-api-and-events.md) | REST/WS API surface, event names, webhook contracts | Opus engine / integrators |
| [08-voice-and-cost-router.md](08-voice-and-cost-router.md) | Voice orchestration, provider abstraction, cost-routing engine | Opus engine |
| [09-security-compliance.md](09-security-compliance.md) | Consent, DPDP, retention, RBAC, audit, safety boundary | Engineering / legal |
| [10-deployment.md](10-deployment.md) | Environments, infra, CI/CD, monitoring, from LAN box to AWS | DevOps |
| [11-milestones.md](11-milestones.md) | Full-spectrum milestone map M0→M10 (not just 90 days) | Everyone |
| [12-eval-harness.md](12-eval-harness.md) | The intake evaluation harness — test-case taxonomy, metrics | Opus engine / QA |
| [13-packaging-tiers-and-access.md](13-packaging-tiers-and-access.md) | **Amendment (2026-08-13):** front-door positioning, Appointments & Access layer, tier ladder T1–T3, agentic-tier verdict, roadmap deltas | Everyone |
| [sessions/](sessions/) | Session-by-session build instructions, grouped per milestone (incl. [A-appointments.md](sessions/A-appointments.md) S06A/S15A/S28A) | Opus engine |

> **Amendment note:** doc 13 was adopted after docs 01–12 and the M1–M9 session files were written. Where doc 13 conflicts with an earlier doc, **doc 13 wins**; the earlier docs carry inline `[Doc-13 amendment]` markers at every touched point.

## Session execution protocol (binding)

1. Each coding session, the Opus engine reads: `roadmap-voice-os-intake/README.md`, the session's file in `sessions/`, plus every reference doc that session lists under "Required reading".
2. The new platform lives in a **new repository** `dhara-intake-os` (see ADR-001). This demo repo stays as-is; its proven code (relay pattern, audio unlock, native ring) is *ported*, never imported.
3. At the end of every session the engine must: run the session's acceptance checks, commit with a message referencing the session ID (e.g. `S03: workflow DSL compiler + validator`), and update `HANDOFF.md` in the new repo (created in S01) with what was done, what deviated from plan, and what's next.
4. If a session's plan conflicts with reality (library API changed, contract impossible), the engine documents the deviation in HANDOFF.md and in a `DEVIATIONS.md` file, choosing the smallest change that preserves the contracts in docs 05–08.
5. No session may weaken the safety boundary in doc 09 (intake support, never diagnosis) or skip consent/audit writes to save time.

## Naming

- Product / store-facing name: **DharaIntake** (established 2026-07-03; "VocalBridge" must not appear anywhere user-facing).
- Platform working name in these docs: **Dhara Intake OS**.
- New repo: `dhara-intake-os`.
