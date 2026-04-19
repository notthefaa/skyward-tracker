-- =============================================================
-- Migration 032: Squawk public-link access tokens
-- =============================================================
-- The /squawk/[id] public page currently queries aft_squawks by
-- squawk UUID with no auth, no token, no expiration. That URL is
-- included in mechanic-notification emails (so mechanics without
-- app accounts can view details + photos). Anyone who gets that
-- link — forwards, email logs, browser history — can pull the
-- full squawk forever.
--
-- Mitigation: give each squawk a separate random token that isn't
-- the primary key, rotate it if it ever needs to be revoked, and
-- update the public page to query by token instead of id. The row
-- id keeps its role as the internal FK and stays out of URLs.
--
-- Tokens are 32 bytes of cryptographic randomness (base64url);
-- collision-resistant enough that we don't need a retry loop.
-- Existing rows are backfilled so old squawks keep working (the
-- mechanic email template is also updated to use tokens going
-- forward).
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_squawks
  ADD COLUMN IF NOT EXISTS access_token text UNIQUE;

-- Backfill existing rows with fresh tokens. pgcrypto's gen_random_bytes
-- is seeded from the OS CSPRNG; base64 + strip '=' for URL-safety.
UPDATE aft_squawks
SET access_token = replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '')
WHERE access_token IS NULL;

ALTER TABLE aft_squawks
  ALTER COLUMN access_token SET NOT NULL;

-- New rows get a token automatically on insert so app code doesn't
-- have to remember.
CREATE OR REPLACE FUNCTION aft_squawks_set_access_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aft_squawks_access_token_trg ON aft_squawks;
CREATE TRIGGER aft_squawks_access_token_trg
  BEFORE INSERT ON aft_squawks
  FOR EACH ROW
  EXECUTE FUNCTION aft_squawks_set_access_token();

CREATE INDEX IF NOT EXISTS idx_aft_squawks_access_token ON aft_squawks (access_token);

COMMIT;
