-- Migration 019: audit trigger prefers row columns over session var.
--
-- The prior log_record_history() trigger (009) read the user from a
-- transaction-local session variable `app.current_user_id`, which the
-- application set via setAppUser() / rpc('set_app_user', …). That RPC
-- is a separate PostgREST transaction from the subsequent INSERT /
-- UPDATE, so the `is_local=true` config was rolled back before the
-- write fired — audit rows landed with NULL user_id.
--
-- Fix: prefer per-row attribution that's set in the SAME transaction
-- as the write.
--   • INSERT    → NEW.created_by
--   • SOFT-DEL  → NEW.deleted_by (detected by deleted_at newly set)
--   • UPDATE    → session var / auth.uid() (no updated_by column today)
--   • DELETE    → OLD.deleted_by, else session var / auth.uid()
--
-- setAppUser() calls are retained as a belt-and-suspenders fallback.

BEGIN;

CREATE OR REPLACE FUNCTION log_record_history() RETURNS TRIGGER AS $$
DECLARE
  v_user_id       uuid;
  v_aircraft_id   uuid;
  v_record_id     uuid;
  v_old           jsonb;
  v_new           jsonb;
  v_is_soft_del   boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  -- Detect a soft-delete: deleted_at transitioning from NULL to set.
  -- jsonb ->> yields NULL if the column doesn't exist on the row, so
  -- this is safe on tables that don't have deleted_at (none of the
  -- tracked tables today, but future-proof).
  IF TG_OP = 'UPDATE'
     AND (v_old->>'deleted_at') IS NULL
     AND (v_new->>'deleted_at') IS NOT NULL THEN
    v_is_soft_del := true;
  END IF;

  -- ── User attribution, most-reliable first. ────────────────────────
  BEGIN
    IF TG_OP = 'INSERT' THEN
      v_user_id := nullif(v_new->>'created_by', '')::uuid;
    ELSIF v_is_soft_del THEN
      v_user_id := nullif(v_new->>'deleted_by', '')::uuid;
    ELSIF TG_OP = 'DELETE' THEN
      v_user_id := nullif(v_old->>'deleted_by', '')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Fall back to the transaction session var (when set in the same
  -- transaction as the write — works for direct SQL / PostgREST
  -- multi-step procs; does NOT work for supabase-js because each
  -- rpc/insert is a separate HTTP transaction).
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- Last resort: whoever's logged in via PostgREST auth (NULL under
  -- service-role, which is how the API layer connects).
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  -- ── Identify the record + its aircraft. ───────────────────────────
  IF TG_OP = 'DELETE' THEN
    v_record_id := (v_old->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(v_old->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
    VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'DELETE', v_user_id, v_old, NULL);
    RETURN OLD;
  ELSE
    v_record_id := (v_new->>'id')::uuid;
    v_aircraft_id := coalesce(
      nullif(v_new->>'aircraft_id', '')::uuid,
      CASE WHEN TG_TABLE_NAME = 'aft_aircraft' THEN v_record_id ELSE NULL END
    );
    IF TG_OP = 'INSERT' THEN
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'INSERT', v_user_id, NULL, v_new);
    ELSE
      INSERT INTO aft_record_history (table_name, record_id, aircraft_id, operation, user_id, old_row, new_row)
      VALUES (TG_TABLE_NAME, v_record_id, v_aircraft_id, 'UPDATE', v_user_id, v_old, v_new);
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- =========================================================================
-- APPLICATION-LAYER NOTES
-- =========================================================================
-- 1. INSERTs on tracked tables SHOULD include `created_by` — most already
--    do. Without it, inserts attribute via setAppUser's session var
--    (usually NULL under supabase-js) or NULL.
--
-- 2. softDelete() in src/lib/audit.ts already stamps `deleted_by` — that
--    column now drives the audit attribution for soft-deletes regardless
--    of the session var.
--
-- 3. Hard DELETEs on non-retention tables (howard messages, note_reads,
--    preferences) will still attribute to NULL. That's fine — those
--    tables aren't in the soft-delete + trigger list anyway.
--
-- 4. For UPDATE-not-soft-delete paths (e.g. editing a note's body),
--    the audit will attribute to NULL unless the app layer sets an
--    `updated_by` column. Not a concern today; revisit if UPDATE
--    attribution becomes load-bearing.
-- =========================================================================
