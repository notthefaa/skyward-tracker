# Skyward Fleet Tracker — Technical Codex

Last updated: March 27, 2026

## System Overview

Two Next.js 16 apps sharing one Supabase database:
- **skyward-tracker** (main app): Fleet management dashboard
- **skyward-logit** (companion): Mobile-first PWA for quick flight/squawk logging

GitHub: `github.com/notthefaa/skyward-tracker` and `github.com/notthefaa/skyward-logit`

---

## Database Schema

### Tables (all prefixed `aft_`)

**aft_aircraft** — Aircraft registry
- `id` (uuid, PK), `tail_number` (text, UNIQUE), `aircraft_type`, `engine_type` (CHECK: Piston/Turbine)
- Times: `total_airframe_time`, `total_engine_time`, `setup_aftt`, `setup_ftt`, `setup_hobbs`, `setup_tach`
- Fuel: `current_fuel_gallons`, `fuel_last_updated`
- Contacts: `main_contact`, `main_contact_phone`, `main_contact_email`, `mx_contact`, `mx_contact_phone`, `mx_contact_email`
- Other: `serial_number`, `home_airport`, `avatar_url`, `created_by` (FK → auth.users)

**aft_flight_logs** — Flight entries
- `id` (uuid, PK), `aircraft_id` (FK → aft_aircraft, CASCADE), `user_id` (FK → auth.users, SET NULL)
- Times: `aftt`, `ftt`, `hobbs`, `tach`
- Flight: `pod`, `poa`, `engine_cycles`, `landings`, `fuel_gallons`
- Meta: `initials`, `pax_info`, `trip_reason` (CHECK: PE/BE/MX/T/null), `created_at`

**aft_maintenance_items** — Tracked MX items
- `id` (uuid, PK), `aircraft_id` (FK → aft_aircraft, CASCADE), `item_name`
- Tracking: `tracking_type` (CHECK: time/date), `due_date`, `due_time`
- Intervals: `time_interval`, `date_interval_days`
- Completion: `last_completed_time`, `last_completed_date`
- Flags: `is_required`, `automate_scheduling`
- Reminders: `reminder_30_sent`, `reminder_15_sent`, `reminder_5_sent`, `mx_schedule_sent`, `primary_heads_up_sent`

**aft_maintenance_events** — Service event lifecycle
- `id` (uuid, PK), `aircraft_id` (FK → aft_aircraft, CASCADE), `created_by` (FK → auth.users, SET NULL)
- Status: `status` (CHECK: draft/scheduling/confirmed/in_progress/ready_for_pickup/complete/cancelled)
- Scheduling: `proposed_date`, `proposed_by`, `confirmed_date`, `confirmed_at`
- Completion: `completed_at`, `estimated_completion`, `mechanic_notes`
- Security: `access_token` (256-bit hex, auto-generated)
- Contacts: `mx_contact_name`, `mx_contact_email`, `primary_contact_name`, `primary_contact_email`
- Add-ons: `addon_services` (jsonb array)

**aft_event_line_items** — Work package items
- `id` (uuid, PK), `event_id` (FK → aft_maintenance_events, CASCADE)
- Type: `item_type` (CHECK: maintenance/squawk/addon)
- References: `maintenance_item_id` (FK → aft_maintenance_items, SET NULL), `squawk_id` (FK → aft_squawks, SET NULL)
- Content: `item_name`, `item_description`, `line_status` (CHECK: pending/in_progress/complete/deferred)
- Mechanic: `mechanic_comment`
- Completion: `completion_date`, `completion_time`, `completed_by_name`, `completed_by_cert`, `work_description`

**aft_event_messages** — Owner ↔ mechanic messages
- `id` (uuid, PK), `event_id` (FK → aft_maintenance_events, CASCADE)
- `sender` (CHECK: owner/mechanic/system), `message_type` (CHECK: propose_date/confirm/counter/comment/status_update)
- `proposed_date`, `message`, `created_at`

**aft_squawks** — Discrepancy reports
- `id` (uuid, PK), `aircraft_id` (FK → aft_aircraft, CASCADE), `reported_by` (FK → auth.users, SET NULL)
- Content: `description`, `location`, `status` (CHECK: open/resolved), `affects_airworthiness`
- Media: `pictures` (text array), `reporter_initials`
- Deferrals: `is_deferred`, `mel_number`, `cdl_number`, `nef_number`, `mdl_number`, `mel_control_number`, `deferral_category` (CHECK: A/B/C/D/NA/null), `deferral_procedures_completed`
- Signature: `signature_data`, `signature_date`, `full_name`, `certificate_number`

**aft_notes** — Pilot notes per aircraft
- `id` (uuid, PK), `aircraft_id` (FK), `content`, `author_id` (FK), `author_email`, `author_initials`
- `pictures` (text array), `created_at`, `edited_at`

**aft_note_reads** — Read receipts for notes
- `note_id` + `user_id` (composite PK), `read_at`

**aft_user_roles** — User profiles
- `user_id` (uuid, PK, FK → auth.users, CASCADE), `role` (CHECK: admin/pilot), `initials`, `email`

**aft_user_aircraft_access** — Aircraft assignments
- `user_id` + `aircraft_id` (composite PK), both FK with CASCADE

**aft_system_settings** — Global configuration (single row, id=1)
- Reminder thresholds: `reminder_1`/`2`/`3` (days), `reminder_hours_1`/`2`/`3` (hours)
- Scheduling: `sched_time`, `sched_days`, `predictive_sched_days`

### Indexes
- `aft_aircraft`: tail_number (unique)
- `aft_flight_logs`: aircraft_id, created_at DESC
- `aft_maintenance_items`: aircraft_id
- `aft_maintenance_events`: aircraft_id, status, access_token
- `aft_event_line_items`: event_id
- `aft_event_messages`: event_id
- `aft_squawks`: aircraft_id, status
- `aft_notes`: aircraft_id
- `aft_note_reads`: user_id

### Storage Buckets
- `aft_squawk_images` — Squawk photos
- `aft_note_images` — Note attachments
- `aft_aircraft_avatars` — Aircraft profile images

---

## RLS Policies

All 12 tables have RLS enabled. Key patterns:

**Admin full access**: `aft_aircraft`, `aft_maintenance_items`, `aft_flight_logs` (delete/update), `aft_notes` (delete), `aft_squawks` (delete), `aft_user_aircraft_access`, `aft_maintenance_events`, `aft_event_line_items`, `aft_event_messages`, `aft_user_roles`, `aft_system_settings`

**Authenticated read**: `aft_aircraft` (with access check), `aft_flight_logs`, `aft_maintenance_items`, `aft_squawks`, `aft_notes`, `aft_note_reads`, `aft_user_roles`, `aft_user_aircraft_access`, `aft_system_settings`

**Anonymous read** (for mechanic portal + squawk viewer): `aft_aircraft`, `aft_squawks`, `aft_maintenance_events`, `aft_event_line_items`, `aft_event_messages`

**Insert restrictions**: Flight logs require `user_id = auth.uid()`, notes require `author_id = auth.uid()`, squawks require `reported_by = auth.uid()`, note reads require `user_id = auth.uid()`

**Pilot access to MX events**: via join through `aft_user_aircraft_access` (SELECT on events, line items, messages; INSERT on messages)

---

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/aircraft/create` | POST | Auth | Create aircraft |
| `/api/invite` | POST | Admin | Invite user |
| `/api/resend-invite` | POST | None* | Resend invite email |
| `/api/users` | POST | Admin | User management |
| `/api/admin/db-health` | POST | Admin | Database cleanup + monitoring |
| `/api/cron/mx-reminders` | GET | CRON_SECRET | Automated MX alerts |
| `/api/emails/mx-schedule` | POST | Auth | Manual MX scheduling email |
| `/api/emails/squawk-notify` | POST | Auth | Squawk notification emails |
| `/api/mx-events/create` | POST | Auth | Create maintenance event |
| `/api/mx-events/send-workpackage` | POST | Auth | Send/resend work package |
| `/api/mx-events/owner-action` | POST | Auth | Owner confirm/counter/cancel/comment |
| `/api/mx-events/respond` | POST | Token** | Mechanic actions via portal |
| `/api/mx-events/complete` | POST | Auth | Complete event + reset tracking |

*\* `resend-invite` uses admin client internally but accepts unauthenticated requests (invite tokens are single-use)*
*\*\* `respond` authenticates via the event's `access_token` (256-bit hex), not user session*

---

## Email System

15 emails across 6 routes. Every email includes an actionable link.

**Mechanic receives** (links to portal):
- Work package (initial + resend)
- Date confirmed by owner
- Counter proposal from owner
- Message from owner
- Cancellation notice

**Owner receives** (links to app):
- Date proposal from mechanic
- Date confirmed by mechanic
- Service update / comment from mechanic
- Estimated completion date
- Additional work suggested by mechanic
- Work package progress (line item status changes)
- Aircraft ready for pickup
- Service declined by mechanic
- Draft work package ready for review (CRON)
- Predictive MX heads-up (CRON)
- MX reminder alerts (CRON)
- New squawk notification

**All mechanic emails**: CC primary contact, replyTo primary contact
**Email provider**: Resend, from `notifications@skywardsociety.com`

---

## Predictive Maintenance Engine

Located in `src/lib/math.ts`. Uses 180 days of flight logs to predict when MX items will come due.

**Burn Rate Calculation:**
- Active days burn rate = total hours / number of days with flights
- Only considers days with actual flight activity

**4-Factor Confidence Score:**
1. Data volume — more flights = higher confidence (0-25 points)
2. Recency — flights in last 30 days boost confidence (0-25 points)
3. Weekly variance — consistent flying patterns = higher confidence (0-25 points)
4. Time span coverage — data spread across the 180-day window (0-25 points)

**Projection Logic:**
- If confidence ≥ 80%: Create draft work package when within `predictive_sched_days` threshold
- If confidence < 80%: Send heads-up notification only (no draft)
- Fixed reminders at `sched_days`/`sched_time` thresholds regardless of confidence

---

## Maintenance Event Status Flow

```
                                    ┌─────────────┐
                                    │    DRAFT     │ ← CRON auto-creates
                                    └──────┬──────┘
                                           │ Owner sends work package
                                    ┌──────▼──────┐
                               ┌───→│ SCHEDULING  │←──┐
                               │    └──────┬──────┘   │
                               │           │          │
                          Counter    Confirm Date  Counter
                               │           │          │
                               │    ┌──────▼──────┐   │
                               └────│  CONFIRMED  │───┘
                                    └──────┬──────┘
                                           │ Mechanic starts work
                                    ┌──────▼──────┐
                                    │ IN PROGRESS  │
                                    └──────┬──────┘
                                           │ All items complete
                                    ┌──────▼──────┐
                                    │READY PICKUP  │ ← Mechanic signals
                                    └──────┬──────┘
                                           │ Owner enters logbook data
                                    ┌──────▼──────┐
                                    │   COMPLETE   │
                                    └─────────────┘

         ┌─────────────┐
         │  CANCELLED   │ ← Owner cancel OR Mechanic decline
         └─────────────┘   (from any active status)
```

---

## iOS PWA Configuration

**layout.tsx viewport settings:**
```typescript
viewportFit: "cover",        // Enables safe area control
themeColor: "#091F3C",       // Navy status bar
statusBarStyle: "black-translucent"
```

**Layout architecture (page.tsx):**
- Header: `fixed top-0 z-[9999]` with `paddingTop: env(safe-area-inset-top)`
- Main: `fixed` with calc'd `top`/`bottom` for safe areas, `overflow-y-auto`
- Nav: `fixed bottom-0 z-[9999]` with `pb-[env(safe-area-inset-bottom)]`
- All modals: `z-[10000]+` with safe-area-aware padding

**globals.css:**
- Body: `background-color: #ffffff` (matches nav, eliminates safe area gap)
- No `overflow: hidden` or `touch-action: none` on body
- `-webkit-overflow-scrolling: touch` on main for smooth iOS scroll

---

## Companion App (skyward-logit)

Minimal mobile-first PWA for quick data entry. Shares the same Supabase database.

**Files:**
- `src/app/page.tsx` — Single-page wizard for flight logs and squawks
- `src/app/api/emails/squawk-notify/route.ts` — Squawk notification (mirrors main app)
- `src/lib/auth.ts`, `authFetch.ts`, `env.ts`, `supabase.ts`, `types.ts` — Shared utilities

**Features:**
- Flight log entry with step-by-step wizard
- Squawk reporting with photo capture and compression
- Same auth system as main app
- Parallel data fetching
- Install prompts for iOS and Android

**Required env var:** `NEXT_PUBLIC_MAIN_APP_URL` — points squawk viewer links and app buttons in emails to the main app.

---

## Technical Constraints

- `target: "es5"` in tsconfig — no `[...new Set()]`, use `Array.from()`
- `strict: false` in tsconfig
- `SupabaseClient<any, any, any>` for admin client type
- Tailwind v4 with `@theme` directive for custom colors
- `browser-image-compression` for client-side image optimization

---

## Database Health & Retention

| Data Type | Retention |
|-----------|-----------|
| Squawks | Permanent (never purged) |
| Flight logs | 5 years |
| MX completed events | 12 months |
| MX cancelled events | 3 months |
| Notes | 6 months |
| Read receipts | 30 days |
| Orphaned images | Cleaned on each run |
| Orphaned child records | Cleaned on each run |

---

## Roadmap

**Planned:**
1. Offline support with conflict resolution
2. Mechanic portal document/image uploads with description text
3. Cost tracking (fuel expenses, shared expenses for leaseback/multi-owner)
4. Dashboard analytics (fleet-wide MX timeline, hours/fuel trends, squawk frequency)
5. Maintenance history search (searchable/exportable completed event history)
6. Push notifications for critical events
7. PDF export (MX logbook summaries, work orders, squawk reports)
