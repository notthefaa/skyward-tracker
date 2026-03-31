# Skyward Aircraft Manager — Technical Codex

Complete technical reference for developers working on the Skyward Aircraft Manager codebase. This document covers the database schema, API surface, authentication model, realtime architecture, and key implementation details.

---

## Database Schema

### aft_aircraft
Aircraft master records. The `created_by` field references `auth.users(id)` with `ON DELETE CASCADE` — deleting a user deletes all aircraft they created.

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
| created_by | uuid FK → auth.users | ON DELETE CASCADE |
| created_at | timestamptz | |

### aft_flight_logs
One row per flight. Times are cumulative (new Hobbs, not delta).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK → aft_aircraft | ON DELETE CASCADE |
| user_id | uuid FK → auth.users | ON DELETE SET NULL |
| pod | text | Point of departure (ICAO) |
| poa | text | Point of arrival (ICAO) |
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
Line items in a work package.

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
Discrepancy reports with optional MEL/CDL deferral support.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| reported_by | uuid FK → auth.users | |
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
| created_at | timestamptz | |

### aft_notes
Pilot-to-pilot notes with photos and read receipts.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| aircraft_id | uuid FK | ON DELETE CASCADE |
| author_id | uuid FK → auth.users | |
| author_email | text | |
| author_initials | text | |
| content | text | |
| pictures | jsonb | Array of public URLs |
| edited_at | timestamptz | |
| created_at | timestamptz | |

### aft_note_reads
Read receipts for notes. Unique constraint on (note_id, user_id).

### aft_user_roles
Global role assignment. One row per user.

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid FK → auth.users | ON DELETE CASCADE |
| role | text | "admin" or "pilot" |
| email | text | |
| initials | text | |

### aft_user_aircraft_access
Per-aircraft access with role. Links users to aircraft they can see.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | ON DELETE CASCADE |
| aircraft_id | uuid FK → aft_aircraft | ON DELETE CASCADE |
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

**RLS policies:** Users can view/create reservations for aircraft they have access to. Users can update/delete their own reservations or any reservation if they are a tailnumber admin for that aircraft.

### aft_notification_preferences
Per-user notification toggles. All types default to enabled (rows are only created when a user explicitly disables a type).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | ON DELETE CASCADE |
| notification_type | text | See types below |
| enabled | boolean | |
| created_at | timestamptz | |

**Notification types:** `reservation_created`, `reservation_cancelled`, `squawk_reported`, `mx_reminder`, `service_update`, `note_posted`

**Visibility in Settings UI:** Types flagged `primaryContactOnly` in `NOTIFICATION_TYPES` (types.ts) are only shown in the settings modal to users whose email matches `main_contact_email` on at least one of their assigned aircraft. Regular pilots see only: reservations, squawks, and notes.

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

Client-side calls use `authFetch()` from `@/lib/authFetch.ts` which auto-attaches the session token.

### Route Reference

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/aircraft/create` | POST | Auth | Create aircraft, set creator as tailnumber admin |
| `/api/aircraft-access` | PUT | Auth | Change a user's aircraft role |
| `/api/aircraft-access` | DELETE | Auth | Remove user from aircraft (cancels future reservations) |
| `/api/account/delete` | GET | Auth | Preview deletion impact (owned aircraft, affected users) |
| `/api/account/delete` | DELETE | Auth | Delete own account (cascades to owned aircraft) |
| `/api/invite` | POST | Admin | Invite global admin or standalone pilot |
| `/api/pilot-invite` | POST | Auth | Invite user to specific aircraft with role |
| `/api/reservations` | POST | Auth | Create reservation (conflict detection + notifications) |
| `/api/reservations` | DELETE | Auth | Cancel reservation (permission check + notifications) |
| `/api/mx-events/create` | POST | Auth + Aircraft | Create service event / work package |
| `/api/mx-events/complete` | POST | Auth + Aircraft | Complete event, reset MX tracking |
| `/api/mx-events/respond` | POST | Token | Mechanic portal actions (7 action types) |
| `/api/mx-events/upload-attachment` | POST | Token | Mechanic file uploads (10MB limit, 5 files max) |
| `/api/mx-events/owner-action` | POST | Auth + Aircraft | Owner scheduling responses |
| `/api/mx-events/send-workpackage` | POST | Auth + Aircraft | Send/resend work package email |
| `/api/mx-events/manual-trigger` | POST | Auth | Manually trigger MX draft creation |
| `/api/emails/squawk-notify` | POST | Auth + Aircraft | Send squawk notification emails |
| `/api/emails/note-notify` | POST | Auth + Aircraft | Send note notification emails |
| `/api/emails/mx-schedule` | POST | Auth + Aircraft | Send MX scheduling email |
| `/api/cron/mx-reminders` | GET | CRON | Automated MX reminders + draft creation |
| `/api/admin/db-health` | POST | Admin | Cleanup old records, sweep orphaned files |
| `/api/resend-invite` | POST | None | Re-send Supabase auth invitation |

---

## Notification System

### Recipient Matrix

Notifications are divided into two categories: operational awareness (all assigned pilots) and maintenance coordination (primary contact only).

| Event | Recipients | Excludes |
|-------|-----------|----------|
| Squawk reported | All assigned pilots | Reporter |
| Note posted | All assigned pilots | Author |
| Reservation created | All assigned pilots | Creator |
| Reservation cancelled | All assigned pilots | Canceller |
| MX reminders (cron) | Primary contact only | — |
| Service updates (mechanic) | Primary contact only | — |
| Draft work package created | Primary contact only | — |
| Work package to mechanic | Mechanic + CC primary contact | — |

**Primary contact** is identified by matching `aircraft.main_contact_email` on the aircraft record. This is the person responsible for maintenance coordination.

### Settings UI Scoping

The `NOTIFICATION_TYPES` array in `types.ts` includes a `primaryContactOnly` flag. The SettingsModal checks whether the current user's email matches `main_contact_email` on any of their assigned aircraft. If not, the `mx_reminder` and `service_update` toggles are hidden — those users would never receive those emails anyway.

### Email Channels

All emails sent from `notifications@skywardsociety.com` via Resend. Sender display names are channel labels:

- **Skyward Aircraft Manager** — scheduling drafts, heads-up alerts
- **Skyward Operations** — mechanic portal actions, squawk notifications to mechanics
- **Skyward Alerts** — internal team notifications (MX reminders, squawks, notes)

All CTA buttons in emails read "OPEN AIRCRAFT MANAGER" and link to the app URL.

---

## Realtime Architecture

The app subscribes to a single Supabase Realtime channel (`fleet-updates`) listening to 8 tables: `aft_flight_logs`, `aft_squawks`, `aft_maintenance_items`, `aft_notes`, `aft_maintenance_events`, `aft_event_messages`, `aft_reservations`.

**Aircraft-scoped refresh:** When a realtime event fires, the handler extracts `aircraft_id` from the payload. If present, only that aircraft's master record is re-fetched and its metrics recalculated. SWR caches are invalidated only for keys containing that aircraft's ID. Events without an `aircraft_id` (like messages) trigger a lightweight SWR-only revalidation. Per-aircraft debounce timers (1.5s) prevent hammering the DB on rapid-fire changes.

**Self-filtering:** Events caused by the current user are skipped to avoid redundant refreshes (checks `user_id`, `reported_by`, `author_id`).

---

## Predictive Maintenance Engine

Located in `@/lib/math.ts`. The engine computes:

1. **Burn rate:** Active-days weighted average of engine time consumed per day over the last 180 days. Only counts days where flights occurred, avoiding dilution from idle periods.
2. **Variance:** Weekly rolling coefficient of variation to detect irregular usage patterns.
3. **Confidence score:** Four-factor composite (0-100%) based on data volume, recency, consistency, and variance. Used to gate automated actions.
4. **Projected days:** For time-based MX items, divides remaining hours by burn rate to estimate when service will be needed.

**Automation thresholds:**
- High confidence (≥80%) + within predictive window → auto-create draft work package
- Low confidence (<80%) + within predictive window → send heads-up email only (no draft)
- Hard threshold hit (time or date) → always create draft regardless of confidence

---

## Key Technical Constraints

- **tsconfig target: es5** — No `[...new Set()]`. Use `Array.from(new Set(...))` instead.
- **tsconfig strict: false** — Supabase client typed as `SupabaseClient<any, any, any>` for admin client.
- **Tailwind v4** — Uses `@theme` directive in `globals.css`. CSS layers give utility classes lower specificity than expected.
- **iOS Safari forms** — Requires `-webkit-appearance: none` before `background-color` takes effect on form inputs. Applied globally in `globals.css` with `!important`. Header tail dropdown excluded via `data-tail-select` attribute.
- **browser-image-compression** — All image uploads are compressed client-side before uploading to Supabase Storage.
- **Supabase select() typing** — Dynamic strings in `.select()` cause TypeScript parse errors. Always select all needed columns as a static string and cast results with `as any`.
- **Supabase auth SIGNED_IN event** — Fires on session refresh (e.g. tab switch), not just fresh logins. Do not reset UI state on this event.
- **Modal z-index** — Nav bars at `z-[9999]`, all modals at `z-[10000]` minimum.
- **Network egress** — Disabled in the sandbox/development environment.
- **Supabase Realtime connections** — Each open browser tab holds a websocket. Free tier: 200 concurrent, Pro: 500.

---

## Hook Architecture

Custom hooks extracted from `page.tsx` to improve maintainability:

| Hook | Location | Purpose |
|------|----------|---------|
| `useFleetData` | `src/hooks/useFleetData.ts` | Session-driven data fetching, role resolution, aircraft lists, SWR mutation |
| `useRealtimeSync` | `src/hooks/useRealtimeSync.ts` | Supabase Realtime subscription with aircraft-scoped refresh and self-filtering |
| `useGroundedStatus` | `src/hooks/useGroundedStatus.ts` | Computes aircraft airworthiness from MX items and squawks |
| `useAircraftRole` | `src/hooks/useAircraftRole.ts` | Resolves the current user's per-aircraft role from access records |

Barrel export from `src/hooks/index.ts`.

---

## MX Access Control

Maintenance scheduling and work package management is restricted to Tail Admins and Global Admins. This is enforced in two places:

**MaintenanceTab.tsx:** The `canEditMx` flag (`role === 'admin' || aircraftRole === 'admin'`) gates the "Schedule Service" button, "Track New MX Item" form, and the entire active events section. Regular pilots see the MX item list (read-only) and can report squawks but cannot access service event management.

**ServiceEventModal.tsx:** Accepts a `canManageService` prop (passed from MaintenanceTab as `canEditMx`). Gates: "Schedule New Service" button, draft review section, confirm/counter/comment mechanic actions, "Enter Logbook Data & Complete" button, and "Cancel Service Event" button. The work package details and message history remain visible for read-only context.

---

## Calendar Dashboard

Located in `src/components/tabs/CalendarDashboard.tsx`. Renders above the "Reserve Aircraft" button on the Calendar tab. Three floating SVG ring gauges with drop shadows:

1. **My Bookings** (green, `#56B94A`): Unique days the current user has reserved in the next 30 days.
2. **Available** (dynamic color): Days the aircraft is free in the next 30 days. Color thresholds: blue (`#3AB0FF`) if >15, orange (`#F08B46`) if ≤15, red (`#CE3732`) if ≤5. Accounts for both reservations and confirmed MX events.
3. **Flight Hours** (navy, `#091F3C`): Total hours flown in a selectable period (30/60/90/120 days or custom date range). Calculated by comparing the most recent flight log's AFTT/Hobbs/Tach within the period against the last log before the period started. Falls back to aircraft setup values if no prior log exists.

The period selector is nested directly under the Flight Hours gauge via a "Change ▾" toggle, keeping it visually associated with the correct gauge.

---

## Tab Persistence

The active tab is persisted to `sessionStorage` as `aft_active_tab`. On mount, the app reads the saved tab and restores it. This means switching browser tabs or backgrounding the app preserves your place, but closing the tab or browser entirely starts fresh at the fleet summary. The auth listener no longer resets the tab on `SIGNED_IN` (which fires on session refresh, not just fresh logins). Only `SIGNED_OUT` and explicit navigation actions reset the tab.

---

## DB Health & Retention Policy

The `/api/admin/db-health` route runs 9 cleanup stages:

1. Read receipts older than 30 days
2. Notes older than 6 months
3. Squawks — kept forever (no purge)
4. Completed MX events older than 12 months + cancelled events older than 3 months
5. Orphaned child records (messages, line items without parent events)
6. Orphaned access records (aircraft_id no longer exists)
7. Flight logs older than 5 years
8. Orphaned images across all 4 storage buckets (paginated sweep)
9. Row count monitoring for 13 tables

---

## Migrations

| File | Contents |
|------|----------|
| `001_mechanic_attachments.sql` | `attachments` jsonb column on `aft_event_messages`, partial index |
| `002_roles_calendar_notifications.sql` | `aircraft_role` column on access table, `aft_reservations` with exclusion constraint, `aft_notification_preferences`, CASCADE on `created_by` FK, `btree_gist` extension, realtime publication |

Migrations are run manually in the Supabase SQL Editor. Storage buckets are created via the Supabase Storage UI.
