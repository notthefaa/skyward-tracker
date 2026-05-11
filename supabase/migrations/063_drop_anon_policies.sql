-- =============================================================
-- Migration 063: drop anon SELECT policies on event/squawk/aircraft tables
-- =============================================================
-- Migration 062 introduced get_portal_event + get_portal_squawk RPCs
-- and migrated the /service/[id] + /squawk/[id] portal pages off
-- direct anon SELECT against aft_aircraft / aft_maintenance_events /
-- aft_event_line_items / aft_event_messages / aft_squawks. With the
-- portals on RPCs, the blanket `TO anon USING (true)` policies serve
-- no functional purpose and remain an active data-exposure surface:
-- anyone with the project anon key can dump every row.
--
-- Authenticated readers are unaffected — they're covered by:
--   - aft_read_aircraft       (TO authenticated, joined via user_aircraft_access)
--   - aft_read_squawks        (TO authenticated, USING true)
--   - pilots_view_events      (FOR SELECT, joined via user_aircraft_access)
--   - pilots_view_line_items  (FOR SELECT, joined via events + access)
--   - pilots_view_messages    (FOR SELECT, joined via events + access)
--   - admins_full_*           (admin role catch-all)
--
-- Portal RPC contracts locked in e2e/api/portal-rpcs.spec.ts (14/14
-- green on test project with migration 062 applied, before this drop).
--
-- Reversible: each DROP POLICY IF EXISTS is paired with the original
-- CREATE in a comment so a rollback is a copy-paste away. Idempotent.
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

-- Originally: CREATE POLICY aft_anon_view_aircraft ON public.aft_aircraft FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS aft_anon_view_aircraft ON public.aft_aircraft;

-- Originally: CREATE POLICY aft_anon_view_squawks ON public.aft_squawks FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS aft_anon_view_squawks ON public.aft_squawks;

-- Originally: CREATE POLICY anon_view_events ON public.aft_maintenance_events FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS anon_view_events ON public.aft_maintenance_events;

-- Originally: CREATE POLICY anon_view_line_items ON public.aft_event_line_items FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS anon_view_line_items ON public.aft_event_line_items;

-- Originally: CREATE POLICY anon_view_messages ON public.aft_event_messages FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS anon_view_messages ON public.aft_event_messages;

COMMIT;
