-- Migration 10: remove the webhooks feature.
--
-- The /admin/webhooks page, the REST surface, the dispatch helper used by
-- the API + worker, and the supporting repo were all ripped out in the
-- same change set. Drop the schema artefacts so nothing references the
-- unused table or its enum type going forward.
--
-- Idempotent: re-running this migration against a DB that's already been
-- cleaned is a no-op. Reapplying after a partial failure is safe.

DROP TABLE IF EXISTS webhooks;
DROP TYPE IF EXISTS webhook_event;
