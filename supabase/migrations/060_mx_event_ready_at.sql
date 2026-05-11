-- =============================================================
-- Migration 060: aft_maintenance_events.ready_at
-- =============================================================
-- Phase 5 of the mx-reminders cron currently picks its "awaiting
-- logbook entry" anchor by filtering mechanic status_update messages
-- and taking the oldest one as the assumed mark_ready timestamp. But
-- mechanics emit status_update messages from three branches in
-- /api/mx-events/respond (suggest_item, decline, mark_ready), and
-- suggest_item has no status guard — a mechanic can add a line item
-- before or after marking ready. Either case puts an extra status_update
-- in the log and the message-ordering heuristic picks the wrong one,
-- making the 3-day pickup nudge fire too early.
--
-- Anchor the nudge on the actual status flip instead. mark_ready writes
-- ready_at = now() on the event row; Phase 5 uses ready_at as the anchor
-- and ignores message ordering entirely.
--
-- Backfill picks the most recent mechanic status_update on each
-- ready_for_pickup event. That's not necessarily mark_ready (a later
-- suggest_item could be more recent), but it's a reasonable
-- approximation for pre-migration events and going forward the column
-- is set authoritatively at mark_ready time. After the cron tick that
-- runs against backfilled data, all newly-ready events will have
-- accurate timestamps.
--
-- Idempotent: column add is IF NOT EXISTS; backfill only runs against
-- rows where ready_at IS NULL.

ALTER TABLE aft_maintenance_events
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

UPDATE aft_maintenance_events ev
  SET ready_at = COALESCE(
    (SELECT MAX(m.created_at)
       FROM aft_event_messages m
      WHERE m.event_id = ev.id
        AND m.sender = 'mechanic'
        AND m.message_type = 'status_update'),
    ev.created_at
  )
WHERE ev.status = 'ready_for_pickup'
  AND ev.ready_at IS NULL;
