-- =============================================================
-- Migration 038: AD applicability + Type Certificate
-- =============================================================
-- Deepens AD matching accuracy beyond simple make/model substring.
--
-- Changes:
--   1. aft_aircraft gains `type_certificate` (FAA TC number, e.g. "3A12").
--      Lets the matcher look at abstracts that reference the TC holder
--      even when the make name doesn't substring-match cleanly.
--   2. aft_airworthiness_directives gains `applicability_status`
--      ('applies' | 'does_not_apply' | 'review_required') and
--      `applicability_reason` (short human-readable explanation).
--      Computed on every sync; drives per-row UI pills.
--   3. aft_ad_applicability_cache — global, aircraft-agnostic cache of
--      LLM-parsed applicability. Keyed by (ad_number, source_hash) so
--      one Haiku call per AD serves every aircraft that matches it.
--
-- No LLM work happens at sync time. The cache is populated on demand
-- when a user clicks "Check applicability" on an AD card.
-- =============================================================

BEGIN;

-- 1. Type Certificate on aircraft
ALTER TABLE aft_aircraft
  ADD COLUMN IF NOT EXISTS type_certificate text;

COMMENT ON COLUMN aft_aircraft.type_certificate IS
  'FAA Type Certificate number (e.g. A13WE for the Cessna 172). When set, '
  'the AD matcher includes it as a search needle against Federal Register '
  'abstracts, which often cite TC holders explicitly.';

-- 2. Per-row applicability verdict on AD rows
ALTER TABLE aft_airworthiness_directives
  ADD COLUMN IF NOT EXISTS applicability_status text
    CHECK (applicability_status IS NULL OR applicability_status IN ('applies', 'does_not_apply', 'review_required')),
  ADD COLUMN IF NOT EXISTS applicability_reason text,
  ADD COLUMN IF NOT EXISTS applicability_checked_at timestamptz;

COMMENT ON COLUMN aft_airworthiness_directives.applicability_status IS
  'Verdict on whether this AD applies to THIS aircraft specifically. '
  '''applies'' = in-serial / matching engine, ''does_not_apply'' = out of range, '
  '''review_required'' = matched make/model but serial-level check was '
  'ambiguous. NULL = never checked (e.g. manual entries or pre-038 rows).';

-- 3. Global LLM-parsed applicability cache
CREATE TABLE IF NOT EXISTS aft_ad_applicability_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_number       text NOT NULL,
  source_hash     text NOT NULL,
  parsed          jsonb NOT NULL,
  parsed_at       timestamptz NOT NULL DEFAULT now(),
  parsed_by       text NOT NULL DEFAULT 'haiku',
  UNIQUE (ad_number, source_hash)
);

COMMENT ON TABLE aft_ad_applicability_cache IS
  'Global, aircraft-agnostic cache of LLM-parsed AD applicability. '
  'One Haiku parse per AD serves every aircraft that matches it. Keyed '
  'by (ad_number, source_hash) so content changes trigger a re-parse.';

COMMENT ON COLUMN aft_ad_applicability_cache.parsed IS
  'Structured applicability: serial_ranges [{start, end, inclusive}], '
  'engine_matches [string], prop_matches [string], notes (string).';

CREATE INDEX IF NOT EXISTS idx_ad_cache_lookup
  ON aft_ad_applicability_cache (ad_number, source_hash);

ALTER TABLE aft_ad_applicability_cache ENABLE ROW LEVEL SECURITY;

-- Cache is read by anyone authenticated (AD data is public-domain),
-- but only written by the service role via server endpoints.
DROP POLICY IF EXISTS "ad_cache_select" ON aft_ad_applicability_cache;
CREATE POLICY "ad_cache_select" ON aft_ad_applicability_cache FOR SELECT
  USING (auth.role() = 'authenticated');

COMMIT;
