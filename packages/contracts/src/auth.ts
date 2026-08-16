import { z } from 'zod';

/**
 * Auth contracts (doc 07 §1, ADR-012).
 *
 * Server-side sessions with an HttpOnly cookie — no bearer tokens in JavaScript reach, no
 * third-party auth SaaS (India data residency, and clinics do not have Google Workspace).
 */

/** Tenant RBAC roles (doc 05 §2, doc 09 §4). Mirrors the `TenantRole` database enum. */
export const tenantRoles = ['owner', 'admin', 'reviewer', 'operator', 'viewer'] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const platformRoles = ['platformOwner', 'platformOps', 'platformSupport'] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const AUTH_COOKIE_NAME = 'dhara_session';

export const loginRequestSchema = z.object({
  /** Users are unique per tenant, so the slug is part of the credential (ADR-011). */
  tenantSlug: z.string().min(1).max(64),
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  tenantId: z.string(),
  tenantSlug: z.string(),
  roles: z.array(z.enum(tenantRoles)),
  platformRoles: z.array(z.enum(platformRoles)),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const meResponseSchema = z.object({ user: authUserSchema });
export const loginResponseSchema = z.object({ user: authUserSchema });
export const logoutResponseSchema = z.object({ ok: z.literal(true) });
