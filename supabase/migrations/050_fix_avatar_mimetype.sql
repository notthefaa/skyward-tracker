-- =============================================================
-- Migration 050: Backfill image/jpeg mimetype on avatar storage
-- =============================================================
-- Avatar uploads (PilotOnboarding + AircraftModal) wrote object
-- names without an extension and didn't pass an explicit
-- contentType to supabase.storage.upload(). Supabase fell back to
-- application/octet-stream, and Firefox's OpaqueResponseBlocking
-- refuses to render an octet-stream response inside an <img>
-- element. Result: every fleet card on Firefox shows a broken
-- avatar AND triggers the storage-sign rescue cascade, which is
-- the primary cause of the slow fleet-summary load.
--
-- Forward fix is in the upload code (extension + contentType).
-- This migration retroactively patches existing rows by updating
-- the storage.objects.metadata->>'mimetype' field, which is what
-- the storage HTTP layer actually reads when serving a file. No
-- need to re-upload — the bytes haven't changed.
--
-- Same problem could exist on aft_squawk_images / aft_note_images
-- if anything ever uploaded without an extension; the WHERE
-- clause filter only touches octet-stream rows so it's safe to
-- broaden if needed.
--
-- Run in the Supabase SQL Editor (service-role bypass required
-- to UPDATE storage.objects).
-- =============================================================

BEGIN;

UPDATE storage.objects
SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{mimetype}',
      '"image/jpeg"'::jsonb
    )
WHERE bucket_id = 'aft_aircraft_avatars'
  AND COALESCE(metadata->>'mimetype', 'application/octet-stream')
        IN ('application/octet-stream', '');

COMMIT;
