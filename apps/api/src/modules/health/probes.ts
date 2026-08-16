import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import type { ServerEnv } from '@dhara/contracts';
import { checkDatabase } from '@dhara/db';

/**
 * Dependency probes behind `GET /health` (doc 07 §1, doc 10 §4).
 *
 * Each probe answers one question — "would a real call work right now?" — and answers it by
 * making the cheapest version of that call, not by checking whether a client object exists.
 * A health endpoint that reports a dependency up because its constructor ran is worse than
 * no health endpoint: it converts an outage into a mystery.
 */

export interface Probes {
  db(): Promise<boolean>;
  redis(): Promise<boolean>;
  s3(): Promise<boolean>;
  close(): Promise<void>;
}

/** Probes must not hang the health check when a dependency is merely slow to die. */
const PROBE_TIMEOUT_MS = 2000;

async function withTimeout(operation: () => Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createProbes(env: ServerEnv): Probes {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // The health check owns its own failure reporting; ioredis retrying forever in the
    // background would keep the probe pending instead of returning `false`.
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  // Connection errors arrive as events; without a listener they become unhandled crashes.
  redis.on('error', () => {});

  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  return {
    db: () => withTimeout(() => checkDatabase().then((ok) => (ok ? ok : Promise.reject(ok)))),
    redis: () =>
      withTimeout(async () => {
        if (redis.status === 'end' || redis.status === 'wait') await redis.connect();
        return redis.ping();
      }),
    s3: () => withTimeout(() => s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET_AUDIO }))),
    async close() {
      redis.disconnect();
      s3.destroy();
    },
  };
}
