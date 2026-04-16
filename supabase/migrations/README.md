# Database migrations

Sequential numbered SQL files. Each one is idempotent — re-running is
a no-op.

## Current workflow: Supabase SQL Editor

1. Open the Supabase project → **SQL Editor**.
2. Find the lowest-numbered migration not yet applied.
3. Paste the file contents, run. Move to the next file.

Each migration is wrapped in `BEGIN; … COMMIT;` (or uses `CREATE X IF
NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS`), so re-running
a previously-applied migration is safe.

## Notes about history

Files live here (`supabase/migrations/`) rather than the repo root —
canonical Supabase layout — but are not yet timestamp-prefixed as the
Supabase CLI expects. Until we adopt `supabase db push`, naming stays
numeric (`NNN_description.sql`, applied in order).

If/when we adopt the CLI:
1. Rename each file `NNN_*` → `YYYYMMDDHHMMSS_*.sql` (preserve content).
2. Populate `supabase_migrations.schema_migrations` with a row for
   each existing file so the CLI doesn't try to re-apply them.
3. From then on, `supabase migration new <name>` generates new files.

## Conventions

- **One migration per ALTER TABLE feature** — a bugfix that just tweaks
  a trigger is its own file, not a bolt-on to an unrelated migration.
- **Idempotent** — use `IF NOT EXISTS`, `CREATE OR REPLACE`, or wrap in
  `DO $$ … $$` blocks so re-running is safe.
- **Transactional when possible** — `BEGIN; … COMMIT;` so partial
  failures don't leave half-applied state.
- **Document the "why" at the top** — the reader in six months is
  probably you, and the commit message isn't in front of them.

## Order

Numbering starts at 005 because earlier schema lives in Supabase
directly (seed setup). Run in order on a fresh environment:
`005 → 006 → 007 → 008 → 009 → 010 → … → latest`.
