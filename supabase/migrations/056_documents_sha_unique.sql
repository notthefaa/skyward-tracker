-- =============================================================
-- Migration 056: enforce SHA-256 uniqueness on live documents
-- =============================================================
-- The /api/documents POST does an application-side dup check
-- (`SELECT ... WHERE aircraft_id = ? AND sha256 = ? AND
-- deleted_at IS NULL`) before committing. Without a corresponding
-- unique constraint at the DB level, two concurrent uploads of the
-- same PDF on the same aircraft can both pass the SELECT (neither
-- has been written yet) and then both succeed with the INSERT —
-- two physical doc rows pointing at the same content + double-
-- billed OpenAI embeddings.
--
-- The existing `idx_documents_sha` is just a btree for lookup
-- speed; replace it with a partial UNIQUE index so the second
-- INSERT 23505s and the route can surface a friendly dup-detected
-- 409 to the late submitter.
--
-- Pre-flight: this fails if there are already two live rows with
-- the same (aircraft_id, sha256). In a clean prod state the route's
-- pre-check has prevented that, but defend by surfacing the
-- conflict explicitly instead of silently leaving the migration
-- half-applied.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS guards mean re-running is
-- safe.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- Surface any pre-existing live duplicates loudly. If this raises,
-- the migration aborts before the index swap; the operator
-- soft-deletes one row of each pair and re-runs.
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT aircraft_id, sha256
    FROM aft_documents
    WHERE deleted_at IS NULL AND sha256 IS NOT NULL
    GROUP BY aircraft_id, sha256
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce sha256 uniqueness — % live (aircraft_id, sha256) duplicates exist. Soft-delete duplicates first.',
      v_dup_count;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_documents_sha;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_sha_unique
  ON aft_documents (aircraft_id, sha256)
  WHERE (deleted_at IS NULL);

COMMIT;
