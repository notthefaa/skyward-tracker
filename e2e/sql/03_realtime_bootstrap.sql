-- =============================================================
-- Test project bootstrap: realtime publications
-- =============================================================
-- Replicates the supabase_realtime publication membership from
-- prod (6 public tables). Realtime subscriptions in the app
-- listen on these tables.
-- =============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_flight_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_maintenance_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_notification_preferences;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.aft_squawks;
