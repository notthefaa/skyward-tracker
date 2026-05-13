-- 067_proposed_actions_phase1_phase2_types.sql
--
-- Howard action-taker Phases 1–3 expanded `ActionType` from 6 values
-- to 16, but the aft_proposed_actions CHECK constraint last updated
-- in migration 024 only allowed the original 6. Result: every new
-- Howard write tool (propose_flight_log / propose_maintenance_item /
-- propose_squawk / propose_vor_check / propose_oil_log /
-- propose_tire_check / propose_reservation_cancel /
-- propose_squawk_defer / propose_pilot_invite /
-- propose_aircraft_update) hit a Postgres CHECK violation at insert
-- time, the executor threw, the tool dispatcher caught the throw
-- and returned a generic "Tool failed unexpectedly" — the pilot
-- saw Howard silently refuse to take any of the new actions.
--
-- Drop and re-add the constraint with the full set so propose-time
-- inserts succeed. Idempotent: DROP IF EXISTS handles a fresh DB.

BEGIN;

ALTER TABLE aft_proposed_actions
  DROP CONSTRAINT IF EXISTS aft_proposed_actions_action_type_check;

ALTER TABLE aft_proposed_actions
  ADD CONSTRAINT aft_proposed_actions_action_type_check
  CHECK (action_type IN (
    -- Original 6 (migrations 015 + 024).
    'reservation',
    'mx_schedule',
    'squawk_resolve',
    'note',
    'equipment',
    'onboarding_setup',
    -- Phase 1 — chat-native logging.
    'flight_log',
    'mx_item',
    'squawk',
    'vor_check',
    'oil_log',
    'tire_check',
    -- Phase 2 — admin / coordination.
    'reservation_cancel',
    'squawk_defer',
    'pilot_invite',
    'aircraft_update'
  ));

COMMIT;
