# Test project bootstrap SQL

Captured from prod 2026-05-05 via read-only `pg_dump` + targeted system-catalog queries.

## Why this exists

`supabase/migrations/*.sql` starts at `005_*` — the foundational tables (`aft_aircraft`, `aft_flight_logs`, `aft_maintenance_items`, `aft_squawks`, etc.) were created via the Supabase dashboard before the migration discipline started, and don't exist in any committed migration. Applying just `supabase/migrations/` to a fresh database fails because later migrations reference tables that were never authored as SQL.

This directory captures the **complete** prod schema as a single bootstrap, so a fresh test/E2E project can be brought up to parity with prod.

## Files (apply in order)

1. `00_extensions.sql` — non-default Postgres extensions (`btree_gist`, `vector`).
2. `01_public_schema.sql` — full public schema dump: 35 tables, 20 functions/RPCs, 82 RLS policies, 20 triggers, indexes, types.
3. `02_storage_bootstrap.sql` — 5 private storage buckets + 9 RLS policies on `storage.objects`.
4. `03_realtime_bootstrap.sql` — `supabase_realtime` publication membership for 6 tables.

## Apply to a new Supabase project

```bash
DB_URL="postgresql://postgres.<REF>:<PASSWORD>@<HOST>:5432/postgres"

for f in e2e/sql/0*.sql; do
  echo "=== applying $f ==="
  PGPASSWORD='<PASSWORD>' psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Or use `bash e2e/sql/apply.sh "$DB_URL"`.

## Refreshing from prod

If prod schema changes (a new migration is shipped) and you want to refresh the test environment:

```bash
PGPASSWORD='<PROD_DB_PASSWORD>' \
  docker run --rm -e PGPASSWORD -v "$PWD/e2e/sql":/dump postgres:17-alpine \
  pg_dump --schema-only --schema=public --no-owner --no-privileges \
  -h aws-1-us-east-1.pooler.supabase.com -p 5432 \
  -U postgres.<PROD_REF> -d postgres \
  -f /dump/01_public_schema.sql
```

Then re-run the apply against the test project (drop existing schema first, or apply fresh).
