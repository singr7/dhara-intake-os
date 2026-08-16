/**
 * @dhara/db — the data layer (doc 05, ADR-002, ADR-010, ADR-011).
 *
 * Everything the rest of the workspace needs comes through here: the tenant-scoped client,
 * the tenant context helpers, and the generated model types and enums. `PrismaClient`
 * itself is deliberately *not* re-exported — the raw client is reachable only via
 * `platformOps`, and ESLint blocks `@prisma/client` imports outside this package.
 */

export const DB_PACKAGE = '@dhara/db' as const;

export { db, platformOps, checkDatabase, disconnectDatabase, type Db } from './client.js';
export {
  runWithTenant,
  currentTenantContext,
  currentTenantId,
  requireTenantId,
  MissingTenantContextError,
  type TenantContext,
} from './tenancy.js';
export { tenantScopedModels } from './tenant-scope.js';
export { appendOnlyModels, AppendOnlyViolationError } from './append-only.js';

// Enums are values (used in comparisons and as literal unions across the API surface).
export {
  ConfigScope,
  ConsentMethod,
  CostKind,
  EvidenceActorKind,
  ExportStatus,
  ExportTargetKind,
  FieldValueStatus,
  MediaKind,
  PlatformRole,
  PromptAudioSource,
  ProviderKind,
  RetentionClass,
  ReviewActionKind,
  SessionMode,
  SessionState,
  SessionSurface,
  TenantRole,
  TenantStatus,
  UserStatus,
  WorkflowStatus,
} from '@prisma/client';

export type {
  AuditEvent,
  AuthSession,
  Budget,
  ConsentRecord,
  CostRecord,
  EvidenceEvent,
  ExportRecord,
  ExportTarget,
  FieldValue,
  IntakeSession,
  MediaObject,
  Pack,
  PackVersion,
  PlatformUser,
  PromptAudio,
  ProviderConfig,
  ReviewAction,
  RoutingPolicy,
  Tenant,
  User,
  UserRole,
  Workflow,
  WorkflowVersion,
} from '@prisma/client';
