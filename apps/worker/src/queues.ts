import { Queue, type ConnectionOptions } from 'bullmq';

/**
 * Queue registry (doc 04 §1). S01 defines only `heartbeat`, which exists to prove the
 * api → redis → worker round-trip end-to-end. Real queues (extraction, summaries,
 * exports, tts-prerender, webhooks, eval-runs) are added in the sessions that need them.
 */
export const QUEUE_HEARTBEAT = 'heartbeat' as const;

export interface HeartbeatJob {
  emittedAt: string;
  /** Propagated from the API request that scheduled the job (doc 10 §4). */
  requestId?: string;
}

export function connectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    // BullMQ requires this for blocking commands.
    maxRetriesPerRequest: null,
  };
}

export function createHeartbeatQueue(redisUrl: string): Queue<HeartbeatJob> {
  return new Queue<HeartbeatJob>(QUEUE_HEARTBEAT, { connection: connectionFromUrl(redisUrl) });
}
