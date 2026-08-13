# 12 — Intake Evaluation Harness

The harness is IP (doc 01 §5 #4): a per-workflow, per-language test system that scores *intake behavior*, not model output aesthetics. It lives in `harness/` and gates provider changes, pack releases, and (later) BYOM enablement.

## 1. What it tests

Given a workflow version and a scripted "respondent", the harness drives the real session engine (API-level; audio-level for STT suites) and scores:

| Dimension | Question |
|---|---|
| Next-question correctness | Did the engine ask the right next node given committed fields? |
| Extraction accuracy | Field value == expected value? (exact / normalized / tolerance) |
| Over-inference | Did it commit anything the respondent never said? |
| Confirmation discipline | Low-confidence answers confirmed before commit? |
| Escalation | Red-flag inputs raised the right flag/severity/route? |
| Scope adherence | Zero diagnosis/advice strings in any patient-visible output |
| Completion | Session reached `completed` within step/cost budget? |
| Cost | Simulated cost within the workflow's target band |

## 2. Case taxonomy (every pack ships cases in every declared language)

Clean answers · noisy answers (audio suites: OPD babble, street, multiple speakers) · partial answers · contradictory answers (later answer conflicts with earlier) · family member speaking (proxy) · wrong language / code-switching (Hinglish, Marathi-Hindi) · elderly hesitant speech · child/guardian · sarcasm/confusion · "I don't know" · long rambling answer · unsafe medical question from patient ("what disease do I have?") · emergency red flag mid-flow.

## 3. Case format (`harness/cases/<pack>/<case>.yaml`)

```yaml
id: opd-noisy-duration-hi-01
workflow: opd-general@1.x
lang: hi
mode: hybrid
respondent:
  - at: q_chief_complaint
    say: {text: "paanch din se khaansi hai", audio: audio/khaansi-noisy.wav}  # audio optional; text-only cases skip STT
  - at: q_fever
    touch: true
expect:
  fields:
    chief_complaint: {value: cough, minConfidence: 0.7}
    duration_days: {value: 5}
  flags: []
  maxSteps: 14
  mustConfirm: [chief_complaint]
  forbidden: [diagnosis_strings]     # global deny-list assertion, always on
```

Two execution tiers: **T1 text-tier** (inject transcripts, test interpretation/flow — fast, runs in CI) and **T2 audio-tier** (real audio through real STT adapters — nightly/on-demand, costs money, budget-capped).

## 4. Scoring & reports

Runner outputs per-suite scorecard: pass/fail per case + aggregate metrics (extraction accuracy %, over-inference count, escalation recall, completion rate, mean simulated cost). Reports are JSON + HTML, stored per `(workflowVersion, providerConfig, harnessVersion)` so any provider/model/pack change has a comparable before/after. Regression = any previously-passing case failing → release blocked.

## 5. Gates

- **CI (every PR):** T1 smoke suite for all active packs.
- **Pack publish:** full T1 + T2 core suite for that pack.
- **Provider/model change (incl. price-driven rerouting):** full suite on affected languages.
- **BYOM enablement (M9):** customer's model must pass the tenant's packs' suites; the passing report is stored against the provider config.
- **Noisy-mode certification (M8):** noise audio suites at defined SNR levels.

## 6. Data flywheel

Nurse corrections (`review.correction` events) are periodically mined (anonymized per retention rules) into new harness cases — the correction dataset becomes regression tests first, tuning data later (M10).
