# Skyward Aircraft Manager

A fleet management platform built for pilot-owners by **Skyward Society**. Flight logging, maintenance tracking, mechanic coordination, squawk reporting, airworthiness directives, equipment tracking, shared scheduling, pilot collaboration, and an aviation-aware AI copilot — all in one progressive web app.

**Live:** [track.skywardsociety.com](https://track.skywardsociety.com)
**Companion App:** Log It (lightweight PWA for ramp use)

---

## Stack

- **Framework:** Next.js 16 (App Router, React 19, TypeScript, Turbopack)
- **Styling:** Tailwind CSS v4 with `@theme` custom properties
- **Backend:** Supabase (PostgreSQL + pgvector, Auth, Storage, Realtime, RLS)
- **AI:** Anthropic Claude Haiku 4.5 (Howard copilot) with tool use, OpenAI embeddings (document RAG), Tavily (web search)
- **Email:** Resend (transactional email from `notifications@skywardsociety.com`)
- **Observability:** Sentry (opt-in via DSN), per-request correlation IDs, structured telemetry breadcrumbs
- **Hosting:** Vercel (Serverless Functions + Cron)
- **Testing:** Vitest; CI runs `tsc --noEmit` + test suite on every PR
- **Repos:** `github.com/notthefaa/skyward-tracker` (main) + `github.com/notthefaa/skyward-logit` (companion)

---

## Features

### Flight Logging
Log flights with automatic engine-type detection. Hobbs & Tach for piston, AFTT & FTT for turbine. Built-in backward-entry validation, fuel state tracking (gallons/lbs with auto-conversion), routing (POD/POA), passenger info, trip reason codes, and full CSV export. Paginated flight log table with computed FLT column. Last flown indicator on the Home screen shows who flew and how long ago.

**Atomic writes.** Log create/edit/delete all go through Postgres RPCs (`log_flight_atomic`, `edit_flight_log_atomic`, `delete_flight_log_atomic`) that lock the aircraft row, enforce monotonicity + a 24-hour sanity bound on creates, and apply log+aircraft-totals updates in one transaction so concurrent writers can't clobber hours.

### Maintenance Tracking
Track items by engine hours, calendar dates, or **both** simultaneously (dual-interval — whichever comes first grounds the aircraft). Each completion auto-recalculates the next due. The predictive engine analyzes 180 days of flight data to project when service will be needed, using an active-days weighted burn rate with weekly rolling variance and a four-factor confidence score. Configurable email alerts at three thresholds. Automated scheduling creates aggregate draft work packages that bundle all items approaching their thresholds within a 30-day lookahead window — so the mechanic gets one comprehensive request, not separate emails for each item. Completed maintenance history is exportable as PDF with mechanic names, certificate numbers, and work descriptions. Only Aircraft Admins and Global Admins can schedule maintenance and manage work packages; regular pilots see the MX item list in read-only mode.

### Airworthiness Directives (ADs)
First-class AD tracking with 14 CFR 91.417(b) compliance exports. Each AD records applicability, compliance type (one-time or recurring), last compliance date/hours, next due date/hours, and whether it affects airworthiness. Manual entry via the ADs tab, plus a nightly FAA DRS sync cron that pulls ADs matching each aircraft's make/model/engine. On-demand refresh button for targeted lookups. Howard's `check_airworthiness` tool rolls ADs into its verdict alongside 91.205, 91.411, 91.413, 91.207, and 91.171 checks.

### Equipment Tracking
`aft_aircraft_equipment` captures every installed component (avionics, transponder, altimeter, pitot-static, ELT, etc.) with capability flags (IFR capable, ADS-B Out, ELT) and due dates for 24-month checks. Drives the airworthiness verdict directly — a transponder past its 91.413 date grounds the aircraft automatically. Supports "mark removed" for items taken out of service (kept in history) separately from "delete" (hard remove for mistaken entries).

### Howard (AI Copilot)
Howard is an aviation-literate assistant built on Claude Haiku 4.5. Scoped per-user across the whole fleet. Answers questions about maintenance, airworthiness, squawks, reservations, flight logs, equipment, ADs, documents, and flight briefings. Pulls live data via 24 tools:

- **Read-only:** flight logs, MX items, service events, squawks, notes, reservations, VOR/tire/oil checks, equipment, ADs, documents (semantic search), system settings.
- **External:** weather briefings (NOAA AWC — METARs + TAFs), aviation hazards (PIREPs + SIGMETs), NOTAMs (official FAA NOTAM API), web search (Tavily).
- **Airworthiness:** `check_airworthiness` returns a structured verdict with reg citations; `refresh_ads_drs` triggers an on-demand AD sync.
- **Write (propose-confirm):** `propose_reservation`, `propose_mx_schedule`, `propose_squawk_resolve`, `propose_note`, `propose_equipment_entry`. Each renders a confirmation card inline in chat — nothing is written until the pilot taps Confirm.

**Tailored tone.** Pilot ratings and the aircraft's IFR capability feed Howard's system prompt — student pilots get teaching, CFIs get shop talk, VFR-only aircraft never hear "file IFR." Floating launcher with follow-up chips and an aircraft picker for multi-tail questions. Rate-limited to 20 requests/minute per user via a Supabase-backed atomic RPC so Vercel cold starts can't multiply the quota.

### Documents (RAG)
Upload aircraft PDFs (POH, AFM, logbooks). Server extracts text, chunks it, generates OpenAI embeddings, and stores them with pgvector. Howard's `search_documents` tool does semantic retrieval scoped to the current aircraft. SHA-256 dedup prevents duplicate uploads.

### Mechanic Coordination
Bundle MX items, squawks, and add-on services into a single work package. Preview the email before sending. Full lifecycle management: Draft → Scheduling → Confirmed → In Progress → Ready for Pickup → Complete. Both owner and mechanic are notified at each stage. Mechanics can upload photos and documents (up to 5 files, 10MB each) through the service portal. Work package management (creating, sending, confirming/countering dates, messaging mechanic, entering logbook data, cancelling) is restricted to Aircraft Admins and Global Admins.

### Partial Completion + 43.11 Signoff
Service events support completing line items individually. Enter logbook data for some items while leaving others open — completed items reset their MX tracking immediately, and the event stays open for the remaining work. The completion form captures the full 14 CFR 43.11 set (certificate type, certificate number, expiry, tach/hobbs at completion, logbook ref) and locks line items once marked complete. Squawk line items auto-resolve on completion and record which service event resolved them.

### MX Calendar Conflict Resolution
When a maintenance event date is confirmed (by either party), the system automatically cancels any overlapping reservations on that aircraft and emails each affected pilot with the maintenance dates and their cancelled booking details.

### Mechanic Portal
Secure token-based access — no login required. Mechanics can propose dates, confirm appointments, update line-item work status, suggest additional items found during service, set estimated completion, upload attachments, and mark the aircraft ready for pickup. All communication is logged and visible to both sides. Portal access expires 7 days after event completion. File uploads are MIME-validated by magic bytes (not just the client-provided type).

### Squawk Reporting
Report discrepancies with photos from the ramp. Flag anything affecting airworthiness to ground the aircraft fleet-wide. Include squawks in service events — they auto-resolve when the mechanic completes the work, with a cross-reference showing which service event resolved each squawk. Full MEL/CDL/NEF/MDL deferral support with digital signatures. Squawks live under the MX tab with a selector. Exportable as PDF with cross-reference data included.

### Oil / Tire / VOR Logs
Standalone log surfaces for oil changes (qty + "added" top-offs, engine hours), tire pressure checks (nose + left/right main PSI), and VOR accuracy checks (FAR 91.171 dual-check type with station + bearing error). Each has its own tab with paginated history and a due-status indicator (e.g. VOR check >30 days).

### Shared Calendar
Month, week, and day views for aircraft scheduling. Create reservations with start/end times, purpose, and optional route of flight. Hard-block on overlapping bookings — no double-booking allowed (enforced via a Postgres exclusion constraint on `tstzrange`). Confirmed maintenance events automatically block calendar dates. Admins can book reservations on behalf of other assigned pilots. All assigned users are notified when reservations are created or cancelled (respects notification preferences). Recurring reservations supported (weekly / custom series up to 100 occurrences).

### Calendar Dashboard
Three floating SVG ring gauges displayed above the Reserve Aircraft button: **My Bookings** shows how many days the current user has reserved in the next 30 days. **Available** shows how many of the next 30 days are free (blue if >15, orange if ≤15, red if ≤5 — accounts for both reservations and confirmed MX events). **Flight Hours** shows total hours flown over a selectable period (30, 60, 90, 120 days, or a custom date range), with the period selector nested under the gauge.

### Pilot Invitations & Aircraft-Level Roles
Two-tier role system: global roles (admin/pilot) and per-aircraft roles (Admin/Pilot). Admins can edit the aircraft, invite pilots, manage reservations, schedule maintenance, manage work packages, and change user roles for their aircraft. Pilots can view, log flights, report squawks, post notes, and manage their own reservations. Invitations happen through the aircraft summary page.

### Crew Management
The Home screen includes a collapsible Assigned Users list showing all pilots on the aircraft with their initials, email, and role. Admins can change roles and remove users inline. Global admins display as "Admin" regardless of their per-aircraft role record. An invite button at the bottom of the list opens the pilot invitation flow.

### Quick Fuel Update
Update the aircraft's fuel state without logging a flight — accessible from the "Update" button on the fuel card on the Home screen. Supports gallons and lbs with automatic conversion. Useful for top-offs, fuel truck visits, or ground runs.

### Notification System
Notifications split into two categories: operational awareness goes to all assigned pilots; maintenance coordination goes to the primary contact only.

**All assigned pilots receive:** squawk reports (excluding reporter), note posts (excluding author), reservation created (excluding creator), reservation cancelled (excluding canceller).

**Primary contact only receives:** MX reminders, service event updates, draft work package notifications, scheduling emails.

**Mechanic receives:** work packages (CC primary contact), squawk details (only if "Notify MX?" checked, CC primary contact). If the squawk notification email fails to send, the pilot gets a warning toast telling them to contact maintenance directly — the failure isn't silently swallowed.

Users manage their preferences through the Settings screen. The settings UI is role-scoped: MX reminder and service update toggles are only shown to users who are the primary contact on at least one aircraft.

### Account Management + Profile
Settings screen includes profile (full name, initials), FAA ratings (feeds Howard's tone), notification preferences, password reset via email, account info display, and account self-deletion with cascade impact preview. Deleting an account permanently removes all aircraft the user created (with their flight logs, MX items, squawks, notes, reservations, and service events). A confirmation dialog names the affected tail numbers and user count.

### Soft-Delete Audit Trail
Destructive actions across 11 tracked tables (aircraft, flight logs, MX items, events, squawks, notes, docs, etc.) are soft-deletes — the row is stamped with `deleted_at` + `deleted_by` and filtered out of reads, but retained for FAA §91.417 record-keeping. A generic `log_record_history` trigger captures every INSERT/UPDATE/DELETE on those tables into `aft_record_history` with the attributing user, the old row, and the new row. User attribution prefers per-row columns (`created_by`, `deleted_by`) with a transaction-scoped `app.current_user_id` fallback set by `set_app_user()`.

### Pull to Refresh
Pull down from the top of any tab to refresh all data — a pill-shaped indicator slides down from the header showing "Pull to refresh" → "Release to refresh" → "Refreshing..." → "Updated". Built specifically for iOS PWA standalone mode with native touch event handling to prevent the browser's built-in overscroll behavior.

### Secondary Nav Trays
Log, MX, and More nav items each open a sliding secondary toolbar with per-destination icons (e.g., Log tray: Times, Oil, Tire, VOR). Order is drag-reorderable via long-press and persists per-user across devices via Supabase.

### Session Recovery
Handles expired Supabase sessions gracefully. When the PWA returns from the background with an invalid refresh token, it detects the failure and redirects to the login screen instead of leaving the user in a broken state. Session validity is re-checked on every visibility change (app foregrounding).

### Tab Persistence
The active tab is preserved when switching browser tabs or backgrounding the app, so you always return to where you left off. Closing the browser or app entirely starts fresh at the fleet summary.

### Companion App (Log It)
Lightweight PWA for ramp use. Log flights, VOR checks, oil, tire pressure, and squawks from the phone's home screen. Works without signal — entries queue locally with their real timestamps and flush to the main app when connection comes back. The server stamps events by `occurred_at` (when it actually happened), not when the upload lands, so compliance math and chronology stay honest even after a long offline stretch. Retry-safe via per-submission idempotency keys — a network flap never creates duplicate rows. Includes an optional pilot notes step in the flight log flow — leave a note for the next pilot with optional photo attachments. Same secure login, no app store required.

### Observability
- **Sentry** wired per-runtime (server / edge / client). No-ops when `SENTRY_DSN` is unset.
- **Request correlation IDs.** Every API error response carries a `requestId` (body + `x-request-id` header); `logError()` and `logEvent()` tag Sentry breadcrumbs with it.
- **Structured events.** Howard rate-limit hits, tool truncations, NOTAM parse failures, etc. are emitted as greppable `[event]` lines and Sentry breadcrumbs for post-hoc analysis.
- **CI gate.** `.github/workflows/ci.yml` runs `tsc --noEmit` + full vitest suite on every PR and push to `main`.

### Additional Features
- **Real-time sync:** Supabase Realtime with aircraft-scoped refresh — only the affected aircraft's data is refetched, not the entire fleet. Channel namespaced per user to prevent cross-tenant collisions.
- **Fuel tracking:** Gallons and pounds with automatic conversion for W&B, plus standalone fuel updates without flight logging.
- **PWA install:** Add to home screen like a native app. iOS safe-area-aware modals so the close button never falls behind the notch.
- **CSV export:** Download complete flight log history.
- **MX history export:** Download complete maintenance history as PDF with mechanic sign-off data.
- **91.417(b) AD export:** CSV of every tracked AD and its compliance state.
- **Predictive alerts:** Email notifications when MX is approaching based on flying patterns.
- **Aggregate work packages:** System bundles all MX items due within 30 days into a single draft.
- **Success toasts:** Auto-dismissing confirmations for all key actions. Form submit errors surface via toast; no frozen buttons.
- **Grounded banner:** Shows the specific reason with regulatory citation (expired MX item + days/hours, AOG squawk location, or AD / equipment / ELT / transponder violation).
- **Squawk cross-references:** Resolved squawks show which service event resolved them.
- **10MB file validation:** Client-side and server-side enforcement across all upload points. Mechanic uploads are also magic-byte validated.
- **Image-upload rollback:** If a squawk/note insert fails after images uploaded to storage, the images are deleted — no orphaned blobs.
- **DB health tool:** Automated cleanup of old records, orphaned files, and storage bucket sweeps.
- **iOS Safari compatibility:** Global form input fix for `-webkit-appearance` background override. Safe-area insets on all modals.

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout, metadata, fonts
│   ├── manifest.ts             # PWA manifest
│   ├── globals.css             # Tailwind v4 theme + iOS Safari fixes + modal safe-area inset rule
│   ├── page.tsx                # Main app shell (auth, routing, nav, pull-to-refresh, session recovery)
│   ├── update-password/        # Password reset page
│   ├── squawk/[id]/            # Public squawk viewer (shareable link)
│   ├── service/[id]/           # Mechanic portal (token-based access)
│   └── api/
│       ├── account/delete/     # Account self-deletion with cascade
│       ├── admin/              # db-health + users listing
│       ├── ads/                # AD CRUD + 91.417(b) CSV export
│       ├── aircraft/           # create, delete
│       ├── aircraft-access/    # Change roles, remove users from aircraft
│       ├── cron/
│       │   ├── mx-reminders/   # Scheduled MX alerts + aggregate work package creation
│       │   └── ads-sync/       # Nightly FAA DRS pull
│       ├── documents/          # PDF upload + chunking + embeddings + soft-delete
│       ├── emails/             # mx-schedule, note-notify, squawk-notify
│       ├── equipment/          # Equipment CRUD with mark-removed vs delete
│       ├── flight-logs/        # Atomic CRUD via RPCs
│       ├── howard/             # Howard chat, threads, actions/[id] (confirm/cancel/retry), usage
│       ├── invite/             # Global admin invite
│       ├── maintenance-items/  # MX item CRUD (aircraft admin only)
│       ├── mx-events/          # block, complete, create, owner-action, respond,
│       │                       # send-workpackage, upload-attachment, cancel-workpackage
│       ├── notes/              # Note CRUD with access control
│       ├── oil-logs/           # Oil log CRUD
│       ├── pilot-invite/       # Tailnumber admin invite
│       ├── reservations/       # Calendar CRUD (supports recurring + book-for-other)
│       ├── squawks/            # Squawk CRUD with cross-aircraft-verified access
│       ├── tire-checks/        # Tire-pressure log CRUD
│       ├── users/              # User management (admin delete)
│       ├── version/            # App version endpoint
│       └── vor-checks/         # VOR-check log CRUD
├── components/
│   ├── AppButtons.tsx          # Shared button components
│   ├── AuthScreen.tsx          # Login + forgot password
│   ├── ConfirmProvider.tsx     # Context-based confirmation dialog (replaces native confirms)
│   ├── PilotOnboarding.tsx     # First aircraft setup
│   ├── Providers.tsx           # SWR + Toast + Confirm context providers; localStorage SWR cache
│   ├── PullIndicator.tsx       # Pull-to-refresh visual indicator
│   ├── Skeletons.tsx           # Pulsing placeholder bars for loading states
│   ├── Toast.tsx               # Auto-dismissing success notifications
│   ├── ToastProvider.tsx       # Context-based toast notification system
│   ├── howard/
│   │   ├── HowardLauncher.tsx  # Floating launcher + chat popup with suggestion chips
│   │   └── ProposedActionCard.tsx # Inline Confirm/Cancel card for Howard write proposals
│   ├── modals/
│   │   ├── AircraftModal.tsx   # Create/edit aircraft form (syncs setup times with totals)
│   │   ├── AdminModals.tsx     # Admin center (settings, users, fleet)
│   │   ├── MxGuideModal.tsx    # Maintenance system guide
│   │   ├── MxTemplatePickerModal.tsx # MX template library picker for common aircraft types
│   │   ├── ServiceEventModal.tsx # Full service event lifecycle (partial completion, cross-refs)
│   │   ├── SettingsModal.tsx   # Profile, FAA ratings, notifications, password, account deletion
│   │   ├── TutorialModal.tsx   # First-run tutorial
│   │   └── service-event/      # Decomposed service event sub-components
│   │       ├── DateProposalSection.tsx
│   │       ├── EmailPreview.tsx
│   │       ├── ServiceEventComplete.tsx
│   │       ├── ServiceEventCreate.tsx
│   │       ├── ServiceEventDetail.tsx
│   │       ├── ServiceEventList.tsx
│   │       └── shared.ts
│   ├── shell/
│   │   ├── AppShell.tsx        # Top-level shell: header, bottom nav, routing between tabs
│   │   ├── AuthGate.tsx        # Session gating
│   │   ├── NavTray.tsx         # Secondary nav tray (sliding toolbar for Log/MX/More)
│   │   └── TrayIcons.tsx       # Custom icon set for the trays
│   └── tabs/
│       ├── ADsTab.tsx          # AD tracking with Overdue/DueSoon/Compliant groups + CSV export
│       ├── CalendarDashboard.tsx # SVG ring gauges (bookings, availability, flight hours)
│       ├── CalendarTab.tsx     # Shared scheduling calendar with recurring + MX blocks
│       ├── DocumentsTab.tsx    # Aircraft document library (PDF upload, semantic search)
│       ├── EquipmentTab.tsx    # Installed equipment with 24-month check tracking
│       ├── FleetSchedule.tsx   # Fleet-wide schedule calendar with per-aircraft filtering
│       ├── FleetSummary.tsx    # Fleet grid overview
│       ├── HowardTab.tsx       # Howard conversation surface (used in launcher + tab)
│       ├── HowardUsageTab.tsx  # Admin view of Howard per-user token usage
│       ├── LogRouter.tsx       # Router for the Log secondary tray (Times/Oil/Tire/VOR)
│       ├── MaintenanceTab.tsx  # Combined MX + Squawks with selector + MX history export
│       ├── NotesTab.tsx        # Pilot notes with photos + email notifications
│       ├── OilTab.tsx          # Oil-change + top-off log
│       ├── SquawksTab.tsx      # Squawk reporting + management + cross-references
│       ├── SummaryTab.tsx      # Aircraft home (hero, times, fuel, contacts, crew, next reservation)
│       ├── TimesTab.tsx        # Flight log table + entry form
│       ├── TireTab.tsx         # Tire-pressure log
│       └── VorTab.tsx          # VOR-check log (91.171)
├── hooks/
│   ├── index.ts                # Barrel export
│   ├── useFleetData.ts         # Session-driven data fetching and role resolution
│   ├── useRealtimeSync.ts      # Supabase Realtime with aircraft-scoped refresh
│   ├── useGroundedStatus.ts    # Aircraft airworthiness computation
│   ├── useAircraftRole.ts      # Per-aircraft role resolution
│   ├── useModalScrollLock.ts   # Lock body scroll while a modal is open
│   ├── usePullToRefresh.ts     # iOS PWA pull-to-refresh gesture handler
│   └── useBodyScrollOverride.ts # Body overflow override for portal/viewer pages
└── lib/
    ├── airworthiness.ts        # computeAirworthinessStatus — explicit 91.* + AD verdict
    ├── apiResponse.ts          # apiOk / apiError response helpers
    ├── audit.ts                # setAppUser, softDelete, soft-delete table registry
    ├── auth.ts                 # Server-side auth (requireAuth, requireAircraftAccess, requireAircraftAdmin)
    ├── authFetch.ts            # Client-side authenticated fetch wrapper
    ├── constants.ts            # Shared constants (file size limits)
    ├── dateFormat.ts           # Timezone-aware date formatting for email notifications
    ├── drs.ts                  # FAA DRS feed fetcher + AD parser for the nightly cron
    ├── env.ts                  # Environment variable validation
    ├── howard/
    │   ├── claude.ts           # Anthropic client, streaming loop, cache-controlled prelude
    │   ├── proposedActions.ts  # Propose-confirm framework: summarize, insert, execute
    │   ├── rateLimit.ts        # 20/minute per-user via howard_rate_limit_check RPC
    │   ├── systemPrompt.ts     # Stable prelude + per-request user context builder
    │   ├── toolHandlers.ts     # 24-tool registry, aircraft-access re-check, result size cap
    │   ├── tools.ts            # Tool schema definitions for Claude
    │   └── types.ts            # HowardMessage + related types
    ├── math.ts                 # Predictive engine, burn rate, MX processing
    ├── mxConflicts.ts          # MX calendar conflict resolution (cancel overlapping reservations)
    ├── mxTemplates.ts          # Static maintenance templates for common aircraft types
    ├── pgErrors.ts             # Postgres error code → user-friendly message mapper
    ├── requestId.ts            # Request correlation ID + logError/logEvent (Sentry-wired)
    ├── sanitize.ts             # HTML sanitization for email templates
    ├── styles.ts               # Shared style constants (iOS Safari form input fixes)
    ├── supabase.ts             # Supabase client singleton
    ├── swrCache.ts             # SWR persistent cache provider (localStorage-backed)
    ├── swrKeys.ts              # Centralized SWR key factory + matchesAircraft matcher
    └── types.ts                # All TypeScript interfaces, types, and notification config
```

---

## Navigation

**Bottom nav (5 primary slots):** Home → Log → Calendar → MX → More

- **Home:** Aircraft summary with hero image, times, fuel (with quick update), contacts, next upcoming reservations, next MX due, active squawks, latest note, and collapsible assigned users list with role management.
- **Log:** Opens a secondary tray — Times (flight logs), Oil, Tire, VOR. Drag-reorderable, persists per user.
- **Calendar:** Dashboard gauges above the Reserve Aircraft button, followed by month/week/day views with reservation booking and MX event blocks.
- **MX:** Section selector — Maintenance, Squawks, Service, ADs. Active service events, scheduling, and work package management visible to Admins only.
- **More:** Section selector — Notes, Docs, Equipment, Howard.

**Header:** Tail number selector (with "+ Add Aircraft" at bottom), status dot, Fleet button (only if 2+ aircraft), Log It, Admin (global admins only), Settings, Logout.

**Howard launcher:** Floating icon bottom-right. Opens a popup with suggested prompts (fleet-aware), an aircraft picker when Howard needs tail confirmation, and follow-up chips after the assistant replies.

The active tab persists across browser tab switches and app backgrounding via sessionStorage. Pull-to-refresh is available on all tabs.

---

## Environment Variables

See `.env.example` for the full set. Required:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
CRON_SECRET=
ANTHROPIC_API_KEY=            # Howard (Claude Haiku 4.5)
OPENAI_API_KEY=               # Document embeddings
TAVILY_API_KEY=               # Howard web_search fallback
```

Optional:

```env
FAA_NOTAM_CLIENT_ID=          # Required for Howard's get_notams tool — register at api.faa.gov
FAA_NOTAM_CLIENT_SECRET=
FAA_DRS_FEED_URL=             # Override for the FAA AD feed if the default 404s
SENTRY_DSN=                   # Server-side error + event forwarding (no-ops if absent)
NEXT_PUBLIC_SENTRY_DSN=       # Client-side Sentry
NEXT_PUBLIC_APP_VERSION=
NEXT_PUBLIC_COMPANION_URL=
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `aft_aircraft` | Aircraft master records (incl. `is_ifr_equipped`, `is_for_hire`, make/model) |
| `aft_flight_logs` | Flight log entries (written via `log_flight_atomic`) |
| `aft_maintenance_items` | MX tracking items (time / date / both) |
| `aft_maintenance_events` | Service event lifecycle |
| `aft_event_line_items` | Work package line items with 43.11 signoff + lock-on-complete |
| `aft_event_messages` | Service event communication thread |
| `aft_squawks` | Discrepancy reports (with `resolved_by_event_id` cross-reference) |
| `aft_notes` | Pilot notes |
| `aft_note_reads` | Note read receipts |
| `aft_documents` | Aircraft PDFs (SHA-256 dedup, soft-delete) |
| `aft_document_chunks` | Text chunks with pgvector embeddings for RAG |
| `aft_airworthiness_directives` | AD tracking (partial unique index on live rows; soft-delete safe) |
| `aft_aircraft_equipment` | Installed equipment with capability flags and 24-month check dates |
| `aft_vor_checks` | 91.171 VOR accuracy log |
| `aft_tire_checks` | Tire-pressure log |
| `aft_oil_logs` | Oil change + top-off log |
| `aft_proposed_actions` | Howard's propose-confirm pending writes |
| `aft_howard_user_threads` | Per-user Howard threads (supersedes the old per-aircraft Chuck table) |
| `aft_howard_messages` | Howard conversation history with token usage |
| `aft_howard_rate_limit` | Per-user rolling request timestamps for the rate-limit RPC |
| `aft_record_history` | Generic audit trail — INSERT/UPDATE/DELETE of every tracked table |
| `aft_user_roles` | Global user roles (admin/pilot) |
| `aft_user_aircraft_access` | Per-aircraft access with `aircraft_role` |
| `aft_user_profiles` | Display names + email for admin/portal lookups |
| `aft_user_preferences` | Generic key-value prefs (nav tray order, etc.) |
| `aft_reservations` | Calendar bookings (`tstzrange` exclusion constraint prevents overlaps) |
| `aft_notification_preferences` | Per-user notification toggles |
| `aft_system_settings` | Global MX reminder thresholds |

**Soft-delete columns (`deleted_at`, `deleted_by`)** present on the 11 tables listed in `src/lib/audit.ts → SOFT_DELETE_TABLES`. Reads filter `deleted_at IS NULL` everywhere.

**Storage Buckets:** `aft_squawk_images`, `aft_note_images`, `aft_aircraft_avatars`, `aft_event_attachments`, `aft_aircraft_documents`.

---

## Role & Permission Model

### Global Roles (aft_user_roles)
- **Admin:** Full system access. Can see Global Fleet, manage settings, run db-health, invite global admins.
- **Pilot:** Base role. Can create aircraft (becomes Admin), log flights, report squawks, post notes.

### Aircraft Roles (aft_user_aircraft_access.aircraft_role)
- **Admin:** Can edit aircraft, invite pilots to that aircraft, manage reservations, schedule maintenance, manage work packages, change user roles, remove users. Aircraft creator is automatically Admin.
- **Pilot:** Can view, log flights, report squawks, post notes, create own reservations, cancel own reservations. Cannot schedule maintenance or manage service events.

### Permission Matrix

| Action | Global Admin | Admin | Pilot |
|--------|:---:|:---:|:---:|
| System settings, db-health | ✓ | | |
| Invite global admins | ✓ | | |
| Invite to specific aircraft | ✓ | ✓ | |
| Edit aircraft details | ✓ | ✓ | |
| Delete aircraft | ✓ | ✓ | |
| Schedule maintenance | ✓ | ✓ | |
| Manage work packages | ✓ | ✓ | |
| Export MX history / ADs | ✓ | ✓ | |
| View active service events | ✓ | ✓ | |
| Cancel others' reservations | ✓ | ✓ | |
| Book reservations for other pilots | ✓ | ✓ | |
| Manage assigned users | ✓ | ✓ | |
| Update fuel state | ✓ | ✓ | ✓ |
| Log flights, report squawks | ✓ | ✓ | ✓ |
| Post notes | ✓ | ✓ | ✓ |
| Create/cancel own reservations | ✓ | ✓ | ✓ |
| Ask Howard anything on accessible aircraft | ✓ | ✓ | ✓ |
| Confirm Howard's `propose_mx_schedule` / `propose_equipment_entry` | ✓ | ✓ | |

---

## Deployment

1. Push to GitHub → Vercel auto-deploys (CI runs `tsc --noEmit` + vitest on every PR first).
2. Run new SQL migrations in Supabase SQL Editor (see `supabase/migrations/README.md`; each file is idempotent and numerically ordered).
3. Create any new storage buckets in Supabase Storage UI.
4. Set environment variables in Vercel dashboard (see `.env.example`).
5. Configure CRON schedules in `vercel.json` (`/api/cron/mx-reminders` daily 12:00 UTC; `/api/cron/ads-sync` daily 06:00 UTC).
6. Optional: set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` to turn on observability.

---

## Email Notifications

All emails sent from `notifications@skywardsociety.com` via Resend. Sender display names (e.g., "Skyward Operations", "Skyward Alerts") are channel labels — the actual sending address is always `notifications@`.

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

Notification types respect user preferences stored in `aft_notification_preferences`. Users manage these through the Settings screen. MX-specific notification toggles are only visible to users who are the primary contact on at least one aircraft.
