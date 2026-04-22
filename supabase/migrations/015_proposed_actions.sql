-- =============================================================
-- Migration 015: Chuck proposed actions (propose-confirm model)
-- =============================================================
-- Chuck never writes directly. When it wants to create a
-- reservation / MX schedule / squawk resolution / note / equipment
-- entry, it inserts a row here with status='pending'. The user
-- confirms in-chat (tap Confirm on the card), which runs the actual
-- write via the existing API paths and flips the row to 'executed'.
--
-- Why a table instead of just including the action in tool_results?
-- Audit trail: which actions did Chuck propose, which did the user
-- confirm, which did they reject, and what was the final result.
-- Gives us "Chuck suggested X; you accepted" history.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS aft_proposed_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES aft_chuck_threads(id) ON DELETE CASCADE,
  message_id          uuid REFERENCES aft_chuck_messages(id) ON DELETE SET NULL,
  user_id             uuid NOT NULL REFERENCES auth.users(id),
  aircraft_id         uuid NOT NULL REFERENCES aft_aircraft(id),

  -- Action
  action_type         text NOT NULL CHECK (action_type IN (
    'reservation',
    'mx_schedule',
    'squawk_resolve',
    'note',
    'equipment'
  )),
  payload             jsonb NOT NULL,
  summary             text NOT NULL,              -- human-readable preview
  required_role       text NOT NULL DEFAULT 'access'
                      CHECK (required_role IN ('access', 'admin')),

  -- Lifecycle
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'executed', 'failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  confirmed_by        uuid REFERENCES auth.users(id),
  cancelled_at        timestamptz,
  executed_at         timestamptz,
  executed_record_id  uuid,                       -- the ID of the thing that got created
  executed_record_table text,                     -- which table the row was written to
  error_message       text
);

CREATE INDEX IF NOT EXISTS idx_proposed_actions_thread
  ON aft_proposed_actions (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposed_actions_user_pending
  ON aft_proposed_actions (user_id, status)
  WHERE status = 'pending';

ALTER TABLE aft_proposed_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proposed_actions_select" ON aft_proposed_actions;
CREATE POLICY "proposed_actions_select" ON aft_proposed_actions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "proposed_actions_update" ON aft_proposed_actions;
CREATE POLICY "proposed_actions_update" ON aft_proposed_actions FOR UPDATE
  USING (user_id = auth.uid());

-- No INSERT/DELETE policies — service role writes from the API,
-- user can only update their own pending rows (confirm/cancel).

COMMIT;
