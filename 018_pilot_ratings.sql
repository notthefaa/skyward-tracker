-- Pilot FAA ratings on the user profile.
-- Stored as a simple TEXT[] of canonical rating codes. The app layer
-- owns the whitelist (see src/lib/types.ts FAA_RATINGS); this column
-- is just a bag of strings so we can evolve the list without a schema
-- change each time. Howard reads this to tailor tone and detail.

ALTER TABLE aft_user_roles
  ADD COLUMN IF NOT EXISTS faa_ratings TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN aft_user_roles.faa_ratings IS
  'Pilot FAA ratings / certificates held by the user (e.g. PPL, IFR, CPL, ATP, CFI, CFII, MEI, ME, Student, Sport, Recreational). App-level whitelist in src/lib/types.ts. Purely for Howard context + UI; not used for authorization.';
