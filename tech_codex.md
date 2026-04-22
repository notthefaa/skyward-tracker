# Skyward Aircraft Manager — Technical Codex

Complete technical reference for developers working on the Skyward Aircraft Manager codebase. Covers the database schema, API surface, authentication model, realtime architecture, AI assistant, airworthiness engine, audit trail, observability, and key implementation details.

---

## Database Schema

> **Soft-delete convention.** Every table listed in `src/lib/audit.ts → SOFT_DELETE_TABLES` has `deleted_at timestamptz` + `deleted_by uuid FK → auth.users` columns. Reads filter `deleted_at IS NULL`. Soft-delete is performed via `softDelete()` helper (after `setAppUser()`) so the history trigger captures the attributing user.

### aft_aircraft
Aircraft master records. `created_by → auth.users ON DELETE SET NULL`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tail_number | text UNIQUE | e.g. "N12345" |
| serial_number | text | Optional |
| aircraft_type | text | e.g. "Cessna 172" |
| engine_type | text | "Piston" or "Turbine" |
| make | text | Manufacturer (used for FAA DRS AD lookup) |
| model | text | (used for DRS lookup) |
| year_mfg | integer | |
| is_ifr_equipped | boolean | Feeds Howard's tone + airworthiness 91.411/91.171 gating |
| is_for_hire | boolean | Feeds airworthiness (100-hour checks) |
| total_airframe_time | numeric | Running total (Hobbs or AFTT) |
| total_engine_time | numeric | Running total (Tach or FTT) |
| setup_hobbs / setup_tach / setup_aftt / setup_ftt | numeric | Setup baselines |
| home_airport | text | ICAO |
| main_contact / main_contact_phone / main_contact_email | text | Primary contact routing |
| mx_contact / mx_contact_phone / mx_contact_email | text | Mechanic routing |
| avatar_url | text | Supabase Storage public URL |
| current_fuel_gallons | numeric | |
| fuel_last_updated | timestamptz | |
| created_by | uuid | ON DELETE SET NULL |
| deleted_at / deleted_by | — | Soft-delete |

**Setup vs Total:** `setup_*` record the baseline at aircraft add; `total_*` are the cumulative times incremented by each flight log. On edit, if flight logs exist the totals stay pinned to the latest log (authoritative source). If no logs, totals reset to the new setup values.

### aft_flight_logs
One row per flight. Times cumulative (new Hobbs, not delta). Writes go through `log_flight_atomic` RPC.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| user_id | uuid FK → auth.users | ON DELETE SET NULL |
| pod / poa | text | Departure / arrival ICAO |
| hobbs / tach / aftt / ftt | numeric | Cumulative meter readings |
| engine_cycles | integer | Turbine only |
| landings | integer | |
| initials | text | Pilot initials |
| pax_info | text | |
| trip_reason | text | PE, BE, MX, T |
| fuel_gallons | numeric | Fuel state after flight |
| created_at | timestamptz | |
| deleted_at / deleted_by | — | Soft-delete |

### aft_maintenance_items
Tracked MX items. `tracking_type` is `time`, `date`, or **`both`** (dual-interval — whichever comes first grounds the aircraft).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| item_name | text | |
| tracking_type | text | `'time'` / `'date'` / `'both'` |
| is_required | boolean | Required items ground the aircraft when expired |
| last_completed_time / time_interval / due_time | numeric | Time tracking |
| last_completed_date / date_interval_days / due_date | — | Date tracking |
| automate_scheduling | boolean | Auto-create drafts when approaching |
| mx_schedule_sent / primary_heads_up_sent | boolean | Draft lifecycle flags |
| reminder_5_sent / reminder_15_sent / reminder_30_sent | boolean | Reminder-stage flags |
| deleted_at / deleted_by | — | Soft-delete |

### aft_maintenance_events
Service event lifecycle: draft → scheduling → confirmed → in_progress → ready_for_pickup → complete. Cancel branches everywhere.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| status | text | See lifecycle above |
| access_token | text UNIQUE | 256-bit hex for mechanic portal |
| proposed_date / proposed_by | — | `'owner'` or `'mechanic'` |
| confirmed_date / confirmed_at | — | Agreed service date |
| estimated_completion | date | Mechanic's estimate |
| completed_at | timestamptz | |
| mechanic_notes | text | |
| service_duration_days | integer | |
| addon_services | jsonb | Array |
| mx_contact_name / mx_contact_email | text | |
| primary_contact_name / primary_contact_email | text | |
| deleted_at / deleted_by | — | Soft-delete. All portal routes (respond, upload-attachment, owner-action, send-workpackage) filter. |

**Portal token expiry:** Rejected (403) if event completed >7 days ago. Enforced client + server.

### aft_event_line_items
Line items in a work package. Partial completion supported. **Locks on `line_status='complete'`** via a trigger (`P0003` error on attempted edit).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK → aft_maintenance_events | ON DELETE CASCADE |
| item_type | text | `'maintenance'`, `'squawk'`, or `'addon'` |
| maintenance_item_id / squawk_id | uuid FK | Nullable links |
| item_name / item_description | text | |
| line_status | text | `'pending'` / `'in_progress'` / `'complete'` / `'deferred'` |
| mechanic_comment | text | |
| completion_date / completion_time | — | Logbook data captured at complete |
| completed_by_name / completed_by_cert / cert_type / cert_expiry | text | 43.11 signoff |
| logbook_ref | text | Logbook reference |
| tach_at_completion / hobbs_at_completion | numeric | Captured at signoff |
| work_description | text | |
| deleted_at / deleted_by | — | Soft-delete |

### aft_event_messages
Communication thread for a service event.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK | ON DELETE CASCADE |
| sender | text | `'owner'` / `'mechanic'` / `'system'` |
| message_type | text | `'comment'` / `'propose_date'` / `'confirm'` / `'status_update'` |
| message | text | |
| proposed_date | date | |
| attachments | jsonb | Array of `{url, filename, size, type}` |
| created_at | timestamptz | |

### aft_squawks
Discrepancy reports with optional MEL/CDL/NEF/MDL deferral and service-event cross-reference.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| reported_by | uuid FK → auth.users | ON DELETE SET NULL |
| reporter_initials | text | |
| location / description | text | |
| affects_airworthiness | boolean | True = grounds the aircraft |
| status | text | `'open'` or `'resolved'` |
| pictures | jsonb | Public URLs |
| is_deferred | boolean | Deferral signoff |
| mel_number / cdl_number / nef_number / mdl_number / mel_control_number | text | |
| deferral_category | text | A/B/C/D |
| deferral_procedures_completed | boolean | |
| full_name / certificate_number / signature_data / signature_date | — | Deferral signature |
| resolved_by_event_id | uuid FK → aft_maintenance_events | ON DELETE SET NULL |
| resolved_note | text | Set on `propose_squawk_resolve` confirm |
| deleted_at / deleted_by | — | Soft-delete |

### aft_notes
Pilot-to-pilot whiteboard with photo attachments.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| author_id | uuid FK → auth.users | ON DELETE SET NULL |
| author_email / author_initials | text | |
| content | text | |
| pictures | jsonb | Public URLs (orphan-rolled-back on insert failure) |
| edited_at / edited_by_initials | — | |
| deleted_at / deleted_by | — | Soft-delete |

### aft_note_reads
Composite PK `(note_id, user_id)`. Both FKs CASCADE.

### aft_documents + aft_document_chunks
RAG document store. `aft_documents` carries filename, SHA-256, file_size, doc_type, page_count, status (`processing`/`ready`/`error`). `aft_document_chunks` holds the text split + pgvector `embedding(1536)`. Queried via `match_document_chunks(query_embedding, match_aircraft_id, match_count, match_threshold)` RPC. SHA-256 uniqueness filtered by `deleted_at IS NULL` so deleted uploads can be re-uploaded.

### aft_airworthiness_directives (migration 012)
First-class AD tracking. `source` is `'drs_sync'` / `'manual'` / `'user_added'`. Partial UNIQUE INDEX `(aircraft_id, ad_number) WHERE deleted_at IS NULL` (migration 023) — soft-deleted rows don't block resurrection.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | |
| ad_number / amendment / subject / applicability | text | |
| source_url | text | FAA PDF |
| source | text CHECK | See above |
| effective_date | date | |
| is_superseded / superseded_by | — | |
| compliance_type | text CHECK | `'one_time'` / `'recurring'` |
| initial_compliance_hours / initial_compliance_date | — | |
| recurring_interval_hours / recurring_interval_months | — | |
| last_complied_date / last_complied_time / last_complied_by | — | Compliance record |
| next_due_date / next_due_time | — | Due triggers for airworthiness verdict |
| compliance_method | text | e.g. "Inspected per AD; found serviceable" |
| notes | text | |
| affects_airworthiness | boolean | |
| synced_at / sync_hash | — | DRS sync tracking |
| created_at / updated_at / created_by | — | Auto-bumped `updated_at` via trigger |
| deleted_at / deleted_by | — | Soft-delete |

### aft_aircraft_equipment (migration 013)
Installed equipment with capability flags and 24-month check dates. Drives airworthiness verdict.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | |
| name | text | |
| category | text | `'avionics'` / `'transponder'` / `'altimeter'` / `'pitot_static'` / `'elt'` / `'engine'` / `'propeller'` / `'other'` |
| make / model / serial / part_number | text | |
| installed_at / installed_by | — | Installation record |
| removed_at / removed_reason | — | Physical removal (distinct from DB delete) |
| ifr_capable / adsb_out / adsb_in / is_elt | boolean | Capability flags |
| transponder_class | text | |
| transponder_due_date / altimeter_due_date / pitot_static_due_date | — | 24-month checks (91.411/91.413) |
| elt_battery_expires / elt_battery_cumulative_hours | — | 91.207 |
| vor_due_date | date | 91.171 (IFR only) |
| notes | text | |
| deleted_at / deleted_by | — | Soft-delete. Airworthiness also filters `removed_at IS NULL`. |

### aft_vor_checks / aft_tire_checks / aft_oil_logs (migration 006)
Standalone log tables.

- `aft_vor_checks`: `check_type` (VOT/VOR/dual-VOR), `station`, `bearing_error`, `initials`, soft-delete.
- `aft_tire_checks`: `nose_psi`, `left_main_psi`, `right_main_psi`, `initials`, soft-delete.
- `aft_oil_logs`: `oil_qty` (current), `oil_added` (top-off), `engine_hours`, `initials`, `notes`, soft-delete.

### aft_proposed_actions (migration 015)
Howard's propose-confirm queue.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| thread_id | uuid FK → aft_howard_user_threads | |
| message_id | uuid FK → aft_howard_messages | Nullable |
| user_id | uuid FK → auth.users | CASCADE |
| aircraft_id | uuid FK | |
| action_type | text | `'reservation'` / `'mx_schedule'` / `'squawk_resolve'` / `'note'` / `'equipment'` |
| payload | jsonb | Shape per action type |
| summary | text | Rendered on confirmation card |
| required_role | text | `'access'` / `'admin'` (enforced at /actions/[id] POST) |
| status | text | `'pending'` / `'cancelled'` / `'executed'` / `'failed'` |
| confirmed_at / confirmed_by | — | |
| cancelled_at | timestamptz | |
| executed_at / executed_record_id / executed_record_table | — | What was written on success |
| error_message | text | Set on failure path |

**RLS:** users see/update only their own rows.

### aft_howard_user_threads + aft_howard_messages (migrations 016, 017)
User-scoped threads (one per user, supersedes the old per-aircraft Chuck tables). `aft_howard_messages` records role (`user` / `assistant` / `tool`), content, and optional `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` for usage accounting.

### aft_howard_rate_limit (migration 020)
Per-user rolling request timestamps. `howard_rate_limit_check(user_id, window_ms, max_requests)` RPC is SECURITY DEFINER with `SELECT FOR UPDATE` so concurrent Vercel instances serialize per-user. 20 requests / 60 seconds.

### aft_record_history (migration 009)
Generic audit trail. Populated by `log_record_history()` trigger on INSERT/UPDATE/DELETE across all soft-delete tables.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| table_name | text | |
| record_id | uuid | |
| operation | text | `'INSERT'` / `'UPDATE'` / `'DELETE'` |
| user_id | uuid | Prefers row columns (`created_by`, `deleted_by`), falls back to session `app.current_user_id` |
| old_row / new_row | jsonb | Full row snapshots |
| created_at | timestamptz | |

**RLS:** `record_history_select` readable by global admins + aircraft admins scoped to their aircraft.

### aft_user_profiles
Display names + email for admin/portal display. `user_id` PK, CASCADE.

### aft_user_roles
Global role row per user. `role` is `'admin'` / `'pilot'`. Carries `initials`, `full_name`, `email`, `faa_ratings` (text[]).

### aft_user_aircraft_access
Composite PK `(user_id, aircraft_id)`. `aircraft_role` is `'admin'` / `'pilot'`.

### aft_user_preferences (migration 005)
Generic key-value (user_id + pref_key PK, jsonb value). RLS. Used for nav tray order and future cross-device prefs.

### aft_reservations
Calendar bookings. Exclusion constraint prevents overlapping confirmed reservations on the same aircraft via `tstzrange` with `btree_gist`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| user_id | uuid FK → auth.users | ON DELETE SET NULL |
| start_time / end_time | timestamptz | End must be after start |
| title / route | text | |
| pilot_name / pilot_initials | text | Denormalized for display |
| status | text | `'confirmed'` / `'cancelled'` (cancel is status flip, not soft-delete) |
| time_zone | text | IANA zone the booker was in; used for cross-zone email rendering |

### aft_notification_preferences
Composite PK `(user_id, notification_type)`. Types: `reservation_created`, `reservation_cancelled`, `squawk_reported`, `mx_reminder`, `service_update`, `note_posted`.

### aft_system_settings
Single row (id=1). Reminder thresholds, scheduling thresholds, predictive window.

---

## Storage Buckets

| Bucket | Public | Purpose |
|--------|--------|---------|
| aft_squawk_images | Yes | Squawk photos (orphan-cleaned on insert failure) |
| aft_note_images | Yes | Note attachments (same) |
| aft_aircraft_avatars | Yes | Aircraft hero images |
| aft_event_attachments | Yes | Mechanic file uploads (magic-byte validated) |
| aft_aircraft_documents | Yes | Uploaded PDFs for RAG |

All uploads use the service role key. Client-side compression via `browser-image-compression`. 10MB limit enforced both sides.

---

## Atomic RPCs

All defined in `supabase/migrations/*.sql`. Called via `supabaseAdmin.rpc(...)`.

| RPC | Migration | Purpose |
|-----|-----------|---------|
| `set_app_user(p_user_id)` | 009 | Sets `app.current_user_id` for the history trigger |
| `log_record_history()` | 009 | Generic INSERT/UPDATE/DELETE audit trigger |
| `log_flight_atomic(aircraft_id, user_id, log_data, aircraft_update)` | 010 | Lock aircraft row, enforce monotonicity + 24hr bound, insert log + update totals in one txn |
| `edit_flight_log_atomic(log_id, aircraft_id, user_id, log_data, aircraft_update)` | 021 | Admin edit: lock, verify log belongs to aircraft, update both in one txn (no monotonicity — edits can correct backwards) |
| `delete_flight_log_atomic(log_id, aircraft_id, user_id, aircraft_update)` | 022 | Admin soft-delete + totals rollback in one txn |
| `howard_rate_limit_check(user_id, window_ms, max_requests)` | 020 | SECURITY DEFINER, `SELECT FOR UPDATE` per-user, returns `(allowed, retry_after_ms)` |
| `match_document_chunks(query_embedding, match_aircraft_id, match_count, match_threshold)` | 008 | pgvector cosine-similarity chunk lookup for RAG |

---

## API Routes

### Authentication Pattern
All authenticated routes use `requireAuth(req)` from `@/lib/auth.ts`, which extracts the Bearer token, verifies it against Supabase Auth, and returns `{ user, supabaseAdmin, requestId }`. Admin-only routes use `requireAuth(req, 'admin')`.

**Aircraft access verification:** `requireAircraftAccess(supabaseAdmin, userId, aircraftId)` — global admins bypass, others must have a row in `aft_user_aircraft_access`. Throws 403.

**Aircraft admin verification:** `requireAircraftAdmin(...)` — requires global admin OR `aircraft_role='admin'` on the target aircraft.

**Error handling:** `handleApiError(error, req?)` wraps the response, attaches `requestId`, emits `x-request-id` header, and forwards unexpected errors to Sentry.

Client-side calls use `authFetch()` from `@/lib/authFetch.ts` which auto-attaches the session token.

### Route Reference

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/account/delete` | GET/DELETE | Auth | Preview + execute self-deletion |
| `/api/admin/db-health` | POST | Admin | Cleanup old records, orphan files |
| `/api/admin/users` | GET | Admin | List all users with aircraft assignments |
| `/api/ads` | POST/PUT/DELETE | Aircraft Admin | AD CRUD (respects migration 023 partial UNIQUE) |
| `/api/ads/export` | GET | Aircraft | CSV export for 91.417(b) |
| `/api/aircraft/create` | POST | Auth | Create aircraft, creator becomes admin |
| `/api/aircraft/delete` | DELETE | Auth | Soft-delete aircraft |
| `/api/aircraft-access` | PUT/DELETE | Aircraft Admin | Role change / remove user |
| `/api/cron/mx-reminders` | GET | CRON_SECRET | Four-phase per-aircraft pipeline (evaluate → aggregate → heads-up → reminders → pickup nudge) |
| `/api/cron/ads-sync` | GET | CRON_SECRET | Nightly FAA DRS pull; emits per-aircraft result counts |
| `/api/documents` | POST/GET/DELETE | Aircraft Admin for mutations | PDF upload → extract → chunk → embed → dedup by SHA-256 |
| `/api/emails/{squawk-notify,note-notify,mx-schedule}` | POST | Auth + Aircraft | Transactional notification senders |
| `/api/equipment` | GET/POST/PUT/DELETE | Aircraft Admin for mutations | Equipment CRUD |
| `/api/flight-logs` | POST/PUT/DELETE | Auth + Aircraft | Atomic RPCs (see above) |
| `/api/howard` | POST/GET/DELETE | Auth | Send message (streaming), fetch thread, clear thread |
| `/api/howard/actions` | GET | Auth | List proposed actions for a thread |
| `/api/howard/actions/[id]` | POST/DELETE | Auth + role | Confirm/retry / cancel a proposed action (role-gated per action_type) |
| `/api/howard/usage` | GET | Admin | Per-user token usage rollup |
| `/api/invite` | POST | Admin | Invite global admin or standalone pilot |
| `/api/maintenance-items` | POST/PUT/DELETE | Aircraft Admin | MX item CRUD |
| `/api/mx-events/block` | POST | Aircraft Admin | Create MX calendar block (cancels conflicts) |
| `/api/mx-events/cancel-workpackage` | POST | Aircraft Admin | Cancel event |
| `/api/mx-events/complete` | POST | Aircraft Admin | Complete event items (partial supported) |
| `/api/mx-events/create` | POST | Aircraft | Create service event |
| `/api/mx-events/owner-action` | POST | Aircraft Admin | confirm/counter/comment/cancel (filters `deleted_at`) |
| `/api/mx-events/respond` | POST | Token | Mechanic portal actions (filters `deleted_at`) |
| `/api/mx-events/send-workpackage` | POST | Aircraft Admin | Send / resend work package (filters `deleted_at`) |
| `/api/mx-events/upload-attachment` | POST | Token | Mechanic uploads (10MB, 5 files, magic-byte validated, filters `deleted_at`) |
| `/api/notes` | POST/PUT/DELETE | Aircraft (author) or Aircraft Admin | Cross-aircraft-verified: row's aircraft_id must match supplied aircraftId |
| `/api/oil-logs` | POST/DELETE | Aircraft | Oil log CRUD |
| `/api/pilot-invite` | POST | Aircraft Admin | Tailnumber admin invite |
| `/api/reservations` | POST/PUT/DELETE | Auth | Recurring-series support, `bookForUserId` for admins |
| `/api/resend-invite` | POST | None | Re-send Supabase auth invitation |
| `/api/squawks` | POST/PUT/DELETE | Aircraft (author) or Aircraft Admin | Cross-aircraft-verified (matches /notes) |
| `/api/tire-checks` | POST/DELETE | Aircraft | Tire log CRUD |
| `/api/users` | DELETE | Admin | Delete a user account |
| `/api/version` | GET | None | App version |
| `/api/vor-checks` | POST/DELETE | Aircraft | VOR log CRUD |

---

## Howard (AI Copilot)

Model: `claude-haiku-4-5-20251001`. Entrypoint `src/app/api/howard/route.ts` streams via the Anthropic SDK. System prompt split into a **stable prelude** (`HOWARD_STABLE_PRELUDE`, prompt-cached with ephemeral cache_control) and a **per-request user context** (`buildUserContext` — user's fleet, currently-selected aircraft, role, FAA ratings).

### Tool registry (`src/lib/howard/toolHandlers.ts`)

24 tools. Every aircraft-scoped tool takes a `tail` param that is resolved via `resolveAircraftFromTail` before the handler runs — confirms the aircraft exists, isn't soft-deleted, and the user has access.

- Read-only: `get_flight_logs`, `get_maintenance_items`, `get_service_events`, `get_event_line_items`, `get_squawks`, `get_notes`, `get_reservations`, `get_vor_checks`, `get_tire_and_oil_logs`, `get_system_settings`, `get_equipment`, `search_ads`.
- External: `get_weather_briefing` (NOAA AWC METAR/TAF), `get_aviation_hazards` (NOAA AWC PIREP/SIGMET), `get_notams` (official FAA NOTAM API), `web_search` (Tavily).
- Airworthiness: `check_airworthiness` (runs `computeAirworthinessStatus`), `refresh_ads_drs` (on-demand DRS sync).
- RAG: `search_documents` (OpenAI embeddings → `match_document_chunks`).
- Write / propose-confirm: `propose_reservation`, `propose_mx_schedule`, `propose_squawk_resolve`, `propose_note`, `propose_equipment_entry`.

**Result size cap.** `capResultSize()` trims the largest array in a tool result until serialized length ≤ 40KB, adds a `_truncated` marker, and emits a `howard_tool_truncated` telemetry event. The system prompt tells Howard to surface truncation to the user.

### Propose-confirm framework (`src/lib/howard/proposedActions.ts`)

1. Howard calls a `propose_*` tool → inserts a row in `aft_proposed_actions` with `status='pending'`, returns id + summary.
2. UI renders `ProposedActionCard` inline under the assistant message.
3. User taps **Confirm** → `POST /api/howard/actions/[id]` → role-gated by `required_role` → `executeAction()` writes via the admin client → row flips to `executed` (or `failed` with `error_message`).
4. User taps **Cancel** → `DELETE /api/howard/actions/[id]` → status `cancelled`. No side effect.

Each execution re-validates the target row (e.g. squawk_resolve re-checks `status='open'` and scopes the UPDATE with a `status='open'` WHERE guard to defeat racing writers).

On successful confirm, the card calls `globalMutate(matchesAircraft(action.aircraft_id))` so every SWR-cached view of the affected aircraft (squawks, grounded banner, calendar, summary) refreshes immediately.

### Rate limit (`src/lib/howard/rateLimit.ts`)

`howard_rate_limit_check` RPC: 20 requests per rolling 60s per user, atomic via `SELECT FOR UPDATE`. Fails open on infrastructure error (logged).

### Conversation storage

Per-user single thread (`aft_howard_user_threads`). Messages in `aft_howard_messages`. Token usage recorded per message for the admin usage rollup.

---

## Airworthiness Engine (`src/lib/airworthiness.ts`)

`computeAirworthinessStatus(inputs)` returns a verdict `{ status: 'airworthy' | 'issues' | 'grounded', citation?, reason?, findings[] }`. Each finding carries severity (`grounded` / `warning`), citation (e.g. `91.413`), and a human-readable message.

**Checks:**
- **91.207 ELT** — battery expired / cumulative use ≥ 1hr / no ELT tracked.
- **91.413 Transponder** — 24-month check expired.
- **91.411 Altimeter + Pitot-Static** — 24-month checks (IFR-equipped aircraft only).
- **91.171 VOR check** — >30 days old (IFR only; warning-level).
- **Squawks** — any `open` squawk with `affects_airworthiness=true` grounds.
- **MX items (91.417)** — required items past due time or date.
- **ADs (91.417(b))** — active, non-superseded ADs past `next_due_time` or `next_due_date`.

**Equipment-tracked flag:** If the equipment list is completely empty, ELT-category checks are skipped (treated as "tracking not set up" rather than "missing"). Once any equipment row exists, full validation runs.

Called by Howard's `check_airworthiness` tool and by `useGroundedStatus` (UI banner).

---

## FAA DRS AD Sync (`src/lib/drs.ts`)

`/api/cron/ads-sync` runs daily at 06:00 UTC. For each non-deleted aircraft with make+model populated, calls `syncAdsForAircraft(sb, aircraft)` which:

1. Fetches the FAA DRS feed (default `https://drs.faa.gov/api/public/search/ads`, overridable via `FAA_DRS_FEED_URL`).
2. Parses into normalized AD records.
3. Hashes each for change detection (`sync_hash`).
4. Upserts rows, marking any previously-synced AD no longer in the feed as `is_superseded=true`.

On-demand refresh via Howard's `refresh_ads_drs` tool or the "Refresh" button on the ADs tab.

---

## Soft-Delete + Audit Trail (migration 009)

Generic trigger `log_record_history()` attached to all soft-delete tables. Captures INSERT / UPDATE / DELETE with:
- `user_id` — prefers row columns (`NEW.created_by` on INSERT, `NEW.deleted_by` on update where `deleted_at` transitioned). Falls back to session `app.current_user_id` set by `set_app_user(p_user_id)`.
- `old_row` / `new_row` — full `row_to_json` snapshots.

Soft-delete is performed via `softDelete(sb, table, column, value, userId)` from `src/lib/audit.ts`. The helper calls `setAppUser()` first so UPDATE triggers attribute correctly. All list reads filter `is('deleted_at', null)`.

The earlier transaction-boundary concern (trigger ran before session var was set) was resolved by migration 019 — trigger now prefers row columns, session var is belt-and-suspenders.

---

## Observability

### Request IDs (`src/lib/requestId.ts`)

`getRequestId(req)` reads `x-request-id` or `x-vercel-id` (Vercel sets one on every invocation) or generates a UUID. Returned by `requireAuth`. `logError(message, error, {requestId, route, userId, extra})` writes a greppable console line AND forwards to Sentry (dynamic import — Sentry SDK isn't pulled in when DSN absent). `logEvent(event, data)` is the non-error variant — Sentry breadcrumb + console.

`handleApiError(error, req?)` attaches the request ID to the JSON response body AND the `x-request-id` header.

### Sentry wiring

Per-runtime configs: `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`. All no-op when `SENTRY_DSN` is unset. `instrumentation.ts` + `withSentryConfig` in `next.config.mjs` wire the Next.js instrumentation API.

### Telemetry events currently emitted

- `howard_tool_truncated` — `capResultSize` trimmed a tool result.
- `howard_notam_parse_failed` — FAA NOTAM response didn't match expected shape.

---

## SWR Key Factory (`src/lib/swrKeys.ts`)

Centralized key constructors so `useFleetData.refreshForAircraft` can match reliably. Every aircraft-scoped key follows `<domain>-<aircraftId>[-<extra>]`. The `matchesAircraft(id)` matcher returns a regex that anchors the UUID between `-`, `_`, `/`, or string end — defense-in-depth against false matches.

`ProposedActionCard` uses `globalMutate(matchesAircraft(...))` on successful Howard-action confirmation so affected tabs repaint without a manual refresh.

---

## API Response Helpers (`src/lib/apiResponse.ts`)

Discriminated-union type `ApiResponse<T> = { ok: true; data: T; requestId? } | { ok: false; error: string; requestId? }`. `apiOk(data)` / `apiError(msg, status, req)` helpers available for new routes. Existing routes adopt incrementally — `handleApiError` now emits the `ok: false` shape additively (old `{error: ...}` body still works on the client).

---

## PG Errors → Friendly Messages (`src/lib/pgErrors.ts`)

`friendlyPgError(error)` maps Postgres codes (`23505`, `23503`, `23502`, `23514`, `22001`, `P0001`, `42501`, `PGRST301`, etc.) to user-safe sentences. Used in SettingsModal, AircraftModal, and the atomic flight-log routes so a constraint violation becomes "Already in use: tail number. Pick a different value." rather than a raw PG diagnostic.

---

## Notification System

### Recipient Matrix

| Event | Recipients | Excludes |
|-------|-----------|----------|
| Squawk reported | All assigned pilots | Reporter |
| Note posted | All assigned pilots | Author |
| Reservation created | All assigned pilots | Creator |
| Reservation cancelled | All assigned pilots | Canceller |
| MX conflict cancellation | Affected reservation owners | — |
| MX reminders (cron) | Primary contact only | — |
| Service updates (mechanic) | Primary contact only | — |
| Draft work package created | Primary contact only | — |
| Work package to mechanic | Mechanic + CC primary contact | — |

**Primary contact** is identified by matching `aircraft.main_contact_email` on the aircraft record.

### Settings UI Scoping

The `NOTIFICATION_TYPES` array in `types.ts` includes a `primaryContactOnly` flag. The SettingsModal checks whether the current user's email matches `main_contact_email` on any of their assigned aircraft. If not, the `mx_reminder` and `service_update` toggles are hidden.

---

## Realtime Architecture

Subscribes to a single Supabase Realtime channel namespaced per user (`fleet-updates:${userId}` — prevents cross-tenant collisions) listening to tracked tables. Aircraft-scoped refresh: events with `aircraft_id` trigger a targeted re-fetch of that aircraft's master record and SWR cache invalidation via `matchesAircraft(id)`. Events without `aircraft_id` trigger a lightweight SWR-only revalidation. Per-aircraft debounce timers (1.5s) prevent hammering the DB. Events caused by the current user are skipped.

---

## Predictive Maintenance Engine (`src/lib/math.ts`)

Computes burn rate (active-days weighted), weekly variance, confidence score (0-100%), and projected days for time-based MX items.

**Cron automation (`/api/cron/mx-reminders`)** runs a four-phase per-aircraft pipeline plus a global pickup-nudge pass:

1. **Evaluate** — Computes remaining hours/days + projected days for every MX item. Skips items already in active events.
2. **Aggregate Scheduling** — If any item triggers a draft, creates ONE draft containing that item plus all other items within a 30-day aggregation window. Single email to primary contact.
3. **Low-Confidence Heads-Up** — Items that hit the predictive window but have low confidence get a consolidated heads-up email (no draft).
4. **Internal Reminders** — Threshold-based awareness alerts per-item to the primary contact.
5. **Ready-for-Pickup Nudge** — Events sitting in `ready_for_pickup` for >3 days without owner close-out get a nudge email (marker message prevents re-nudging on every tick).

**Automation thresholds:**
- High confidence (≥80%) + predictive window → auto-create aggregate draft.
- Low confidence (<80%) + predictive window → heads-up only.
- Hard threshold hit (time or date) → always create draft.

Email-send failure aborts the "sent" flag flip — the next cron tick retries. DB writes happen regardless of email send (the draft is the authoritative record).

---

## Pull to Refresh

`src/hooks/usePullToRefresh.ts` + `src/components/PullIndicator.tsx`.

Built for iOS PWA standalone mode. Native `document.addEventListener('touchmove', handler, { passive: false })` intercepts the vertical pull before iOS can trigger rubber-band. During a pull, the scroll container's `overflow` is temporarily set to `hidden`. Content never moves — no `transform`, no height injection. The indicator is a fixed-position pill that slides down from behind the header bar.

**Phase flow:** `idle → pulling → refreshing → done → idle`.

---

## Session Recovery

Auth initialization in `page.tsx` handles three scenarios:

1. **Expired refresh token on load** — `getSession()` error → `signOut()` + login screen.
2. **Token refresh failure during use** — `onAuthStateChange('TOKEN_REFRESHED')` with no session → sign out.
3. **App returning from background** — `visibilitychange` listener re-checks session when foregrounded.

---

## Modal Safe-Area Insets

Every popup in the app wraps its backdrop with `fixed inset-0 ... animate-fade-in`. On iOS, that covers the dynamic-island / notch area and the home-indicator bar, so sticky X buttons could fall behind system UI.

A CSS attribute selector in `globals.css` auto-applies safe-area padding to every modal wrapper:

```css
[class~="animate-fade-in"][class*="fixed inset-0"],
.modal-overlay {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

Backdrop color still paints the padded area (full-bleed visually) while scroll content is inset inside the reachable region. HowardLauncher uses a custom animation and gets the same behavior via the explicit `.modal-overlay` class.

---

## Key Technical Constraints

- **tsconfig `target: "es5"`** — no native `[...new Set()]`. Use `Array.from(...)` or `Object.keys()` instead of `Map` iteration. (Turbopack handles downlevel.)
- **tsconfig `strict: true`** — typed everywhere except `catch (e: any)` (standard pattern) and a few Supabase admin-client result rows where the return shape isn't worth the generic churn.
- **Tailwind v4** — uses `@theme` directive in `globals.css`.
- **iOS Safari forms** — requires `-webkit-appearance: none` before `background-color` takes effect. Applied globally in `globals.css`.
- **iOS PWA touch events** — React's synthetic touch events use passive listeners on iOS. To `preventDefault()` on touchmove, attach a native listener with `{ passive: false }`.
- **`overscroll-behavior-y: contain`** — applied to `<main>` to prevent browser pull-to-refresh.
- **browser-image-compression** — all image uploads compressed client-side before upload.
- **Modal z-index** — nav bars at `z-[9999]`, modals at `z-[10000]`+; HowardLauncher at `z-[99999]`.
- **Network egress** — disabled in the sandbox/development environment.

---

## Hook Architecture

| Hook | Location | Purpose |
|------|----------|---------|
| `useFleetData` | `src/hooks/useFleetData.ts` | Session-driven data fetching, role resolution, aircraft lists, global SWR mutation + `refreshForAircraft` |
| `useRealtimeSync` | `src/hooks/useRealtimeSync.ts` | Supabase Realtime subscription with aircraft-scoped refresh and self-filtering |
| `useGroundedStatus` | `src/hooks/useGroundedStatus.ts` | Wraps `computeAirworthinessStatus` into a per-aircraft banner state |
| `useAircraftRole` | `src/hooks/useAircraftRole.ts` | Resolves the current user's per-aircraft role |
| `useModalScrollLock` | `src/hooks/useModalScrollLock.ts` | Locks body scroll while a modal is open |
| `usePullToRefresh` | `src/hooks/usePullToRefresh.ts` | iOS PWA pull-to-refresh with native touch event handling |
| `useBodyScrollOverride` | `src/hooks/useBodyScrollOverride.ts` | Body overflow override for portal/viewer pages |

---

## Shared Libraries

- `airworthiness.ts` — `computeAirworthinessStatus`, citation-tagged verdict.
- `apiResponse.ts` — `apiOk` / `apiError` / `ApiResponse<T>`.
- `audit.ts` — `setAppUser`, `softDelete`, `SOFT_DELETE_TABLES` registry.
- `auth.ts` — `requireAuth`, `requireAircraftAccess`, `requireAircraftAdmin`, `handleApiError`, `createAdminClient`.
- `authFetch.ts` — client fetch with session token auto-attach.
- `constants.ts` — file size limits + lookback windows.
- `dateFormat.ts` — timezone-aware date/time formatting for emails.
- `drs.ts` — FAA DRS feed fetch + parse for the nightly cron.
- `env.ts` — env var validation at boot.
- `howard/claude.ts` — Anthropic streaming loop, cache-control on stable prelude.
- `howard/proposedActions.ts` — propose-confirm framework (`proposeAction`, `executeAction`, `summarize`, role map).
- `howard/rateLimit.ts` — `checkRateLimit` via Supabase RPC.
- `howard/systemPrompt.ts` — `HOWARD_STABLE_PRELUDE` + `buildUserContext`.
- `howard/toolHandlers.ts` — 24 handlers, access re-check, `capResultSize`.
- `howard/tools.ts` — Claude tool schema definitions.
- `howard/types.ts` — HowardMessage + related types.
- `math.ts` — burn rate, variance, confidence, `isMxExpired`, projection.
- `mxConflicts.ts` — `cancelConflictingReservations`.
- `mxTemplates.ts` — static MX templates per aircraft type.
- `pgErrors.ts` — `friendlyPgError`.
- `requestId.ts` — `getRequestId`, `logError`, `logEvent`.
- `sanitize.ts` — `escapeHtml`.
- `styles.ts` — shared Tailwind class strings for iOS-fixed inputs.
- `supabase.ts` — browser-side client singleton.
- `swrCache.ts` — localStorage-backed SWR cache provider.
- `swrKeys.ts` — key factory + `matchesAircraft`.
- `types.ts` — all TypeScript types.

---

## Partial Completion + 43.11 Signoff

Service events support completing line items individually via `/api/mx-events/complete`. For each completed item:

1. Line item status set to `complete` with 43.11 signoff fields (cert_type, cert_number, cert_expiry, tach/hobbs at completion, logbook_ref, work_description, completed_by_name).
2. Linked MX item: tracking resets (reminder flags cleared, due_time/due_date recalculated from interval).
3. Linked squawk: resolved + `resolved_by_event_id` set to the event id.

Completed line items **lock** via a trigger — attempting to edit raises `P0003`.

After processing, if all items are resolved (complete or deferred) the event auto-closes. Otherwise it stays open with a system message listing what was done.

---

## Migrations

Files live in `supabase/migrations/` (see README there). Each is idempotent. Run in numeric order on a fresh environment.

| File | Contents |
|------|----------|
| 001–004 | Initial schema (pre-bulletproofing): mechanic attachments, roles + calendar + notifications, squawk cross-reference, schema optimization |
| `005_user_preferences.sql` | Generic `aft_user_preferences` KV with RLS |
| `006_log_tabs.sql` | `aft_vor_checks`, `aft_tire_checks`, `aft_oil_logs` |
| `007_chuck.sql` | Original Chuck tables (renamed to Howard in 016) |
| `008_documents.sql` | RAG tables + pgvector + `match_document_chunks` RPC |
| `009_soft_delete_audit.sql` | `deleted_at`/`deleted_by` on 11 tables, `aft_record_history`, `log_record_history` trigger, `set_app_user` helper, SHA-256 + file_size on documents |
| `010_flight_log_atomic.sql` | `log_flight_atomic` RPC |
| `011_dual_interval_mx.sql` | Relaxes `tracking_type` CHECK to include `'both'` |
| `012_airworthiness_directives.sql` | `aft_airworthiness_directives` + RLS + history trigger + `updated_at` auto-bump |
| `013_aircraft_equipment.sql` | `aft_aircraft_equipment` with capability flags + RLS, adds `make`/`model`/`year_mfg`/`is_ifr_equipped`/`is_for_hire` to `aft_aircraft` |
| `014_signoff_completeness.sql` | 43.11 fields on `aft_event_line_items`, lock-on-complete trigger |
| `015_proposed_actions.sql` | `aft_proposed_actions` + RLS |
| `016_rename_chuck_to_howard.sql` | Renames Chuck tables/policies to Howard |
| `017_howard_user_threads.sql` | Per-user thread model (supersedes per-aircraft). Wipes pre-prod Howard history |
| `018_pilot_ratings.sql` | `faa_ratings text[]` on `aft_user_roles` |
| `019_audit_from_row_columns.sql` | Trigger prefers row columns over session var; resolves transaction-boundary concern |
| `020_howard_rate_limit.sql` | `aft_howard_rate_limit` + `howard_rate_limit_check` RPC |
| `021_edit_flight_log_atomic.sql` | `edit_flight_log_atomic` RPC for PUT `/flight-logs` |
| `022_delete_flight_log_atomic.sql` | `delete_flight_log_atomic` RPC for DELETE `/flight-logs` |
| `023_ads_unique_live.sql` | Partial UNIQUE INDEX on `(aircraft_id, ad_number) WHERE deleted_at IS NULL` — soft-deleted ADs no longer block resurrection |

Migrations are applied via the Supabase SQL Editor. Storage buckets are created via the Supabase Storage UI.
