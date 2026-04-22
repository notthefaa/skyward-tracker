-- =============================================================
-- Migration 024: Onboarding flags on aft_user_roles
-- =============================================================
-- Howard-guided onboarding needs a durable "has this user finished
-- setup?" signal. Previously the app detected first-timers by
-- `role='pilot' AND aircraftList.length===0`, which is fragile —
-- anyone who deletes their only aircraft would get re-onboarded.
--
-- Two flags:
--   completed_onboarding — user has chosen an onboarding path and
--     finished it (either the Howard-guided chat OR the classic
--     PilotOnboarding form). Gates the welcome modal.
--   tour_completed — user has seen the 5-step spotlight tour.
--     Gates HowardTour.
--
-- Backfill: anyone who already has aircraft access is treated as
-- onboarded + toured, so existing users don't get yanked back into
-- the welcome flow.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_user_roles
  ADD COLUMN IF NOT EXISTS completed_onboarding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tour_completed boolean NOT NULL DEFAULT false;

-- Backfill: anyone with at least one aircraft access row is already
-- through onboarding and has been using the app — don't re-onboard.
UPDATE aft_user_roles ur
   SET completed_onboarding = true,
       tour_completed = true
 WHERE EXISTS (
   SELECT 1 FROM aft_user_aircraft_access a
    WHERE a.user_id = ur.user_id
 );

-- Global admins don't need the guided aircraft-setup flow either.
UPDATE aft_user_roles
   SET completed_onboarding = true,
       tour_completed = true
 WHERE role = 'admin';

-- ─── Proposed-actions table tweaks for onboarding ───────────────
-- Onboarding is the one proposed-action type that runs BEFORE any
-- aircraft exists for the user, so:
--   (a) 'onboarding_setup' is added to the allowed action_type list,
--   (b) aircraft_id becomes nullable (executor fills it in after the
--       insert completes).

ALTER TABLE aft_proposed_actions
  DROP CONSTRAINT IF EXISTS aft_proposed_actions_action_type_check;
ALTER TABLE aft_proposed_actions
  ADD CONSTRAINT aft_proposed_actions_action_type_check
  CHECK (action_type IN (
    'reservation',
    'mx_schedule',
    'squawk_resolve',
    'note',
    'equipment',
    'onboarding_setup'
  ));

ALTER TABLE aft_proposed_actions
  ALTER COLUMN aircraft_id DROP NOT NULL;

COMMIT;
