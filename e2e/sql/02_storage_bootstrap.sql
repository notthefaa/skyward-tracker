-- =============================================================
-- Test project bootstrap: storage buckets + RLS policies
-- =============================================================
-- Captured from prod 2026-05-05 via pg_dump-equivalent psql query.
-- All 5 buckets are PRIVATE; access is via signed URLs only.
-- 9 RLS policies on storage.objects gate per-bucket auth/access.
-- =============================================================

-- ---- Buckets ----
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('aft_aircraft_avatars',   'aft_aircraft_avatars',   false, NULL, NULL),
  ('aft_aircraft_documents', 'aft_aircraft_documents', false, NULL, NULL),
  ('aft_event_attachments',  'aft_event_attachments',  false, NULL, NULL),
  ('aft_note_images',        'aft_note_images',        false, NULL, NULL),
  ('aft_squawk_images',      'aft_squawk_images',      false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;


-- ---- RLS policies ----
-- Drop-and-recreate idempotently
DROP POLICY IF EXISTS "Allow admin insert avatars"             ON storage.objects;
DROP POLICY IF EXISTS "Allow admin update avatars"             ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated insert images"      ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated insert note images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read note images"   ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update images"      ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update note images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read avatars"              ON storage.objects;
DROP POLICY IF EXISTS "Allow public read squawk images"        ON storage.objects;

CREATE POLICY "Allow admin insert avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aft_aircraft_avatars');

CREATE POLICY "Allow admin update avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'aft_aircraft_avatars');

CREATE POLICY "Allow authenticated insert images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aft_squawk_images');

CREATE POLICY "Allow authenticated insert note images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aft_note_images');

CREATE POLICY "Allow authenticated read note images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'aft_note_images');

CREATE POLICY "Allow authenticated update images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'aft_squawk_images');

CREATE POLICY "Allow authenticated update note images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'aft_note_images');

CREATE POLICY "Allow public read avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'aft_aircraft_avatars');

CREATE POLICY "Allow public read squawk images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'aft_squawk_images');
