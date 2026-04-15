# Deployment checklist — bulletproofing initiative

Updated continuously as work progresses. Run everything in this doc once all sessions are complete, in the order shown.

---

## 1. Environment variables

All required on Vercel (Project → Settings → Environment Variables). No **new** env vars added during Session 1. Session 2 will note any additions here.

| Key | Purpose | Added in session |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | pre-existing |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | pre-existing |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (admin) | pre-existing |
| `ANTHROPIC_API_KEY` | Chuck model | pre-existing |
| `OPENAI_API_KEY` | Document embeddings | pre-existing |
| `TAVILY_API_KEY` | Web search | pre-existing |
| `RESEND_API_KEY` | MX email | pre-existing |
| `CRON_SECRET` | Cron endpoint auth header | pre-existing (used by `/api/cron/mx-reminders`; reused for `/api/cron/ads-sync`) |
| `FAA_DRS_FEED_URL` | **Optional.** Override for the FAA AD feed URL. Default is `https://drs.faa.gov/api/public/search/ads`. See §8 below for verification notes. | Session 2 |

---

## 2. Database migrations

Run in the Supabase SQL Editor, **in order**. Each file is idempotent — safe to re-run.

### Session 1
1. `009_soft_delete_audit.sql` — adds `deleted_at` / `deleted_by` to 11 tracked tables, creates `aft_record_history` + generic trigger, adds `set_app_user()` helper, adds `sha256` / `file_size` to `aft_documents`.
2. `010_flight_log_atomic.sql` — creates `log_flight_atomic(uuid, uuid, jsonb, jsonb)` for concurrent-safe flight log writes with monotonicity + sanity bounds.
3. `011_dual_interval_mx.sql` — relaxes `tracking_type` check to include `'both'` for dual-interval MX items.

### Session 2
4. `012_airworthiness_directives.sql` — creates `aft_airworthiness_directives`, RLS policies, + history trigger, + `updated_at` auto-bump.
5. `013_aircraft_equipment.sql` — creates `aft_aircraft_equipment` with capability flags + RLS, adds `make/model/year_mfg/is_ifr_equipped/is_for_hire` columns to `aft_aircraft`.
6. `014_signoff_completeness.sql` — extends `aft_event_line_items` with 43.11 fields (cert_type, cert_expiry, tach/hobbs at completion, logbook_ref), adds lock-after-completion columns + triggers.

### Session 3
7. `015_proposed_actions.sql` — creates `aft_proposed_actions` for Chuck's propose-confirm write framework. RLS: users see/update only their own actions.

---

## 3. Vercel cron schedules

Configured in `vercel.json`. Current schedule:
- `0 12 * * *` (12:00 UTC daily) — `/api/cron/mx-reminders`
- `0 6 * * *` (06:00 UTC daily) — `/api/cron/ads-sync` (Session 2)

---

## 4. Supabase storage buckets

No new buckets in Session 1. `aft_aircraft_documents` already exists.

---

## 5. RLS policies

Migration 009 creates one new policy on `aft_record_history`:
- `record_history_select` — readable by global admins and aircraft admins for their aircraft only.

Migration 012 creates policies on `aft_airworthiness_directives`:
- `ads_select` — readable by anyone with aircraft access.
- `ads_write` — aircraft admins + global admins.

Migration 013 creates policies on `aft_aircraft_equipment`:
- `equipment_select` — same as ads.
- `equipment_write` — same as ads.

Migration 015 creates policies on `aft_proposed_actions`:
- `proposed_actions_select` — users see only their own.
- `proposed_actions_update` — users update only their own (Confirm/Cancel).

No changes required to existing policies.

---

## 6. One-time data backfills

None required for Session 1. Existing rows have `deleted_at = NULL` by default and the history triggers only capture changes going forward.

---

## 7. One-time backfill (recommended for Session 2)

After running migration 013, backfill `make` / `model` / `is_ifr_equipped` / `is_for_hire` on each aircraft in the Aircraft edit form — these new flags feed the airworthiness check and DRS AD match. Aircraft without these fields filled in will have DRS return no matches.

---

## 8. FAA DRS feed URL verification (Session 2)

The Chuck `search_ads` and the nightly sync at `/api/cron/ads-sync` both hit the URL configured at `src/lib/drs.ts` → `DRS_BULK_URL`, defaulting to `https://drs.faa.gov/api/public/search/ads`.

**IMPORTANT:** The FAA does not publish a stable, documented JSON API for DRS. That default URL is a best-effort pattern based on how the DRS web UI fetches data. On first production run, verify:

1. Does the URL return 200 JSON? (hit it from a browser / curl)
2. Does the payload shape match what `parseAdFeed()` expects? (fields: `ad_number`, `subject`, `applicability`, `effective_date`, etc.)
3. If either fails, set `FAA_DRS_FEED_URL` env var to a working endpoint, or update the parser in `src/lib/drs.ts`.

Fallback options if the DRS endpoint is unusable:
- FAA ADsL2 bulk export CSV at `https://www.faa.gov/regulations_policies/airworthiness_directives/` (would need a CSV parser swap).
- Manual entry via the ADsTab UI (fully functional already).

The code handles feed failures gracefully — a DRS fetch error returns `{error, inserted: 0, updated: 0}` per aircraft, and nothing breaks.

---

## 9. Post-migration smoke tests (when you're ready to test)

- Create an MX item with `tracking_type = 'both'` via the form. Confirm it shows both intervals in the list.
- Log a flight that would push Hobbs backwards — expect a 400 with a clear monotonicity error.
- Hard-delete attempt via `aft_aircraft` DELETE — should instead soft-delete; the row stays with `deleted_at` set, child records too.
- Upload the same PDF twice — second upload returns 409.
- Clear a Chuck conversation — thread + messages are hard-deleted (intentional).
- Query `aft_record_history` after any edit — confirm user_id + old_row + new_row are captured.
- Open the ADs tab, add an AD manually, log compliance — confirm it moves between Overdue/Due Soon/Compliant buckets correctly.
- Open the Equipment tab, add a transponder with a due date — confirm the airworthiness check flags it when the date passes.
- Run the AD sync cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/ads-sync` → should return per-aircraft result counts.
- Complete an MX event via the UI — confirm line items become locked (trying to edit them via SQL should raise the P0003 error).
- Export 91.417(b) CSV from the ADs tab — confirm it downloads and looks right.
- Ask Chuck "is my aircraft airworthy?" — it should call `check_airworthiness` and return a structured verdict with regulatory citations.
- Ask Chuck "book me the aircraft for tomorrow 9-11am, pilot JKL, KDAL to KAUS" — it should call `propose_reservation` and surface a confirmation card with Confirm/Cancel. Tap Confirm — the reservation should appear on the Calendar. Row should show `status=executed` in `aft_proposed_actions`.
- Ask Chuck "add a note: oil changed, 3 qts added" — it should call `propose_note`. Confirm → note appears on NotesTab.
- Ask Chuck "schedule maintenance for next Tuesday to address the annual and the open brake squawk" — admin should see `propose_mx_schedule` card; non-admin should get a role-denied message.
- Tap Cancel on a pending Chuck proposal — row marked `cancelled`, no side effects.
