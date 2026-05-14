-- 068_howard_messages_archived_at.sql
--
-- The Howard Usage page reads token columns off aft_howard_messages,
-- but the AppShell 30-min idle effect was hard-DELETE-ing every row
-- in the user's thread (DELETE /api/howard). Net effect: a pilot who
-- left the app idle longer than 30 minutes saw the Usage page report
-- "No usage yet" with their last 30 days of work missing.
--
-- Soft-archive instead. The chat surface filters archived_at IS NULL
-- (so cold-start UX is unchanged — open the app the next day and
-- Howard greets you fresh). The Usage page counts all rows regardless
-- of archived_at, so token + cost history survives.
--
-- Bonus: the rows are now available for a future "past conversations"
-- view without a second migration.

BEGIN;

ALTER TABLE aft_howard_messages
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index keeps the live-conversation read path cheap. The chat
-- GET filters archived_at IS NULL and orders by created_at; this index
-- covers both without dragging in archived rows.
CREATE INDEX IF NOT EXISTS idx_aft_howard_messages_thread_active
  ON aft_howard_messages (thread_id, created_at)
  WHERE archived_at IS NULL;

COMMIT;
