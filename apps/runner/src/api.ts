import { healthSchema, type Health } from '@dhara/contracts';

export type RunnerHealth = Health;

/** Same-origin by default: nginx proxies /api to the API service (doc 10 §2). */
export const API_BASE = '/api/v1';

/**
 * Probes the API. Returns `null` instead of throwing — the runner must never dead-end a
 * patient on a network hiccup; every failure degrades to a waiting state (doc 07 §7).
 */
export async function fetchHealth(): Promise<RunnerHealth | null> {
  try {
    const response = await fetch(`${API_BASE}/health`, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return healthSchema.parse(await response.json());
  } catch {
    return null;
  }
}
