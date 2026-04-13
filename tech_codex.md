# Skyward Aircraft Manager — Technical Codex

Complete technical reference for developers working on the Skyward Aircraft Manager codebase. This document covers the database schema, API surface, authentication model, realtime architecture, and key implementation details.

---

## Database Schema

### aft_aircraft
Aircraft master records. The `created_by` field references `auth.users(id)` with `ON DELETE SET NULL` — deleting a user preserves the aircraft but clears the creator reference. The account delete route handles cascade cleanup via application logic.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tail_number | text UNIQUE | e.g. "N12345" |
| serial_number | text | Optional |
| aircraft_type | text | e.g. "Cessna 172" |
| engine_type | text | "Piston" or "Turbine" |
| total_airframe_time | numeric | Running total (Hobbs or AFTT) |
| total_engine_time | numeric | Running total (Tach or FTT) |
| setup_hobbs | numeric | Initial Hobbs at setup |
| setup_tach | numeric | Initial Tach at setup |
| setup_aftt | numeric | Initial AFTT at setup (turbine) |
| setup_ftt | numeric | Initial FTT at setup (turbine) |
| home_airport | text | ICAO identifier |
| main_contact | text | Primary contact name |
| main_contact_phone | text | |
| main_contact_email | text | Used to identify the primary contact for notification routing |
| mx_contact | text | Maintenance contact name |
| mx_contact_phone | text | |
| mx_contact_email | text | |
| avatar_url | text | Supabase Storage public URL |
| current_fuel_gallons | numeric | Last reported fuel state |
| fuel_last_updated | timestamptz | |
| created_by | uuid FK → auth.users | ON DELETE SET NULL |
| created_at | timestamptz | |

**Setup vs Total times:** The `setup_*` fields record the baseline times when the aircraft was added to the system. The `total_*` fields are the current cumulative times, incremented by each flight log. When editing an aircraft, the system checks for flight logs: if none exist, totals are set equal to the new setup values. If flights exist, totals are left at the latest log's cumulative values since they represent the true current state.

### aft_flight_logs
One row per flight. Times are cumulative (new Hobbs, not delta).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK → aft_aircraft | ON DELETE CASCADE |
| user_id | uuid FK → auth.users | ON DELETE SET NULL |
| pod | text | Point of departure (ICAO). Normalized from varchar(10) to text in migration 004. |
| poa | text | Point of arrival (ICAO). Normalized from varchar(10) to text in migration 004. |
| hobbs | numeric | Cumulative Hobbs (piston) |
| tach | numeric | Cumulative Tach (piston) |
| aftt | numeric | Cumulative AFTT (turbine) |
| ftt | numeric | Cumulative FTT (turbine) |
| engine_cycles | integer | Turbine only |
| landings | integer | |
| initials | text | Pilot initials |
| pax_info | text | Passenger names/notes |
| trip_reason | text | PE, BE, MX, T |
| fuel_gallons | numeric | Fuel state after flight |
| created_at | timestamptz | |

### aft_maintenance_items
Tracked maintenance items. Each has a tracking type (time-based or date-based) and optional automated scheduling.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| item_name | text | e.g. "Annual Inspection" |
| tracking_type | text | "time" or "date" |
| is_required | boolean | Required items ground the aircraft when expired |
| last_completed_time | numeric | Engine time at last completion |
| time_interval | numeric | Hours between service |
| due_time | numeric | Computed: last + interval |
| last_completed_date | date | |
| date_interval_days | integer | Days between service |
| due_date | date | Computed: last + interval |
| automate_scheduling | boolean | Auto-create drafts when approaching |
| mx_schedule_sent | boolean | Draft created flag |
| primary_heads_up_sent | boolean | Low-confidence heads-up sent |
| reminder_5_sent | boolean | Reminder threshold 3 flag |
| reminder_15_sent | boolean | Reminder threshold 2 flag |
| reminder_30_sent | boolean | Reminder threshold 1 flag |
| created_at | timestamptz | |

### aft_maintenance_events
Service event lifecycle. Status flow: draft → scheduling → confirmed → in_progress → ready_for_pickup → complete. Cancel/decline branches available at any point.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| status | text | See status flow above |
| access_token | text UNIQUE | 256-bit hex for mechanic portal |
| proposed_date | date | |
| proposed_by | text | "owner" or "mechanic" |
| confirmed_date | date | Agreed service date |
| confirmed_at | timestamptz | |
| estimated_completion | date | Mechanic's estimate |
| completed_at | timestamptz | When owner entered logbook data |
| mechanic_notes | text | |
| addon_services | jsonb | Array of add-on service names |
| mx_contact_name | text | |
| mx_contact_email | text | |
| primary_contact_name | text | |
| primary_contact_email | text | |
| created_at | timestamptz | |

**Portal token expiry:** Access is rejected (403) if the event was completed more than 7 days ago. Enforced both client-side (portal page shows "Link Has Expired") and server-side (respond + upload-attachment routes).

### aft_event_line_items
Line items in a work package. Supports partial completion — individual items can be completed while others remain open.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK → aft_maintenance_events | ON DELETE CASCADE |
| item_type | text | "maintenance", "squawk", or "addon" |
| maintenance_item_id | uuid FK | Nullable, links to aft_maintenance_items |
| squawk_id | uuid FK | Nullable, links to aft_squawks |
| item_name | text | |
| item_description | text | |
| line_status | text | "pending", "in_progress", "complete", "deferred" |
| mechanic_comment | text | |
| completion_date | date | Date from mechanic's logbook entry |
| completion_time | numeric | Engine time at completion |
| completed_by_name | text | Mechanic/IA name |
| completed_by_cert | text | Certificate number |
| work_description | text | Description of work performed |
| created_at | timestamptz | |

### aft_event_messages
Communication thread for a service event. Attachments stored as jsonb on the message.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK → aft_maintenance_events | ON DELETE CASCADE |
| sender | text | "owner", "mechanic", or "system" |
| message_type | text | "comment", "propose_date", "confirm", "status_update" |
| message | text | |
| proposed_date | date | For date proposals |
| attachments | jsonb | Array of {url, filename, size, type} |
| created_at | timestamptz | |

### aft_squawks
Discrepancy reports with optional MEL/CDL deferral support and service event cross-reference.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| reported_by | uuid FK → auth.users | ON DELETE SET NULL |
| reporter_initials | text | |
| location | text | Airport ICAO |
| description | text | |
| affects_airworthiness | boolean | True = aircraft grounded |
| status | text | "open" or "resolved" |
| pictures | jsonb | Array of public URLs |
| is_deferred | boolean | Turbine deferral |
| mel_number | text | MEL reference |
| cdl_number | text | CDL reference |
| nef_number | text | NEF reference |
| mdl_number | text | MDL reference |
| mel_control_number | text | |
| deferral_category | text | A, B, C, D, or N/A |
| deferral_procedures_completed | boolean | |
| full_name | text | Signee name |
| certificate_number | text | |
| signature_data | text | Base64 PNG |
| signature_date | date | |
| resolved_by_event_id | uuid FK → aft_maintenance_events | ON DELETE SET NULL. Records which service event resolved this squawk. |
| created_at | timestamptz | |

### aft_notes
Pilot-to-pilot notes with photos and read receipts.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| author_id | uuid FK → auth.users | ON DELETE SET NULL |
| author_email | text | |
| author_initials | text | |
| content | text | |
| pictures | jsonb | Array of public URLs |
| edited_at | timestamptz | |
| created_at | timestamptz | |

### aft_note_reads
Read receipts for notes. Composite PK on (note_id, user_id). Both columns have FKs: `note_id → aft_notes(id)`, `user_id → auth.users(id) ON DELETE CASCADE`.

### aft_user_profiles
User display names and email, used by admin/users listing and mechanic portal block creation.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK FK → auth.users | ON DELETE CASCADE |
| full_name | text | Display name |
| email | text | |
| updated_at | timestamptz | Default now() |

### aft_user_roles
Global role assignment. One row per user.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid FK → auth.users | ON DELETE CASCADE |
| role | text | "admin" or "pilot" |
| email | text | |
| initials | text | |
| full_name | text | Display name (consolidated from profiles) |

### aft_user_aircraft_access
Per-aircraft access with role. Links users to aircraft they can see. Composite PK on `(user_id, aircraft_id)`.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid FK → auth.users | ON DELETE CASCADE. Part of composite PK. |
| aircraft_id | uuid FK → aft_aircraft | ON DELETE CASCADE. Part of composite PK. |
| aircraft_role | text | "admin" or "pilot", default "pilot" |

### aft_reservations
Calendar bookings. Exclusion constraint prevents overlapping confirmed reservations on the same aircraft using `tstzrange` with `btree_gist`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| user_id | uuid FK → auth.users | ON DELETE SET NULL |
| start_time | timestamptz | |
| end_time | timestamptz | Must be after start_time |
| title | text | Purpose/description |
| route | text | e.g. "KDAL → KAUS → KDAL" |
| pilot_name | text | Denormalized for display |
| pilot_initials | text | |
| status | text | "confirmed" or "cancelled" |
| created_at | timestamptz | |
| time_zone | text | IANA zone the booker was in when creating/editing. Used so emails and viewers in other zones see the booker's local time with the zone abbreviation. Nullable for legacy rows. |

### aft_notification_preferences
Per-user notification toggles. PK is the natural composite key `(user_id, notification_type)` — the surrogate UUID `id` column was removed in migration 004.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid FK → auth.users | ON DELETE CASCADE. Part of composite PK. |
| notification_type | text | See types below. Part of composite PK. |
| enabled | boolean | |
| created_at | timestamptz | |

**Notification types:** `reservation_created`, `reservation_cancelled`, `squawk_reported`, `mx_reminder`, `service_update`, `note_posted`

### aft_system_settings
Global configuration. Single row (id=1).

| Column | Type | Notes |
|--------|------|-------|
| reminder_1 | integer | Days for first reminder (default 30) |
| reminder_2 | integer | Days for second reminder (default 15) |
| reminder_3 | integer | Days for third reminder (default 5) |
| reminder_hours_1 | numeric | Hours for first reminder (default 30) |
| reminder_hours_2 | numeric | Hours for second reminder (default 15) |
| reminder_hours_3 | numeric | Hours for third reminder (default 5) |
| sched_time | numeric | Hours threshold for auto-scheduling (default 10) |
| sched_days | integer | Days threshold for auto-scheduling (default 30) |
| predictive_sched_days | integer | Predictive threshold (default 45) |

---

## Storage Buckets

| Bucket | Public | Purpose |
|--------|--------|---------|
| aft_squawk_images | Yes | Squawk photos |
| aft_note_images | Yes | Note attachments |
| aft_aircraft_avatars | Yes | Aircraft hero images |
| aft_event_attachments | Yes | Mechanic file uploads |

All uploads use the service role key (bypasses RLS). Client-side compression via `browser-image-compression` before upload. 10MB limit enforced both client-side (`validateFileSize` / `validateFileSizes` from `@/lib/constants`) and server-side on the upload-attachment route.

---

## API Routes

### Authentication Pattern
All authenticated routes use `requireAuth(req)` from `@/lib/auth.ts`, which extracts the Bearer token, verifies it against Supabase Auth, and returns `{ user, supabaseAdmin }`. Admin-only routes use `requireAuth(req, 'admin')`.

**Aircraft access verification:** Routes that operate on a specific aircraft call `requireAircraftAccess(supabaseAdmin, userId, aircraftId)` after `requireAuth()`. Global admins bypass the check. All others must have a row in `aft_user_aircraft_access`. Throws 403 if no access.

**Aircraft admin verification:** Routes restricted to aircraft admins use `requireAircraftAdmin(supabaseAdmin, userId, aircraftId)` which verifies the user is either a global admin or has `aircraft_role = 'admin'` on the specific aircraft. Throws 403 otherwise.

**Error handling:** All routes use `handleApiError(error)` from `@/lib/auth.ts` to produce consistent JSON error responses.

Client-side calls use `authFetch()` from `@/lib/authFetch.ts` which auto-attaches the session token.

### Route Reference

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/aircraft/create` | POST | Auth | Create aircraft, set creator as admin |
| `/api/aircraft/delete` | DELETE | Auth | Delete aircraft (admin or aircraft admin) |
| `/api/aircraft-access` | PUT | Auth | Change a user's aircraft role |
| `/api/aircraft-access` | DELETE | Auth | Remove user from aircraft (cancels future reservations) |
| `/api/account/delete` | GET | Auth | Preview deletion impact (owned aircraft, affected users) |
| `/api/account/delete` | DELETE | Auth | Delete own account (cascades to owned aircraft) |
| `/api/admin/db-health` | POST | Admin | Cleanup old records, sweep orphaned files |
| `/api/admin/users` | GET | Admin | List all users with their aircraft assignments |
| `/api/invite` | POST | Admin | Invite global admin or standalone pilot |
| `/api/pilot-invite` | POST | Auth | Invite user to specific aircraft with role |
| `/api/flight-logs` | POST/PUT/DELETE | Auth + Aircraft | Flight log CRUD with numeric validation |
| `/api/maintenance-items` | POST/PUT/DELETE | Auth + Aircraft Admin | Maintenance item CRUD |
| `/api/notes` | POST/PUT/DELETE | Auth + Aircraft | Note CRUD |
| `/api/squawks` | POST/PUT/DELETE | Auth + Aircraft | Squawk CRUD |
| `/api/reservations` | POST | Auth | Create reservation (conflict detection + notifications) |
| `/api/reservations` | DELETE | Auth | Cancel reservation (permission check + notifications) |
| `/api/mx-events/block` | POST | Auth + Aircraft Admin | Create MX calendar block (cancels conflicting reservations) |
| `/api/mx-events/create` | POST | Auth + Aircraft | Create service event / work package |
| `/api/mx-events/complete` | POST | Auth + Aircraft | Complete event items (supports partial completion) |
| `/api/mx-events/respond` | POST | Token | Mechanic portal actions + MX conflict resolution on confirm |
| `/api/mx-events/upload-attachment` | POST | Token | Mechanic file uploads (10MB limit, 5 files max) |
| `/api/mx-events/owner-action` | POST | Auth + Aircraft | Owner scheduling responses + MX conflict resolution on confirm |
| `/api/mx-events/send-workpackage` | POST | Auth + Aircraft | Send/resend work package email |
| `/api/emails/squawk-notify` | POST | Auth + Aircraft | Send squawk notification emails |
| `/api/emails/note-notify` | POST | Auth + Aircraft | Send note notification emails |
| `/api/emails/mx-schedule` | POST | Auth + Aircraft | Send MX scheduling email |
| `/api/cron/mx-reminders` | GET | CRON | Automated MX reminders + aggregate work package creation |
| `/api/users` | DELETE | Admin | Delete a user account (admin only) |
| `/api/resend-invite` | POST | None | Re-send Supabase auth invitation |
| `/api/version` | GET | None | Returns current app version |

---

## Shared Libraries

### `src/lib/mxConflicts.ts`
Handles MX calendar conflict resolution. When a maintenance event date is confirmed, `cancelConflictingReservations()` finds all confirmed reservations on that aircraft whose time range overlaps with the MX block (confirmed_date through estimated_completion, or +1 day if no estimate), cancels them, and emails each affected pilot with their cancelled booking details and the maintenance dates.

Called from two trigger points:
- `owner-action/route.ts` — owner confirms mechanic's proposed date
- `respond/route.ts` — mechanic confirms owner's proposed date

### `src/lib/dateFormat.ts`
Timezone-aware date formatting for email notifications. Used for rendering reservation times in server-side email templates where `toLocaleString()` defaults to the host's system timezone.

### `src/lib/mxTemplates.ts`
Static maintenance template library for common aircraft types. Contains manufacturer-required and recommended maintenance items that can be bulk-imported when setting up a new aircraft.

### `src/lib/sanitize.ts`
HTML sanitization for user-provided strings before inserting them into HTML email templates or any HTML context.

### `src/lib/styles.ts`
Shared style constants for iOS Safari form input fixes. Eliminates duplication of `-webkit-appearance` background override values across components.

### `src/lib/swrCache.ts`
SWR persistent cache provider backed by `localStorage`. Keyed as `aft_swr_cache`, allows cached data to survive page reloads.

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

The app subscribes to a single Supabase Realtime channel (`fleet-updates`) listening to 8 tables. Aircraft-scoped refresh: events with `aircraft_id` trigger a targeted re-fetch of that aircraft's master record and SWR cache invalidation. Events without `aircraft_id` trigger a lightweight SWR-only revalidation. Per-aircraft debounce timers (1.5s) prevent hammering the DB. Events caused by the current user are skipped.

---

## Predictive Maintenance Engine

Located in `@/lib/math.ts`. Computes burn rate (active-days weighted), weekly variance, confidence score (0-100%), and projected days for time-based MX items.

**CRON Automation (`/api/cron/mx-reminders`):**

The CRON runs a four-phase per-aircraft pipeline:
1. **Evaluate** — Computes remaining hours/days and projected days for every MX item.
2. **Aggregate Scheduling** — If any item triggers a draft, creates ONE draft containing that item plus all other items within a 30-day aggregation window. Single email to primary contact listing all bundled items.
3. **Low-Confidence Heads-Up** — Items that hit the predictive window but have low confidence get a consolidated heads-up email (no draft).
4. **Internal Reminders** — Threshold-based awareness alerts per-item to the primary contact.

**Automation thresholds:**
- High confidence (≥80%) + within predictive window → auto-create aggregate draft
- Low confidence (<80%) + within predictive window → send consolidated heads-up only
- Hard threshold hit (time or date) → always create draft regardless of confidence

---

## Pull to Refresh

Located in `src/hooks/usePullToRefresh.ts` and `src/components/PullIndicator.tsx`.

Built specifically for iOS PWA standalone mode. Uses a native `document.addEventListener('touchmove', handler, { passive: false })` to intercept the vertical pull gesture before iOS can trigger its native rubber-band bounce. During a pull, the scroll container's `overflow` is temporarily set to `hidden` to prevent iOS overscroll.

The page content never moves — no `transform: translateY`, no height injection, no layout shifts. The indicator is a fixed-position pill-shaped badge that slides down from behind the header bar.

**Phase flow:** `idle → pulling → refreshing → done → idle`

The `onRefresh` callback re-fetches all aircraft data, revalidates all SWR caches, refreshes grounded status, and rechecks unread notes. No page reload occurs.

---

## Session Recovery

The auth initialization in `page.tsx` handles three failure scenarios:

1. **Expired refresh token on load:** `getSession()` returns an error → app calls `signOut()` and shows the login screen.
2. **Token refresh failure during use:** `onAuthStateChange` with `TOKEN_REFRESHED` event updates the session silently. If the event fires with no session, the user is signed out.
3. **App returning from background:** A `visibilitychange` listener calls `getSession()` when the app comes to the foreground. If the session is gone, the user is signed out cleanly.

---

## Key Technical Constraints

- **tsconfig target: es5** — No `[...new Set()]`. Use `Array.from(new Set(...))` or `Object.keys()` instead of `Map` iteration.
- **tsconfig strict: false** — Supabase client typed as `SupabaseClient<any, any, any>` for admin client.
- **Tailwind v4** — Uses `@theme` directive in `globals.css`.
- **iOS Safari forms** — Requires `-webkit-appearance: none` before `background-color` takes effect. Applied globally in `globals.css`.
- **iOS PWA touch events** — React's synthetic touch events use passive listeners on iOS Safari. To call `preventDefault()` on touchmove, a native event listener with `{ passive: false }` must be attached via `addEventListener`.
- **`overscroll-behavior-y: contain`** — Applied to `<main>` via both inline style and `globals.css` to prevent native pull-to-refresh in browsers and PWAs.
- **browser-image-compression** — All image uploads are compressed client-side before uploading.
- **Modal z-index** — Nav bars at `z-[9999]`, all modals at `z-[10000]` minimum.
- **Network egress** — Disabled in the sandbox/development environment.

---

## Hook Architecture

| Hook | Location | Purpose |
|------|----------|---------|
| `useFleetData` | `src/hooks/useFleetData.ts` | Session-driven data fetching, role resolution, aircraft lists, SWR mutation |
| `useRealtimeSync` | `src/hooks/useRealtimeSync.ts` | Supabase Realtime subscription with aircraft-scoped refresh and self-filtering |
| `useGroundedStatus` | `src/hooks/useGroundedStatus.ts` | Computes aircraft airworthiness from MX items and squawks |
| `useAircraftRole` | `src/hooks/useAircraftRole.ts` | Resolves the current user's per-aircraft role from access records |
| `usePullToRefresh` | `src/hooks/usePullToRefresh.ts` | iOS PWA pull-to-refresh with native touch event handling |
| `useBodyScrollOverride` | `src/hooks/useBodyScrollOverride.ts` | Overrides body overflow for pages needing native scrolling (service portal, squawk viewer) |

---

## Partial Completion

Service events support completing line items individually via the `/api/mx-events/complete` route. The `partial` flag in the request body indicates the caller expects to complete only some items. For each completed item:

1. Line item status set to `complete` with logbook data (date, time, mechanic, cert, work description)
2. If linked to an MX item, tracking resets (reminder flags cleared, due time/date recalculated from interval)
3. If linked to a squawk, the squawk is resolved and `resolved_by_event_id` is set

After processing, the route checks if all items are resolved (complete or deferred). If so, the event is auto-closed. If not, the event stays open with a system message listing what was completed.

The UI (ServiceEventModal) shows checkboxes next to each pending item in the completion view. Users can uncheck items they want to leave open. The "Complete" button dynamically shows the count of selected items. When all items are eventually resolved, a "Close Service Event" banner appears.

---

## Migrations

| File | Contents |
|------|----------|
| `001_mechanic_attachments.sql` | `attachments` jsonb column on `aft_event_messages`, partial index |
| `002_roles_calendar_notifications.sql` | `aircraft_role` column, `aft_reservations` with exclusion constraint, `aft_notification_preferences`, CASCADE on `created_by`, `btree_gist` extension |
| `003_squawk_cross_reference.sql` | `resolved_by_event_id` on `aft_squawks`, completion tracking columns on `aft_event_line_items` |
| `004_schema_optimization.sql` | Drop redundant index, add MX due-date index, normalize pod/poa to text, create `aft_user_profiles`, add all missing FKs to `auth.users`, swap notification_preferences PK to natural key |
| `005_user_preferences.sql` | Generic `aft_user_preferences` key-value table (user_id + pref_key PK, jsonb value). RLS, auto-updated_at trigger. Used for nav tray order and future cross-device prefs |
| `006_log_tabs.sql` | `aft_vor_checks` (FAR 91.171), `aft_tire_checks`, `aft_oil_logs` tables with indexes and RLS. SELECT+INSERT policies for aircraft access users |
| `007_chuck.sql` | `aft_chuck_threads` (per-user per-aircraft, UNIQUE constraint) and `aft_chuck_messages` (with token tracking columns). RLS policies for user-owns-thread |
| `008_documents.sql` | `aft_documents` (per-aircraft metadata) and `aft_document_chunks` (text + vector(1536) embeddings). pgvector extension, IVFFlat index, `match_document_chunks` RPC function. RLS for aircraft access |

Migrations are run manually in the Supabase SQL Editor. Storage buckets are created via the Supabase Storage UI.
