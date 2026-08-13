# 06 — Intake Workflow DSL Specification

The DSL is JSON data (ADR-007), validated by Zod (`packages/contracts`) plus graph checks (`packages/dsl`). Domain experts author it (raw in M1, visual builder in M5). This is core IP — the interpreter must implement exactly this spec.

## 1. Document shape

```jsonc
{
  "dslVersion": "1.0",
  "key": "opd-general",
  "title": { "en": "OPD General Intake", "hi": "ओपीडी सामान्य पूछताछ" },
  "languages": ["en", "hi", "mr"],          // first = fallback language
  "defaultMode": "hybrid",                   // touch | hybrid | conversational | assisted
  "consent": { "purposeVersion": "2026-07-01", "text": { "en": "...", "hi": "..." } },
  "settings": {
    "maxDurationSec": 900, "maxCostPaise": 500,
    "voiceFallbackAfterFailures": 2, "clarificationMaxAttempts": 1
  },
  "fields": { /* §3 answer/field schemas, keyed by fieldKey */ },
  "nodes":  [ /* §2 ordered node list; ids unique */ ],
  "rules":  { "redFlags": [ /* §5 */ ], "validations": [ /* §4 cross-field */ ] },
  "review": { "alwaysReview": ["current_medications"], "confidenceThreshold": 0.75,
              "reviewRequired": true },
  "output": { "schemaId": "opd-general-output@1", "summaryTemplateId": "opd-doctor-summary@2",
              "routingRule": "dept_routing_v1" }
}
```

## 2. Node types

Common node fields: `id`, `type`, `next` (node id | `"$end"` | transition list), `mode` (override defaultMode per node), `skippable` (bool + skip flag reason).

| type | Purpose | Extra fields |
|---|---|---|
| `question` | Ask one thing, commit one field | `fieldKey`, `prompt: {lang→text}`, `promptAudio` hints, `answer` (§3), `confirm` (`always|lowConfidence|never`), `helpText` |
| `info` | Statement, no answer (instructions, reassurance) | `prompt` |
| `branch` | Conditional routing | `cases: [{when: <expr §4>, next}], else` |
| `computed` | Derive a field from prior answers (no user interaction) | `fieldKey`, `expr` |
| `upload` | Document/photo capture | `fieldKey`, `accept` (mime list), `maxFiles` |
| `handoff` | Route to human assistance | `reason`, resumable flag |
| `checkpoint` | Explicit save + progress marker (camp/offline resume points) | — |
| `end` | Terminal; triggers output projection | `outcome` (completed etc.) |
| `action` *(Doc-13 amendment, S06A)* | Audited side-effect executed server-side | `actionKind: book|reschedule|cancel|notify|escalate`, `params` (expr-bound to fields), `onFailure: next` — emits `action.requested/executed/failed`; the only DSL construct that mutates anything outside the session; registry of allowed kinds is code-owned, never extensible from DSL |

`next` as transition list: `[{when: <expr>, next: "nodeId"}, ...]` evaluated in order, with mandatory final unconditional entry.

## 3. Answer schemas (`fields.<fieldKey>` and `question.answer`)

Each field: `{ "type": <below>, "required": bool, ...typeParams }`

| type | params | Deterministic parse first? |
|---|---|---|
| `choice` | `options: [{value, label:{lang→text}, icon?, synonyms:{lang→[..]}}]` | yes — synonym match before LLM |
| `multiChoice` | same + `max` | yes |
| `boolean` | `trueSynonyms/falseSynonyms` per lang | yes |
| `number` | `min, max, unit, unitSynonyms` | yes (regex + numeral words hi/mr/en) |
| `duration` | normalized to `{value, unit: days|weeks|months|years}` | yes |
| `date` | `min, max`, relative allowed ("kal", "last week") | LLM-assisted |
| `text` | `maxLen`, `piiLevel` | STT transcript as-is; LLM cleanup optional |
| `phone` / `id` | format regex | yes |
| `bodyLocation` | picker regions list | touch-first |
| `media` | via `upload` node | n/a |

Extraction ladder (binding, implements ADR-008 economics): 1) touch input → done; 2) deterministic parser on transcript (synonyms, numerals, regex); 3) LLM extraction with JSON-schema-constrained output returning `{value, confidence, ambiguity[]}`; 4) clarification question (≤ `clarificationMaxAttempts`); 5) fallback to touch; 6) skip + `field.missing` flag if skippable.

## 4. Expression grammar (conditions & validations)

Small, safe, non-Turing grammar evaluated by our interpreter — **never `eval`**:

```
expr    := or ; or := and ("||" and)* ; and := cmp ("&&" cmp)*
cmp     := operand (("=="|"!="|">"|">="|"<"|"<=") operand)? | "!" cmp | "(" expr ")"
operand := field ref `f.<fieldKey>` | literal (string|number|bool|null)
         | fn: exists(f.x) | contains(f.x, "v") | count(f.x) | ageYears(f.dob)
```

Validator rejects references to fieldKeys not defined in `fields` or not committed before the node where the expression runs (topological check). Cross-field validations: `{ "id", "when": <expr>, "assert": <expr>, "message": {lang→text}, "severity": "block|warn" }`.

## 5. Red-flag rules

```jsonc
{ "id": "chest_pain_breathless", "when": "f.chest_pain == true && f.breathlessness == true",
  "severity": "high",            // low | medium | high
  "escalation": "alert_staff_immediately",   // enum: flag_only | notify_review | alert_staff_immediately
  "patientMessage": { "en": "A staff member will assist you shortly." }  // NEVER advice/diagnosis
}
```

Evaluated after every `field.committed`. `high` + `alert_staff_immediately` moves session to `human_assistance_needed` and fires staff notification. Patient-facing text is validated against the deny-list (ADR-015).

## 6. Language & audio

Every `prompt`/`label`/`message` is a `{lang→text}` map; missing languages fall back to `languages[0]` and are reported by the validator as warnings (errors on publish if a declared language has <100% coverage of required prompts). Prompt audio resolution order at runtime: human-recorded (pack manifest) → TTS cache by contentHash → live TTS (logged as cache miss for pre-render job).

## 7. Validation & publishing (compiler contract)

`packages/dsl` exposes `validate(doc) → {errors[], warnings[], compiledGraph}` checking: Zod shape; unique ids/fieldKeys; graph reachability (every node reachable from start, every path reaches `end`); no cycles except via explicit `clarification`; expression type-checks; field-before-use ordering; language coverage; red-flag/patientMessage deny-list; review policy references. `compiledGraph` stores adjacency + per-node precomputed expression ASTs. Publishing requires zero errors; the compiled graph is frozen into `workflow_versions`.

## 8. Versioning

Semver: patch = text/translation changes, minor = added optional nodes/fields, major = removed/renamed fields or changed answer types. Sessions pin the exact version. Packs (`packs/` dir + pack tables) are DSL documents plus prompt-audio manifests and summary templates, versioned identically.
