-- =============================================================
-- Migration 047: Rotate squawk access_token when squawk resolves
-- =============================================================
-- Migration 032 introduced per-squawk access tokens for the public
-- /squawk/[id] page (used in mechanic-notification emails). Those
-- tokens never expire, so a leaked URL gives perpetual read access
-- to the squawk row, tail number, photos, and owner contact even
-- after the squawk has been fixed and is no longer relevant.
--
-- Mitigation: rotate the token whenever a squawk transitions to
-- `resolved`. Old links go cold the moment the issue is closed;
-- the new token is only used internally (no email goes out on
-- resolve) so resolved squawks effectively become non-public.
--
-- Trigger fires on UPDATE when status changes to 'resolved' from
-- something else. Three known code paths set this status (direct
-- UI update in SquawksTab, Howard's proposeAction handler, and the
-- complete_mx_event_atomic RPC) plus any future ones — covering
-- this in the DB means we don't have to remember in each route.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION aft_squawks_rotate_token_on_resolve()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'resolved' AND COALESCE(OLD.status, '') <> 'resolved' THEN
    NEW.access_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aft_squawks_rotate_token_trg ON aft_squawks;
CREATE TRIGGER aft_squawks_rotate_token_trg
  BEFORE UPDATE OF status ON aft_squawks
  FOR EACH ROW
  EXECUTE FUNCTION aft_squawks_rotate_token_on_resolve();

COMMIT;
