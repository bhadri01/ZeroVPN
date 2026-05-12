-- Migration 9: remove the api_tokens feature.
--
-- The user-facing /app/api-tokens page, the /api-tokens REST surface, the
-- per-user issue/revoke flow, and the supporting repo + handler were all
-- ripped out in the same change set. Drop the schema artefacts so nothing
-- references the unused table or its enum type going forward.
--
-- Idempotent: re-running this migration against a DB that's already been
-- cleaned is a no-op. Reapplying after a partial failure is safe.

DROP TABLE IF EXISTS api_tokens;
DROP TYPE IF EXISTS api_token_scope;
