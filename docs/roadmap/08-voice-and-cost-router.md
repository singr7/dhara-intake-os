# 08 — Voice Orchestration & Cost-Routing Engine

## 1. Principles

1. **The cheapest token is the one you do not generate.** Pre-recorded/cached prompts, touch answers for structured questions, STT only for short utterances, LLM only for ambiguity/extraction, realtime models only in Mode 3.
2. **Provider-agnostic** (ADR-009): no provider SDK type escapes its adapter.
3. **Every routing decision is evidence**: provider, model, latency, cost recorded per step.
4. **Budgets are hard**: at cap, terminate the upstream provider connection *first*, then close gracefully (demo-proven with the 2.5-min OpenAI cap).
5. **Degrade, never dead-end**: any provider failure falls back down the ladder and ultimately to touch mode; intake capture must survive total AI outage.

## 2. Adapter interfaces (`packages/providers`)

```ts
interface SttAdapter {
  id: string; langs: string[];
  stream(opts: {lang?, sampleRate: 16000, interim: boolean}): SttStream; // push PCM16, get partials/finals + confidence + langDetected
  priceEstimate(seconds: number): Paise;
}
interface LlmAdapter {
  id: string;
  extract<T>(args: {schema: ZodSchema<T>, system: string, input: string, promptVersion: string}): Promise<{value: T, confidence: number, usage}>;
  // JSON-schema-constrained only; no free-form generation API exposed
}
interface TtsAdapter { id: string; voices: VoiceInfo[]; synth(text, lang, voice): Promise<AudioBuffer>; }
interface RealtimeAdapter {  // Mode 3; wraps demo relay learnings
  connect(opts: {instruction, voice, inputRate: 16000, outputRate: 24000}): RealtimeSession;
  // RealtimeSession: sendAudio(), onAudio/onTurn/onInterrupted/onUsage, terminate() — terminate() must kill billing immediately
}
```

v1 implementations: STT — Google STT v2 (hi/mr), Deepgram or OpenAI whisper-class (en); LLM — Gemini Flash primary, OpenAI mini fallback; TTS — Google TTS (hi/mr/en) behind the content-hash cache; Realtime — Gemini Live + OpenAI Realtime (port demo relays to TS). Verify current model IDs/pricing at implementation time (demo lesson: model-id drift between AI Studio and Vertex broke sessions silently).

## 3. The extraction ladder (per answer — cost order)

| Rung | Mechanism | Typical cost |
|---|---|---|
| 0 | Touch input | ₹0 |
| 1 | Deterministic parse (synonyms, numeral words, regex, units) | ₹0 |
| 2 | Cheap STT final transcript → deterministic parse | STT seconds only |
| 3 | LLM extraction, schema-constrained, tiny prompt | ~₹0.05–0.3 |
| 4 | One clarification re-ask (cached clarification audio) | + STT |
| 5 | Touch fallback (auto after `voiceFallbackAfterFailures`) | ₹0 |

Prompt side: fixed prompts are human-recorded or TTS-rendered **once** per `(text-hash, lang, voice)` and served from S3/CDN. Live TTS is a logged cache miss that enqueues a pre-render job.

## 4. Routing policy (data-driven, `routing_policies.rules`)

```jsonc
{ "stt":  [ {"when": {"lang": "mr"}, "use": "google-stt-v2"},
            {"when": {"lang": "en"}, "use": "deepgram-nova"},
            {"default": "google-stt-v2"} ],
  "llm":  [ {"when": {"task": "extract"}, "use": "gemini-flash"},
            {"fallback": ["openai-mini"]} ],
  "tts":  [ {"when": {"lang": "hi"}, "use": "google-tts", "voice": "hi-IN-..."} ],
  "realtime": [ {"when": {"mode": "conversational"}, "use": "gemini-live",
                 "fallback": ["openai-realtime"], "maxSessionSec": 300} ] }
```

Router resolves `(kind, context{lang, task, mode, tenant})` → adapter chain; on failure/timeout it walks the fallback list, emitting `fallback.triggered`. Platform-scope policy is the default; tenant-scope overrides (enterprise/BYOM later slots in here).

## 5. Cost metering & budgets

- Every adapter call writes `cost_records` (units + paise + latency) linked to session/step; `usage` events from realtime providers are captured mid-call (demo's token-telemetry panel generalized).
- Session cap: from DSL `settings.maxCostPaise` + `maxDurationSec` — on breach, realtime upstream terminated first, session degrades to touch to finish capture.
- Tenant budget: monthly `capPaise`; soft alert at pct; hard stop switches all tenant sessions to touch-only mode (capture never stops).
- Headline analytics metric: **cost per completed intake** = Σ cost_records / completed sessions, by workflow, mode, and provider mix. Also track cost per *abandoned* intake (waste).

## 6. Client audio pipeline (runner) — port from demo, keep the lessons

- Shared module-level `AudioContext` unlocked inside a user gesture (`unlockAudio()`; the consent tap doubles as the unlock gesture). Never create contexts on push events (demo Phase-1 root cause).
- Capture: `getUserMedia({echoCancellation, noiseSuppression, autoGainControl})` → AudioWorklet → downsample 16 kHz PCM16 → 100 ms binary WS frames.
- Playback: scheduled gapless AudioBuffer queue; `interrupted` flushes it (barge-in).
- VAD: client-side energy VAD to gate frames (saves STT seconds); `maxUtteranceSec` hard stop.
- Wake lock during active session; released on completion (battery lesson from demo).
- All prompt audio as opus files via `<audio>`/decoded buffers, cache-first (Workbox), enabling offline camp mode later.

## 7. Noisy/rural mode profile

A workflow-level toggle (`settings.noiseProfile: "high"`) that: biases modes to touch-first, shortens utterance windows, requires confirmation on every voice answer, raises deterministic-parse thresholds, enables operator-assist shortcut on every screen, and enlarges touch targets. This profile is a first-class tested configuration (harness has a noisy-audio suite, doc 12), not an afterthought.

## 8. Local models (M8) & BYOM (M9)

Local slots implement the same adapters: whisper-class STT (hi/mr eval first), Piper-class TTS for fixed voices, small local LLM for classification/extraction — served from a GPU box as a separate service (Python allowed here, ADR-003). BYOM = tenant-scoped `provider_configs` pointing at customer endpoints; enabling any new provider/model requires a passing harness run (doc 12 §5) recorded against its config — this is the gate that makes BYOM safe to sell.
