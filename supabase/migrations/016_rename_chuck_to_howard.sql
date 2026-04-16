-- =============================================================
-- Migration 016: Rename Chuck → Howard
-- =============================================================
-- The AI copilot formerly known as "Chuck" is now "Howard". This
-- migration renames the physical tables, indexes, and policies so
-- the DB matches the new application-level naming. Data is preserved
-- (RENAME is metadata-only — no row copying).
-- =============================================================

BEGIN;

-- 1. Tables
ALTER TABLE IF EXISTS aft_chuck_threads RENAME TO aft_howard_threads;
ALTER TABLE IF EXISTS aft_chuck_messages RENAME TO aft_howard_messages;

-- 2. Indexes
ALTER INDEX IF EXISTS idx_chuck_threads_user RENAME TO idx_howard_threads_user;
ALTER INDEX IF EXISTS idx_chuck_messages_thread RENAME TO idx_howard_messages_thread;

-- 3. Policies — Postgres keeps the old names after a table rename, so
--    drop-and-recreate under the new naming for clarity.
DROP POLICY IF EXISTS "chuck_threads_select" ON aft_howard_threads;
DROP POLICY IF EXISTS "chuck_threads_insert" ON aft_howard_threads;
DROP POLICY IF EXISTS "chuck_messages_select" ON aft_howard_messages;
DROP POLICY IF EXISTS "chuck_messages_insert" ON aft_howard_messages;

CREATE POLICY "howard_threads_select" ON aft_howard_threads FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "howard_threads_insert" ON aft_howard_threads FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "howard_messages_select" ON aft_howard_messages FOR SELECT
  USING (thread_id IN (
    SELECT id FROM aft_howard_threads WHERE user_id = auth.uid()
  ));
CREATE POLICY "howard_messages_insert" ON aft_howard_messages FOR INSERT
  WITH CHECK (thread_id IN (
    SELECT id FROM aft_howard_threads WHERE user_id = auth.uid()
  ));

COMMIT;
