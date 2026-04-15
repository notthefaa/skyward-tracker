-- =============================================================
-- Migration 014: 14 CFR 43.11 signoff completeness + lock
-- =============================================================
-- Adds the fields 43.11 requires for a maintenance signoff:
--   - certificate type (A&P, IA, Repairman, Pilot-Owner)
--   - certificate expiry (for IA)
--   - Hobbs + Tach at completion
--   - logbook reference
-- Plus lock/unlock columns so once an event is marked complete,
-- its line items can't be silently edited. Admins can unlock
-- with reason (future follow-up).
-- =============================================================

BEGIN;

ALTER TABLE aft_event_line_items
  ADD COLUMN IF NOT EXISTS cert_type text
    CHECK (cert_type IN ('A&P', 'IA', 'Repairman', 'Pilot-Owner', 'Other')),
  ADD COLUMN IF NOT EXISTS cert_number text,
  ADD COLUMN IF NOT EXISTS cert_expiry date,
  ADD COLUMN IF NOT EXISTS tach_at_completion numeric,
  ADD COLUMN IF NOT EXISTS hobbs_at_completion numeric,
  ADD COLUMN IF NOT EXISTS logbook_ref text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES auth.users(id);

-- Mirror lock columns on the parent event so we can prevent edits
-- at the API layer without scanning every line item.
ALTER TABLE aft_maintenance_events
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES auth.users(id);

-- Trigger: when an event moves to 'complete', lock both the event
-- and all its line items. Lock timestamps can be cleared by a
-- global admin if an amendment is needed (future feature).
CREATE OR REPLACE FUNCTION aft_lock_on_complete() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete' THEN
    NEW.locked_at := coalesce(NEW.locked_at, now());

    UPDATE aft_event_line_items
      SET locked_at = coalesce(locked_at, now())
      WHERE event_id = NEW.id AND locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_on_complete ON aft_maintenance_events;
CREATE TRIGGER trg_lock_on_complete
  BEFORE UPDATE ON aft_maintenance_events
  FOR EACH ROW EXECUTE FUNCTION aft_lock_on_complete();

-- Prevent updates to locked line items at the DB layer.
-- Exceptions: allow setting/clearing `locked_at`/`locked_by` via an
-- admin-controlled RPC (not yet built).
CREATE OR REPLACE FUNCTION aft_block_locked_line_item_updates() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Allow only lock/unlock bookkeeping + deleted_at soft-delete from admins.
    IF (
      NEW.locked_at IS DISTINCT FROM OLD.locked_at
      OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    ) AND (
      NEW.line_status = OLD.line_status
      AND NEW.completion_date IS NOT DISTINCT FROM OLD.completion_date
      AND NEW.completion_time IS NOT DISTINCT FROM OLD.completion_time
      AND NEW.completed_by_name IS NOT DISTINCT FROM OLD.completed_by_name
      AND NEW.completed_by_cert IS NOT DISTINCT FROM OLD.completed_by_cert
      AND NEW.cert_type IS NOT DISTINCT FROM OLD.cert_type
      AND NEW.cert_number IS NOT DISTINCT FROM OLD.cert_number
      AND NEW.cert_expiry IS NOT DISTINCT FROM OLD.cert_expiry
      AND NEW.tach_at_completion IS NOT DISTINCT FROM OLD.tach_at_completion
      AND NEW.hobbs_at_completion IS NOT DISTINCT FROM OLD.hobbs_at_completion
      AND NEW.logbook_ref IS NOT DISTINCT FROM OLD.logbook_ref
      AND NEW.work_description IS NOT DISTINCT FROM OLD.work_description
    ) THEN
      RETURN NEW;  -- lock bookkeeping OK
    ELSE
      RAISE EXCEPTION 'Line item % is locked (event completed). Unlock before editing.', OLD.id
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_locked_line_items ON aft_event_line_items;
CREATE TRIGGER trg_block_locked_line_items
  BEFORE UPDATE ON aft_event_line_items
  FOR EACH ROW EXECUTE FUNCTION aft_block_locked_line_item_updates();

COMMIT;
