-- =============================================================
-- Migration 031: Track squawks whose MX notification email failed
-- =============================================================
-- When a pilot creates a squawk with "Notify MX?" checked, the
-- email send can fail silently (bad SMTP, rate limit, stale
-- contact). Previously the only signal was a 3-second toast that
-- vanished; nothing on the squawk card told the pilot the
-- mechanic never got notified.
--
-- This flag lets the squawk list surface "MX not notified — resend?"
-- as a persistent indicator until the pilot resends or manually
-- clears it.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_squawks
  ADD COLUMN IF NOT EXISTS mx_notify_failed boolean NOT NULL DEFAULT false;

COMMIT;
