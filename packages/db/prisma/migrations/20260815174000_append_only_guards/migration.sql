-- Structural guarantees for the evidence graph and published workflow versions.
--
-- Why triggers rather than `REVOKE UPDATE, DELETE` on the app role: a revoke only binds the
-- one role it names, so it silently stops protecting anything the moment a migration, a
-- console psql session, or a future service connects as someone else. A trigger is attached
-- to the table itself and holds for every connection, including superusers — and it fails
-- with a message that says why, which a permission error does not. The app-layer guard in
-- `packages/db/src/append-only.ts` is the second layer, not the primary one (ADR-010).

-- Escape hatch, deliberately narrow: transcript redaction at retention expiry (doc 05 §6)
-- must rewrite evidence payloads in place while preserving the row and its hash. Only the
-- retention worker (S17) may set this, and only inside its own transaction:
--   SET LOCAL dhara.append_only_override = 'on';
-- Nothing else in the codebase is permitted to emit that statement.
CREATE OR REPLACE FUNCTION dhara_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('dhara.append_only_override', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'append-only table "%": % is not permitted (ADR-010)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_events_append_only
  BEFORE UPDATE OR DELETE ON evidence_events
  FOR EACH ROW EXECUTE FUNCTION dhara_append_only();

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION dhara_append_only();

-- A published workflow version is frozen (ADR-007): sessions pin `workflowVersionId`, so
-- editing one retroactively rewrites the meaning of intakes that already happened. Drafts
-- (publishedAt IS NULL) stay editable; the publish transition itself is the one UPDATE that
-- is allowed to touch a row on its way from draft to published.
CREATE OR REPLACE FUNCTION dhara_workflow_version_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."publishedAt" IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'workflow_versions %: published version % is immutable (ADR-007)', TG_OP, OLD."semver"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_versions_frozen
  BEFORE UPDATE OR DELETE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION dhara_workflow_version_frozen();
