-- =============================================================
-- Migration 017: Howard moves from per-aircraft to per-user threads
-- =============================================================
-- Howard used to live in one thread per (user, aircraft). Pilots want
-- one ongoing conversation with their advisor that can cover any
-- aircraft they have access to, so threads are now user-scoped and the
-- target aircraft is resolved per tool call via a `tail` parameter.
--
-- Pre-prod reset: existing per-aircraft threads don't map cleanly to
-- the new shape, so wipe Howard history. Proposed actions tied to
-- those threads cascade-delete via the existing FK (015).
-- =============================================================

BEGIN;

-- Clear Howard state. Proposed actions cascade via FK to threads.
DELETE FROM aft_howard_messages;
DELETE FROM aft_howard_threads;

-- Drop the per-aircraft unique constraint and the aircraft_id column
ALTER TABLE aft_howard_threads
  DROP CONSTRAINT IF EXISTS aft_howard_threads_aircraft_id_user_id_key;
ALTER TABLE aft_howard_threads
  DROP COLUMN IF EXISTS aircraft_id;

-- One thread per user going forward
ALTER TABLE aft_howard_threads
  ADD CONSTRAINT aft_howard_threads_user_id_unique UNIQUE (user_id);

COMMIT;
