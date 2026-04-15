-- =============================================================
-- Migration 011: Dual-interval MX (time AND date, whichever first)
-- =============================================================
-- Allows a maintenance item to track both a time interval AND a
-- date interval. Next-due is computed as the earlier of the two.
-- Matches real-world regs like annual = 12 months OR 100 hrs.
-- =============================================================

BEGIN;

-- Relax the check constraint if one exists. Drop + recreate broadly.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'aft_maintenance_items'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tracking_type%'
  LOOP
    EXECUTE format('ALTER TABLE aft_maintenance_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE aft_maintenance_items
  ADD CONSTRAINT aft_maintenance_items_tracking_type_check
  CHECK (tracking_type IN ('time', 'date', 'both'));

COMMIT;
