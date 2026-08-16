import { platformOps } from '@dhara/db';

/**
 * Platform audit trail (doc 09 §4) — append-only, and deliberately separate from the
 * evidence graph. Evidence records what happened *to an intake*; audit records what *staff
 * and the platform* did: logins, session views, media access, exports, deletions, config
 * and key changes. Breach-scope questions are answered from this table.
 *
 * Written through `platformOps.guarded`: audit rows have a nullable tenant (platform-level
 * actions have none), so the tenant-scoped client is the wrong tool — but the append-only
 * guard still applies.
 */

export interface AuditInput {
  action: string;
  objectRef?: Record<string, unknown>;
  tenantId?: string | null;
  userId?: string | null;
  ip?: string | null;
}

/**
 * Records an audit row. Never throws: an audit write must not be able to fail a request
 * that already succeeded, and a lost row is visible as a gap. Failures are surfaced through
 * the returned flag so callers can log them with request context.
 */
export async function audit(input: AuditInput): Promise<boolean> {
  try {
    await platformOps.guarded.auditEvent.create({
      data: {
        action: input.action,
        objectRef: (input.objectRef ?? {}) as never,
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        ip: input.ip ?? null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Audit action names in use. Kept as a list so the vocabulary stays greppable. */
export const auditActions = {
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  logout: 'auth.logout',
  workflowPublished: 'workflow.published',
} as const;
