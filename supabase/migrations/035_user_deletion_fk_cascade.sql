-- =============================================================
-- Migration 035: FK-cascade rules for user deletion
-- =============================================================
-- Most audit / authorship columns that reference auth.users were
-- added without an explicit ON DELETE clause (the default is
-- NO ACTION, i.e. RESTRICT). That means supabaseAdmin.auth.admin
-- .deleteUser(userId) throws if the user has ever soft-deleted a
-- row, created an equipment / AD record, locked a signoff, or
-- owned a Howard proposal — and the throw bubbles up as a 500
-- from /api/users DELETE.
--
-- Classification:
--   - Thread-scoped content that should die with the user:
--       aft_proposed_actions.user_id (NOT NULL)      → CASCADE
--   - Audit / authorship columns (preserve the row, null the user):
--       every *_by / confirmed_by / locked_by / historical user_id
--       across aft_* tables                          → SET NULL
--
-- Constraint names follow the Postgres default `{table}_{column}_fkey`.
-- `DROP CONSTRAINT IF EXISTS` keeps the migration idempotent even if
-- the constraint was already re-created by an earlier run.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- ── Thread-scoped (CASCADE) ──────────────────────────────────

ALTER TABLE aft_proposed_actions
  DROP CONSTRAINT IF EXISTS aft_proposed_actions_user_id_fkey,
  ADD  CONSTRAINT aft_proposed_actions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── Audit / authorship (SET NULL) ────────────────────────────

-- deleted_by columns from migration 009
ALTER TABLE aft_aircraft
  DROP CONSTRAINT IF EXISTS aft_aircraft_deleted_by_fkey,
  ADD  CONSTRAINT aft_aircraft_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_flight_logs
  DROP CONSTRAINT IF EXISTS aft_flight_logs_deleted_by_fkey,
  ADD  CONSTRAINT aft_flight_logs_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_maintenance_items
  DROP CONSTRAINT IF EXISTS aft_maintenance_items_deleted_by_fkey,
  ADD  CONSTRAINT aft_maintenance_items_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_maintenance_events
  DROP CONSTRAINT IF EXISTS aft_maintenance_events_deleted_by_fkey,
  ADD  CONSTRAINT aft_maintenance_events_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_event_line_items
  DROP CONSTRAINT IF EXISTS aft_event_line_items_deleted_by_fkey,
  ADD  CONSTRAINT aft_event_line_items_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_squawks
  DROP CONSTRAINT IF EXISTS aft_squawks_deleted_by_fkey,
  ADD  CONSTRAINT aft_squawks_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_vor_checks
  DROP CONSTRAINT IF EXISTS aft_vor_checks_deleted_by_fkey,
  ADD  CONSTRAINT aft_vor_checks_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_tire_checks
  DROP CONSTRAINT IF EXISTS aft_tire_checks_deleted_by_fkey,
  ADD  CONSTRAINT aft_tire_checks_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_oil_logs
  DROP CONSTRAINT IF EXISTS aft_oil_logs_deleted_by_fkey,
  ADD  CONSTRAINT aft_oil_logs_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_notes
  DROP CONSTRAINT IF EXISTS aft_notes_deleted_by_fkey,
  ADD  CONSTRAINT aft_notes_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_documents
  DROP CONSTRAINT IF EXISTS aft_documents_deleted_by_fkey,
  ADD  CONSTRAINT aft_documents_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- aft_record_history (audit log — anonymize but keep history)
ALTER TABLE aft_record_history
  DROP CONSTRAINT IF EXISTS aft_record_history_user_id_fkey,
  ADD  CONSTRAINT aft_record_history_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- created_by / deleted_by from migration 012
ALTER TABLE aft_airworthiness_directives
  DROP CONSTRAINT IF EXISTS aft_airworthiness_directives_created_by_fkey,
  ADD  CONSTRAINT aft_airworthiness_directives_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_airworthiness_directives
  DROP CONSTRAINT IF EXISTS aft_airworthiness_directives_deleted_by_fkey,
  ADD  CONSTRAINT aft_airworthiness_directives_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- created_by / deleted_by from migration 013
ALTER TABLE aft_aircraft_equipment
  DROP CONSTRAINT IF EXISTS aft_aircraft_equipment_created_by_fkey,
  ADD  CONSTRAINT aft_aircraft_equipment_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_aircraft_equipment
  DROP CONSTRAINT IF EXISTS aft_aircraft_equipment_deleted_by_fkey,
  ADD  CONSTRAINT aft_aircraft_equipment_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- locked_by from migration 014
ALTER TABLE aft_event_line_items
  DROP CONSTRAINT IF EXISTS aft_event_line_items_locked_by_fkey,
  ADD  CONSTRAINT aft_event_line_items_locked_by_fkey
    FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE aft_maintenance_events
  DROP CONSTRAINT IF EXISTS aft_maintenance_events_locked_by_fkey,
  ADD  CONSTRAINT aft_maintenance_events_locked_by_fkey
    FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- confirmed_by from migration 015
ALTER TABLE aft_proposed_actions
  DROP CONSTRAINT IF EXISTS aft_proposed_actions_confirmed_by_fkey,
  ADD  CONSTRAINT aft_proposed_actions_confirmed_by_fkey
    FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- =============================================================
-- NOTES
-- =============================================================
-- After this migration, /api/users DELETE no longer throws when the
-- target user has touched audit-tracked tables. The sole-admin guard
-- added in commit 0f67be1 still blocks the genuinely-unsafe case
-- (leaving an aircraft without an admin).
--
-- Pre-migration tables (aft_aircraft, aft_flight_logs, aft_squawks,
-- aft_notes, aft_maintenance_*, aft_event_line_items) may also hold
-- user_id / created_by / reported_by / author_email columns whose FKs
-- weren't inspectable from the migrations directory — verify those
-- against information_schema.key_column_usage + referential_constraints
-- and add any remaining columns here if they're still NO ACTION.
-- =============================================================
