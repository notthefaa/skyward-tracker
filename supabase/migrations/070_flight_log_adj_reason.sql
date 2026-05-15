-- 070_flight_log_adj_reason.sql
--
-- Add 'ADJ' (Adjustment) to the allowed trip_reason codes on
-- aft_flight_logs. Adjustment entries are book-keeping rows pilots
-- file to true up Tach/FTT/AFTT/Hobbs against the real meter after
-- a discrepancy (a missed log, mechanic-run, paperwork mismatch).
-- They typically carry 0 landings — which the column already permits
-- — but the existing CHECK constraint enumerates only PE/BE/MX/T,
-- so any ADJ insert would fail with a constraint violation.
--
-- Drop and re-add the constraint with ADJ included. Idempotent.

BEGIN;

ALTER TABLE aft_flight_logs
  DROP CONSTRAINT IF EXISTS aft_flight_logs_trip_reason_check;

ALTER TABLE aft_flight_logs
  ADD CONSTRAINT aft_flight_logs_trip_reason_check
  CHECK (
    trip_reason IS NULL
    OR trip_reason = ANY (ARRAY['PE'::text, 'BE'::text, 'MX'::text, 'T'::text, 'ADJ'::text, ''::text])
  );

COMMIT;
