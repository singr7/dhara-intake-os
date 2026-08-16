-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('owner', 'admin', 'reviewer', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('platformOwner', 'platformOps', 'platformSupport');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('touch', 'hybrid', 'conversational', 'assisted');

-- CreateEnum
CREATE TYPE "SessionSurface" AS ENUM ('pwa', 'kiosk', 'phone', 'whatsapp', 'assisted');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('created', 'consent_pending', 'in_progress', 'clarification_needed', 'human_assistance_needed', 'completed', 'reviewed', 'exported', 'failed', 'abandoned');

-- CreateEnum
CREATE TYPE "EvidenceActorKind" AS ENUM ('system', 'patient', 'operator', 'provider');

-- CreateEnum
CREATE TYPE "FieldValueStatus" AS ENUM ('committed', 'corrected', 'reviewOverridden');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('touch', 'voice', 'operator');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('promptAudio', 'responseAudio', 'document', 'export');

-- CreateEnum
CREATE TYPE "RetentionClass" AS ENUM ('audio', 'document', 'export');

-- CreateEnum
CREATE TYPE "PromptAudioSource" AS ENUM ('recorded', 'tts');

-- CreateEnum
CREATE TYPE "CostKind" AS ENUM ('stt', 'llm', 'tts', 'realtime', 'telephony', 'notification');

-- CreateEnum
CREATE TYPE "ReviewActionKind" AS ENUM ('approve', 'correct', 'return', 'escalate');

-- CreateEnum
CREATE TYPE "ExportTargetKind" AS ENUM ('webhook', 'pdf', 'sheets', 'whatsapp', 'emr');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "ConfigScope" AS ENUM ('platform', 'tenant');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('stt', 'llm', 'tts', 'realtime', 'telephony', 'notification');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "sessions_auth" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "packRef" JSONB,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "semver" TEXT NOT NULL,
    "dslDocument" JSONB NOT NULL,
    "compiledGraph" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" UUID,
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "workflowVersionId" UUID NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "surface" "SessionSurface" NOT NULL,
    "language" TEXT NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'created',
    "currentNodeId" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "patientRef" JSONB,
    "operatorUserId" UUID,
    "intakeTokenHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "abandonReason" TEXT,
    "costTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "redFlagCount" INTEGER NOT NULL DEFAULT 0,
    "eventSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "intake_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_events" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_values" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "provenance" JSONB NOT NULL,
    "confirmedByPatient" BOOLEAN NOT NULL DEFAULT false,
    "correctedBy" UUID,
    "status" "FieldValueStatus" NOT NULL DEFAULT 'committed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "purposeVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "textShown" TEXT NOT NULL,
    "audioObjectId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_objects" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID,
    "kind" "MediaKind" NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "retentionClass" "RetentionClass" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_audio" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "workflowVersionId" UUID,
    "nodeId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "source" "PromptAudioSource" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mediaObjectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_audio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID,
    "stepSeq" INTEGER,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" "CostKind" NOT NULL,
    "units" JSONB NOT NULL DEFAULT '{}',
    "costPaise" INTEGER NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" "ReviewActionKind" NOT NULL,
    "fieldKey" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_targets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "ExportTargetKind" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "responseMeta" JSONB,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "objectRef" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "capPaise" INTEGER NOT NULL DEFAULT 0,
    "softAlertPct" INTEGER NOT NULL DEFAULT 80,
    "hardStop" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" UUID NOT NULL,
    "scope" "ConfigScope" NOT NULL,
    "tenantId" UUID,
    "kind" "ProviderKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "credentialsRef" TEXT,
    "langs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_policies" (
    "id" UUID NOT NULL,
    "scope" "ConfigScope" NOT NULL,
    "tenantId" UUID,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_versions" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "semver" TEXT NOT NULL,
    "dslDocument" JSONB NOT NULL,
    "promptManifest" JSONB NOT NULL DEFAULT '{}',
    "changelog" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_auth_tokenHash_key" ON "sessions_auth"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_auth_userId_idx" ON "sessions_auth"("userId");

-- CreateIndex
CREATE INDEX "sessions_auth_expiresAt_idx" ON "sessions_auth"("expiresAt");

-- CreateIndex
CREATE INDEX "workflows_tenantId_idx" ON "workflows"("tenantId");

-- CreateIndex
CREATE INDEX "workflow_versions_workflowId_idx" ON "workflow_versions"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflowId_semver_key" ON "workflow_versions"("workflowId", "semver");

-- CreateIndex
CREATE UNIQUE INDEX "intake_sessions_intakeTokenHash_key" ON "intake_sessions"("intakeTokenHash");

-- CreateIndex
CREATE INDEX "intake_sessions_tenantId_state_idx" ON "intake_sessions"("tenantId", "state");

-- CreateIndex
CREATE INDEX "intake_sessions_workflowVersionId_idx" ON "intake_sessions"("workflowVersionId");

-- CreateIndex
CREATE INDEX "evidence_events_sessionId_createdAt_idx" ON "evidence_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "evidence_events_tenantId_type_idx" ON "evidence_events"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_events_sessionId_seq_key" ON "evidence_events"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "field_values_tenantId_idx" ON "field_values"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "field_values_sessionId_fieldKey_key" ON "field_values"("sessionId", "fieldKey");

-- CreateIndex
CREATE INDEX "consent_records_sessionId_idx" ON "consent_records"("sessionId");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_idx" ON "consent_records"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "media_objects_s3Key_key" ON "media_objects"("s3Key");

-- CreateIndex
CREATE INDEX "media_objects_tenantId_retentionClass_createdAt_idx" ON "media_objects"("tenantId", "retentionClass", "createdAt");

-- CreateIndex
CREATE INDEX "media_objects_sessionId_idx" ON "media_objects"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_audio_workflowVersionId_nodeId_lang_voice_contentHas_key" ON "prompt_audio"("workflowVersionId", "nodeId", "lang", "voice", "contentHash");

-- CreateIndex
CREATE INDEX "cost_records_tenantId_createdAt_idx" ON "cost_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_records_sessionId_idx" ON "cost_records"("sessionId");

-- CreateIndex
CREATE INDEX "review_actions_sessionId_idx" ON "review_actions"("sessionId");

-- CreateIndex
CREATE INDEX "review_actions_tenantId_createdAt_idx" ON "review_actions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "export_targets_tenantId_idx" ON "export_targets"("tenantId");

-- CreateIndex
CREATE INDEX "export_records_sessionId_idx" ON "export_records"("sessionId");

-- CreateIndex
CREATE INDEX "export_records_tenantId_status_idx" ON "export_records"("tenantId", "status");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_createdAt_idx" ON "audit_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_userId_createdAt_idx" ON "audit_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenantId_period_key" ON "budgets"("tenantId", "period");

-- CreateIndex
CREATE INDEX "provider_configs_scope_kind_active_idx" ON "provider_configs"("scope", "kind", "active");

-- CreateIndex
CREATE INDEX "routing_policies_scope_active_idx" ON "routing_policies"("scope", "active");

-- CreateIndex
CREATE UNIQUE INDEX "packs_key_key" ON "packs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "pack_versions_packId_semver_key" ON "pack_versions"("packId", "semver");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions_auth" ADD CONSTRAINT "sessions_auth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_values" ADD CONSTRAINT "field_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_values" ADD CONSTRAINT "field_values_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_audio" ADD CONSTRAINT "prompt_audio_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_audio" ADD CONSTRAINT "prompt_audio_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_audio" ADD CONSTRAINT "prompt_audio_mediaObjectId_fkey" FOREIGN KEY ("mediaObjectId") REFERENCES "media_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_targets" ADD CONSTRAINT "export_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "intake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "export_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_policies" ADD CONSTRAINT "routing_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_packId_fkey" FOREIGN KEY ("packId") REFERENCES "packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
