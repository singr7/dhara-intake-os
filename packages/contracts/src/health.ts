import { z } from 'zod';

/**
 * `GET /api/v1/health` contract (doc 07 §1, doc 10 §4).
 *
 * S01 reports placeholders (`false`) — real db/redis/s3 probes land in S02, provider-key
 * presence in S07. Health must expose provider-key presence: a silent no-key fallback
 * cost the demo a day of debugging.
 */
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  db: z.boolean(),
  redis: z.boolean(),
  s3: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;
