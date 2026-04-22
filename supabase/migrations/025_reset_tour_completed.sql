-- =============================================================
-- Migration 025: Reset tour_completed for all users
-- =============================================================
-- Migration 024 backfilled `tour_completed=true` for existing users
-- so they wouldn't be yanked into the spotlight tour on next login.
-- We now want every user — new AND existing — to see the tour at
-- least once so the onboarding experience lands.
--
-- This only flips `tour_completed`. `completed_onboarding` stays
-- untouched, so existing users with aircraft DON'T re-run the
-- welcome modal or the Howard-guided chat.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

UPDATE aft_user_roles
   SET tour_completed = false;

COMMIT;
