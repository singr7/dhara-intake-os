/**
 * @dhara/providers — STT / LLM / TTS / Realtime adapter interfaces and implementations (doc 08).
 *
 * ADR-009: no provider SDK type may leak beyond its adapter. S01 ships the boundary and the
 * adapter-kind vocabulary only; concrete adapters land in S07, the cost router in S16.
 * M1 contains no STT/TTS/LLM code at all (M1 sequencing rule 1).
 */

export const providerKinds = ['stt', 'llm', 'tts', 'realtime'] as const;

export type ProviderKind = (typeof providerKinds)[number];
