// Worker entrypoint. Same env contract as the API: invalid config crashes here, at boot.
import { Worker } from 'bullmq';
import pino from 'pino';
import { loadServerEnv } from '@dhara/contracts';
import { connectionFromUrl, createHeartbeatQueue, QUEUE_HEARTBEAT } from './queues.js';
import type { HeartbeatJob } from './queues.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  const env = loadServerEnv();
  const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
  const connection = connectionFromUrl(env.REDIS_URL);

  const worker = new Worker<HeartbeatJob>(
    QUEUE_HEARTBEAT,
    async (job) => {
      // No-op processor: it proves the queue round-trip (S01 acceptance) and nothing else.
      log.info({ jobId: job.id, emittedAt: job.data.emittedAt }, 'heartbeat job processed');
      return { ok: true };
    },
    { connection },
  );

  worker.on('ready', () => log.info({ queue: QUEUE_HEARTBEAT }, 'worker ready'));
  worker.on('failed', (job, error) => log.error({ jobId: job?.id, err: error }, 'job failed'));

  // Self-scheduled heartbeat so `docker compose up` shows the round-trip without any
  // other service running. Replaced by real producers from S04 onward.
  const queue = createHeartbeatQueue(env.REDIS_URL);
  const timer = setInterval(() => {
    void queue
      .add(
        'tick',
        { emittedAt: new Date().toISOString() },
        { removeOnComplete: 20, removeOnFail: 50 },
      )
      .catch((error: unknown) => log.error({ err: error }, 'failed to enqueue heartbeat'));
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down');
    clearInterval(timer);
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info({ queue: QUEUE_HEARTBEAT }, 'worker started');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
