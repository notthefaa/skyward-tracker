-- =============================================================
-- Test project bootstrap: extensions
-- =============================================================
-- Replicates non-default extensions enabled in prod.
-- Defaults (pgcrypto, uuid-ossp, plpgsql, pg_stat_statements,
-- supabase_vault) ship with every Supabase project — skipped here.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS vector;
