# Skyward Aircraft Manager

A fleet management platform built for pilot-owners by **Skyward Society**. Flight logging, maintenance tracking, mechanic coordination, squawk reporting, shared scheduling, and pilot collaboration — all in one progressive web app.

**Live:** [track.skywardsociety.com](https://track.skywardsociety.com)  
**Companion App:** Log It (lightweight PWA for ramp use)

---

## Stack

- **Framework:** Next.js 16 (App Router, React, TypeScript)
- **Styling:** Tailwind CSS v4 with `@theme` custom properties
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Realtime, RLS)
- **Email:** Resend (transactional email from `notifications@skywardsociety.com`)
- **Hosting:** Vercel
- **Repos:** `github.com/notthefaa/skyward-tracker` (main) + `github.com/notthefaa/skyward-logit` (companion)

---

## Features

### Flight Logging
Log flights with automatic engine-type detection. Hobbs & Tach for piston, AFTT & FTT for turbine. Built-in backward-entry validation, fuel state tracking (gallons/lbs with auto-conversion), routing (POD/POA), passenger info, trip reason codes, and full CSV export. Paginated flight log table with computed FLT column. Last flown indicator on the Home screen shows who flew and how long ago.

### Maintenance Tracking
Track items by engine hours or calendar dates with automatic interval recalculation on completion. The predictive engine analyzes 180 days of flight data to project when service will be needed, using an active-days weighted burn rate with weekly rolling variance and a four-factor confidence score. Configurable email alerts at three thresholds. Automated scheduling creates aggregate draft work packages that bundle all items approaching their thresholds within a 30-day lookahead window — so the mechanic gets one comprehensive request, not separate emails for each item. Completed maintenance history is exportable as a PDF with mechanic names, certificate numbers, and work descriptions. Only Tail Admins and Global Admins can schedule maintenance and manage work packages; regular pilots see the MX item list in read-only mode.

### Mechanic Coordination
Bundle MX items, squawks, and add-on services into a single work package. Preview the email before sending. Full lifecycle management: Draft → Scheduling → Confirmed → In Progress → Ready for Pickup → Complete. Both owner and mechanic are notified at each stage. Mechanics can upload photos and documents (up to 5 files, 10MB each) through the service portal. Work package management (creating, sending, confirming/countering dates, messaging mechanic, entering logbook data, cancelling) is restricted to Tail Admins and Global Admins.

### Partial Completion
Service events support completing line items individually. Enter logbook data for some items while leaving others open — completed items reset their MX tracking immediately, and the event stays open for the remaining work. Once all items are resolved (completed or deferred), the event can be closed. Squawk line items auto-resolve on completion and record which service event resolved them.

### MX Calendar Conflict Resolution
When a maintenance event date is confirmed (by either party), the system automatically cancels any overlapping reservations on that aircraft and emails each affected pilot with the maintenance dates and their cancelled booking details.

### Mechanic Portal
Secure token-based access — no login required. Mechanics can propose dates, confirm appointments, update line-item work status, suggest additional items found during service, set estimated completion, upload attachments, and mark the aircraft ready for pickup. All communication is logged and visible to both sides. Portal access expires 7 days after event completion.

### Squawk Reporting
Report discrepancies with photos from the ramp. Flag anything affecting airworthiness to ground the aircraft fleet-wide. Include squawks in service events — they auto-resolve when the mechanic completes the work, with a cross-reference showing which service event resolved each squawk. Full MEL/CDL/NEF/MDL deferral support with digital signatures. Squawks and maintenance are combined under a single MX tab with a selector. Exportable as PDF with cross-reference data included.

### Shared Calendar
Month, week, and day views for aircraft scheduling. Create reservations with start/end times, purpose, and optional route of flight. Hard-block on overlapping bookings — no double-booking allowed. Confirmed maintenance events automatically block calendar dates. All assigned users are notified when reservations are created or cancelled (respects notification preferences).

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

**Mechanic receives:** work packages (CC primary contact), squawk details (only if "Notify MX?" checked, CC primary contact).

Users manage their preferences through the Settings screen. The settings UI is role-scoped: MX reminder and service update toggles are only shown to users who are the primary contact on at least one aircraft.

### Account Management
Settings screen includes notification preferences, password reset via email, account info display, and account self-deletion with cascade impact preview. Deleting an account permanently removes all aircraft the user created (with their flight logs, MX items, squawks, notes, reservations, and service events). A confirmation dialog names the affected tail numbers and user count.

### Pull to Refresh
The app supports pull-to-refresh on all tabs. Pull down from the top of any screen to refresh all data — a pill-shaped indicator slides down from the header showing "Pull to refresh" → "Release to refresh" → "Refreshing..." → "Updated". Built specifically for iOS PWA standalone mode with native touch event handling to prevent the browser's built-in overscroll behavior. Data refreshes in the background without any page reload or flash.

### Session Recovery
The app handles expired Supabase sessions gracefully. When the PWA returns from the background with an invalid refresh token, it detects the failure and redirects to the login screen instead of leaving the user in a broken state. Session validity is re-checked on every visibility change (app foregrounding).

### Tab Persistence
The active tab is preserved when switching browser tabs or backgrounding the app, so you always return to where you left off. Closing the browser or app entirely starts fresh at the fleet summary.

### Companion App (Log It)
Lightweight PWA for ramp use. Log flights and report squawks from the phone's home screen. Includes an optional pilot notes step in the flight log flow — leave a note for the next pilot with optional photo attachments. Notes sync directly to the Notes tab in the main app, and all assigned pilots are notified. Same secure login, instant sync. No app store required.

### Additional Features
- **Real-time sync:** Supabase Realtime with aircraft-scoped refresh — only the affected aircraft's data is refetched, not the entire fleet
- **Fuel tracking:** Gallons and pounds with automatic conversion for W&B, plus standalone fuel updates without flight logging
- **PWA install:** Add to home screen like a native app
- **CSV export:** Download complete flight log history
- **MX history export:** Download complete maintenance history as PDF with mechanic sign-off data
- **Predictive alerts:** Email notifications when MX is approaching based on flying patterns
- **Aggregate work packages:** System bundles all MX items due within 30 days into a single draft
- **Success toasts:** Auto-dismissing confirmations for all key actions
- **Grounded banner:** Shows the specific reason (expired MX item name + days/hours, or AOG squawk location)
- **Squawk cross-references:** Resolved squawks show which service event resolved them
- **10MB file validation:** Client-side and server-side enforcement across all upload points
- **DB health tool:** Automated cleanup of old records, orphaned files, and storage bucket sweeps
- **iOS Safari compatibility:** Global form input fix for `-webkit-appearance` background override

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout, metadata, fonts
│   ├── manifest.ts             # PWA manifest
│   ├── globals.css             # Tailwind v4 theme + iOS Safari form fix
│   ├── page.tsx                # Main app shell (auth, routing, nav, pull-to-refresh, session recovery)
│   ├── update-password/        # Password reset page
│   ├── squawk/[id]/            # Public squawk viewer (shareable link)
│   ├── service/[id]/           # Mechanic portal (token-based access)
│   └── api/
│       ├── aircraft/create/    # Create aircraft + set tailnumber admin
│       ├── aircraft-access/    # Change roles, remove users from aircraft
│       ├── account/delete/     # Account self-deletion with cascade
│       ├── admin/db-health/    # Automated DB cleanup + monitoring
│       ├── cron/mx-reminders/  # Scheduled MX alerts + aggregate work package creation
│       ├── emails/
│       │   ├── mx-schedule/    # MX scheduling email
│       │   ├── note-notify/    # Note notification email (all pilots)
│       │   └── squawk-notify/  # Squawk notification email (all pilots)
│       ├── invite/             # Global admin invite
│       ├── pilot-invite/       # Tailnumber admin invite
│       ├── mx-events/
│       │   ├── complete/       # Complete service event (supports partial completion)
│       │   ├── create/         # Create service event
│       │   ├── owner-action/   # Owner scheduling actions + MX conflict resolution
│       │   ├── respond/        # Mechanic portal actions + MX conflict resolution
│       │   ├── send-workpackage/ # Send/resend work package
│       │   └── upload-attachment/ # Mechanic file uploads
│       ├── resend-invite/      # Re-send auth invitation
│       └── reservations/       # Calendar CRUD + conflict detection
├── components/
│   ├── AppButtons.tsx          # Shared button components
│   ├── AuthScreen.tsx          # Login + forgot password
│   ├── PilotOnboarding.tsx     # First aircraft setup
│   ├── PullIndicator.tsx       # Pull-to-refresh visual indicator
│   ├── Toast.tsx               # Auto-dismissing success notifications
│   ├── modals/
│   │   ├── AircraftModal.tsx   # Create/edit aircraft form (syncs setup times with totals)
│   │   ├── AdminModals.tsx     # Admin center (settings, users, fleet)
│   │   ├── MxGuideModal.tsx    # Maintenance system guide
│   │   ├── ServiceEventModal.tsx # Full service event lifecycle (partial completion, cross-refs)
│   │   ├── SettingsModal.tsx   # Notifications (role-scoped), password, account deletion
│   │   └── TutorialModal.tsx   # First-run tutorial (v5)
│   └── tabs/
│       ├── CalendarDashboard.tsx # SVG ring gauges (bookings, availability, flight hours)
│       ├── CalendarTab.tsx     # Shared scheduling calendar
│       ├── FleetSummary.tsx    # Fleet grid overview
│       ├── MaintenanceTab.tsx  # Combined MX + Squawks with selector + MX history export
│       ├── NotesTab.tsx        # Pilot notes with photos + email notifications
│       ├── SquawksTab.tsx      # Squawk reporting + management + cross-references
│       ├── SummaryTab.tsx      # Aircraft home (hero, times, fuel update, contacts, crew list, next reservation)
│       └── TimesTab.tsx        # Flight log table + entry form
├── hooks/
│   ├── index.ts                # Barrel export
│   ├── useFleetData.ts         # Session-driven data fetching and role resolution
│   ├── useRealtimeSync.ts      # Supabase Realtime with aircraft-scoped refresh
│   ├── useGroundedStatus.ts    # Aircraft airworthiness computation
│   ├── useAircraftRole.ts      # Per-aircraft role resolution
│   └── usePullToRefresh.ts     # iOS PWA pull-to-refresh gesture handler
└── lib/
    ├── auth.ts                 # Server-side auth (requireAuth, requireAircraftAccess)
    ├── authFetch.ts            # Client-side authenticated fetch wrapper
    ├── calendarInvite.ts       # .ics calendar file generation (create + cancel)
    ├── constants.ts            # Shared constants (file size limits)
    ├── env.ts                  # Environment variable validation
    ├── math.ts                 # Predictive engine, burn rate, MX processing
    ├── mxConflicts.ts          # MX calendar conflict resolution (cancel overlapping reservations)
    ├── supabase.ts             # Supabase client singleton
    └── types.ts                # All TypeScript interfaces, types, and notification config
```

---

## Navigation

**Bottom nav (5 tabs):** Home → Times → Calendar → MX → Notes

- **Home:** Aircraft summary with hero image, times (with last flown), fuel (with quick update), contacts, next upcoming reservations, next MX due, active squawks, latest note, and collapsible assigned users list with role management.
- **Times:** Paginated flight log table with log entry form.
- **Calendar:** Dashboard gauges (bookings, availability, flight hours) above the Reserve Aircraft button, followed by month/week/day views with reservation booking and MX event blocks.
- **MX:** Tapping MX opens a centered picker modal to choose Maintenance or Squawks. Active service events, scheduling, and work package management visible to Admins only. MX history export as PDF. An underline tab selector at the top of the page allows switching between the two views.
- **Notes:** Pilot notes with photo attachments and read receipts. Posting a note emails all assigned pilots (except the author).

**Header:** Tail number selector (with "+ Add Aircraft" at bottom), status dot, Fleet button (only if 2+ aircraft), Log It, Admin (global admins only), Settings, Logout.

The active tab persists across browser tab switches and app backgrounding via sessionStorage. Pull-to-refresh is available on all tabs.

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
CRON_SECRET=
NEXT_PUBLIC_APP_VERSION=
NEXT_PUBLIC_COMPANION_URL=
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `aft_aircraft` | Aircraft master records |
| `aft_flight_logs` | Flight log entries |
| `aft_maintenance_items` | MX tracking items (time/date based) |
| `aft_maintenance_events` | Service event lifecycle |
| `aft_event_line_items` | Work package line items (with completion tracking) |
| `aft_event_messages` | Service event communication thread |
| `aft_squawks` | Discrepancy reports (with resolved_by_event_id cross-reference) |
| `aft_notes` | Pilot notes |
| `aft_note_reads` | Note read receipts |
| `aft_user_roles` | Global user roles (admin/pilot) |
| `aft_user_aircraft_access` | Per-aircraft access with aircraft_role |
| `aft_user_profiles` | User display names and email (for admin/portal display) |
| `aft_reservations` | Calendar bookings (exclusion constraint prevents overlaps) |
| `aft_notification_preferences` | Per-user notification toggles (PK: user_id + notification_type) |
| `aft_system_settings` | Global MX reminder thresholds |

**Storage Buckets:** `aft_squawk_images`, `aft_note_images`, `aft_aircraft_avatars`, `aft_event_attachments`

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
| Export MX history | ✓ | ✓ | |
| View active service events | ✓ | ✓ | |
| Cancel others' reservations | ✓ | ✓ | |
| Manage assigned users | ✓ | ✓ | |
| Update fuel state | ✓ | ✓ | ✓ |
| Log flights, report squawks | ✓ | ✓ | ✓ |
| Post notes | ✓ | ✓ | ✓ |
| Create/cancel own reservations | ✓ | ✓ | ✓ |

---

## Deployment

1. Push to GitHub → Vercel auto-deploys
2. Run SQL migrations in Supabase SQL Editor
3. Create storage buckets in Supabase Storage UI
4. Set environment variables in Vercel dashboard
5. Configure CRON in `vercel.json` for MX reminders

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
