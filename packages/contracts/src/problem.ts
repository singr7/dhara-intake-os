import { z } from 'zod';

/**
 * RFC 7807 problem+json envelope (doc 07 §7). Every API error response uses this shape;
 * `code` is the stable machine-readable contract clients switch on.
 */

export const problemCodes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'TENANT_SUSPENDED',
  'TOKEN_EXPIRED',
  'CONSENT_REQUIRED',
  'INVALID_TRANSITION',
  'DSL_VALIDATION_FAILED',
  'BUDGET_EXCEEDED',
  'PROVIDER_UNAVAILABLE',
  'RETENTION_PURGED',
  // Doc-13 amendment (appointments & access)
  'SLOT_TAKEN',
  'RESOURCE_CLOSED',
  'OPTED_OUT',
  // Generic transport-level codes
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'NOT_IMPLEMENTED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ProblemCode = (typeof problemCodes)[number];

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(problemCodes),
  detail: z.string().optional(),
  /**
   * RFC 7807 extension member. Used where one error is genuinely a list of them —
   * `DSL_VALIDATION_FAILED` carries every validator issue, because an author fixing a
   * workflow needs the whole list, not the first line of it.
   */
  issues: z.array(z.object({ code: z.string(), message: z.string(), path: z.string() })).optional(),
  requestId: z.string(),
});

export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Default HTTP status per stable code, so handlers only have to pick a code. */
export const problemStatusByCode: Record<ProblemCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  TENANT_SUSPENDED: 403,
  TOKEN_EXPIRED: 401,
  CONSENT_REQUIRED: 409,
  INVALID_TRANSITION: 409,
  DSL_VALIDATION_FAILED: 422,
  BUDGET_EXCEEDED: 402,
  PROVIDER_UNAVAILABLE: 503,
  RETENTION_PURGED: 410,
  SLOT_TAKEN: 409,
  RESOURCE_CLOSED: 409,
  OPTED_OUT: 409,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  NOT_IMPLEMENTED: 501,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};
