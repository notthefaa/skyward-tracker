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
Log flights with automatic engine-type detection. Hobbs & Tach for piston, AFTT & FTT for turbine. Built-in backward-entry validation, fuel state tracking (gallons/lbs with auto-conversion), routing (POD/POA), passenger info, trip reason codes, and full CSV export. Paginated flight log table with computed FLT column.

### Maintenance Tracking
Track items by engine hours or calendar dates with automatic interval recalculation on completion. The predictive engine analyzes 180 days of flight data to project when service will be needed, using an active-days weighted burn rate with weekly rolling variance and a four-factor confidence score. Configurable email alerts at three thresholds. Automated scheduling creates draft work packages when items approach their due points. Only Tail Admins and Global Admins can schedule maintenance and manage work packages; regular pilots see the MX item list in read-only mode.

### Mechanic Coordination
Bundle MX items, squawks, and add-on services into a single work package. Preview the email before sending. Full lifecycle management: Draft → Scheduling → Confirmed → In Progress → Ready for Pickup → Complete. Both owner and mechanic are notified at each stage. Mechanics can upload photos and documents (up to 5 files, 10MB each) through the service portal. Work package management (creating, sending, confirming/countering dates, messaging mechanic, entering logbook data, cancelling) is restricted to Tail Admins and Global Admins.

### Mechanic Portal
Secure token-based access — no login required. Mechanics can propose dates, confirm appointments, update line-item work status, suggest additional items found during service, set estimated completion, upload attachments, and mark the aircraft ready for pickup. All communication is logged and visible to both sides. Portal access expires 7 days after event completion.

### Squawk Reporting
Report discrepancies with photos from the ramp. Flag anything affecting airworthiness to ground the aircraft fleet-wide. Include squawks in service events — they auto-resolve when the mechanic completes the work. Full MEL/CDL/NEF/MDL deferral support with digital signatures. Squawks and maintenance are combined under a single MX tab with a selector.

### Shared Calendar
Month, week, and day views for aircraft scheduling. Create reservations with start/end times, purpose, and optional route of flight. Hard-block on overlapping bookings — no double-booking allowed. Confirmed maintenance events automatically block calendar dates. All assigned users are notified when reservations are created or cancelled (respects notification preferences).

### Calendar Dashboard
Three floating SVG ring gauges displayed above the Reserve Aircraft button: **My Bookings** shows how many days the current user has reserved in the next 30 days. **Available** shows how many of the next 30 days are free (blue if >15, orange if ≤15, red if ≤5 — accounts for both reservations and confirmed MX events). **Flight Hours** shows total hours flown over a selectable period (30, 60, 90, 120 days, or a custom date range), with the period selector nested under the gauge.

### Pilot Invitations & Aircraft-Level Roles
Two-tier role system: global roles (admin/pilot) and per-aircraft roles (Tail Admin/Tail Pilot). Tail Admins can edit the aircraft, invite pilots, manage reservations, schedule maintenance, manage work packages, and change user roles for their aircraft. Tail Pilots can view, log flights, report squawks, post notes, and manage their own reservations. Invitations happen through the aircraft summary page.

### Notification System
Notifications split into two categories: operational awareness goes to all assigned pilots; maintenance coordination goes to the primary contact only.

**All assigned pilots receive:** squawk reports (excluding reporter), note posts (excluding author), reservation created (excluding creator), reservation cancelled (excluding canceller).

**Primary contact only receives:** MX reminders, service event updates, draft work package notifications, scheduling emails.

**Mechanic receives:** work packages (CC primary contact), squawk details (only if "Notify MX?" checked, CC primary contact).

Users manage their preferences through the Settings screen. The settings UI is role-scoped: MX reminder and service update toggles are only shown to users who are the primary contact on at least one aircraft.

### Account Management
Settings screen includes notification preferences, password reset via email, account info display, and account self-deletion with cascade impact preview. Deleting an account permanently removes all aircraft the user created (with their flight logs, MX items, squawks, notes, reservations, and service events). A confirmation dialog names the affected tail numbers and user count.

### Tab Persistence
The active tab is preserved when switching browser tabs or backgrounding the app, so you always return to where you left off. Closing the browser or app entirely starts fresh at the fleet summary.

### Companion App (Log It)
Lightweight PWA for ramp use. Log flights and report squawks from the phone's home screen. Includes an optional pilot notes step in the flight log flow — leave a note for the next pilot with optional photo attachments. Notes sync directly to the Notes tab in the main app, and all assigned pilots are notified. Same secure login, instant sync. No app store required.

### Additional Features
- **Real-time sync:** Supabase Realtime with aircraft-scoped refresh — only the affected aircraft's data is refetched, not the entire fleet
- **Fuel tracking:** Gallons and pounds with automatic conversion for W&B
- **PWA install:** Add to home screen like a native app
- **CSV export:** Download complete flight log history
- **Predictive alerts:** Email notifications when MX is approaching based on flying patterns
- **Success toasts:** Auto-dismissing confirmations for all key actions
- **Grounded banner:** Shows the specific reason (expired MX item name + days/hours, or AOG squawk location)
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
│   ├── page.tsx                # Main app shell (auth, routing, nav, tab persistence)
│   ├── update-password/        # Password reset page
│   ├── squawk/[id]/            # Public squawk viewer (shareable link)
│   ├── service/[id]/           # Mechanic portal (token-based access)
│   └── api/
│       ├── aircraft/create/    # Create aircraft + set tailnumber admin
│       ├── aircraft-access/    # Change roles, remove users from aircraft
│       ├── account/delete/     # Account self-deletion with cascade
│       ├── admin/db-health/    # Automated DB cleanup + monitoring
│       ├── cron/mx-reminders/  # Scheduled MX alerts (Vercel CRON)
│       ├── emails/
│       │   ├── mx-schedule/    # MX scheduling email
│       │   ├── note-notify/    # Note notification email (all pilots)
│       │   └── squawk-notify/  # Squawk notification email (all pilots)
│       ├── invite/             # Global admin invite
│       ├── pilot-invite/       # Tailnumber admin invite
│       ├── mx-events/
│       │   ├── complete/       # Complete service event
│       │   ├── create/         # Create service event
│       │   ├── manual-trigger/ # Manual MX trigger
│       │   ├── owner-action/   # Owner scheduling actions
│       │   ├── respond/        # Mechanic portal actions
│       │   ├── send-workpackage/ # Send/resend work package
│       │   └── upload-attachment/ # Mechanic file uploads
│       ├── resend-invite/      # Re-send auth invitation
│       └── reservations/       # Calendar CRUD + conflict detection
├── components/
│   ├── AppButtons.tsx          # Shared button components
│   ├── AuthScreen.tsx          # Login + forgot password
│   ├── PilotOnboarding.tsx     # First aircraft setup
│   ├── Toast.tsx               # Auto-dismissing success notifications
│   ├── modals/
│   │   ├── AircraftModal.tsx   # Create/edit aircraft form
│   │   ├── AdminModals.tsx     # Admin center (settings, users, fleet)
│   │   ├── MxGuideModal.tsx    # Maintenance system guide
│   │   ├── ServiceEventModal.tsx # Full service event lifecycle (admin-gated actions)
│   │   ├── SettingsModal.tsx   # Notifications (role-scoped), password, account deletion
│   │   └── TutorialModal.tsx   # First-run tutorial
│   └── tabs/
│       ├── CalendarDashboard.tsx # SVG ring gauges (bookings, availability, flight hours)
│       ├── CalendarTab.tsx     # Shared scheduling calendar
│       ├── FleetSummary.tsx    # Fleet grid overview
│       ├── MaintenanceTab.tsx  # Combined MX + Squawks with selector (admin-gated actions)
│       ├── NotesTab.tsx        # Pilot notes with photos + email notifications
│       ├── SquawksTab.tsx      # Squawk reporting + management
│       ├── SummaryTab.tsx      # Aircraft home (hero, times, fuel, contacts)
│       └── TimesTab.tsx        # Flight log table + entry form
├── hooks/
│   ├── index.ts                # Barrel export
│   ├── useFleetData.ts         # Session-driven data fetching and role resolution
│   ├── useRealtimeSync.ts      # Supabase Realtime with aircraft-scoped refresh
│   ├── useGroundedStatus.ts    # Aircraft airworthiness computation
│   └── useAircraftRole.ts      # Per-aircraft role resolution
└── lib/
    ├── auth.ts                 # Server-side auth (requireAuth, requireAircraftAccess)
    ├── authFetch.ts            # Client-side authenticated fetch wrapper
    ├── constants.ts            # Shared constants (file size limits)
    ├── env.ts                  # Environment variable validation
    ├── math.ts                 # Predictive engine, burn rate, MX processing
    ├── supabase.ts             # Supabase client singleton
    └── types.ts                # All TypeScript interfaces, types, and notification config
```

---

## Navigation

**Bottom nav (5 tabs):** Home → Times → Calendar → MX → Notes

- **Home:** Aircraft summary with hero image, times, fuel, contacts, next MX due, active squawks, latest note. Overlay buttons for invite, edit, and delete (visible to Tail Admins).
- **Times:** Paginated flight log table with log entry form.
- **Calendar:** Dashboard gauges (bookings, availability, flight hours) above the Reserve Aircraft button, followed by month/week/day views with reservation booking and MX event blocks.
- **MX:** Tapping MX opens a centered picker modal to choose Maintenance or Squawks. Active service events, scheduling, and work package management visible to Tail Admins and Global Admins only. An underline tab selector at the top of the page allows switching between the two views.
- **Notes:** Pilot notes with photo attachments and read receipts. Posting a note emails all assigned pilots (except the author).

**Header:** Tail number selector (with "+ Add Aircraft" at bottom), status dot, Fleet button (only if 2+ aircraft), Log It, Admin (global admins only), Settings, Logout.

The active tab persists across browser tab switches and app backgrounding via localStorage.

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
| `aft_event_line_items` | Work package line items |
| `aft_event_messages` | Service event communication thread |
| `aft_squawks` | Discrepancy reports |
| `aft_notes` | Pilot notes |
| `aft_note_reads` | Note read receipts |
| `aft_user_roles` | Global user roles (admin/pilot) |
| `aft_user_aircraft_access` | Per-aircraft access with aircraft_role |
| `aft_reservations` | Calendar bookings (exclusion constraint prevents overlaps) |
| `aft_notification_preferences` | Per-user notification toggles |
| `aft_system_settings` | Global MX reminder thresholds |

**Storage Buckets:** `aft_squawk_images`, `aft_note_images`, `aft_aircraft_avatars`, `aft_event_attachments`

---

## Role & Permission Model

### Global Roles (aft_user_roles)
- **Admin:** Full system access. Can see Global Fleet, manage settings, run db-health, invite global admins.
- **Pilot:** Base role. Can create aircraft (becomes Tail Admin), log flights, report squawks, post notes.

### Aircraft Roles (aft_user_aircraft_access.aircraft_role)
- **Tail Admin:** Can edit aircraft, invite pilots to that aircraft, manage reservations, schedule maintenance, manage work packages, change user roles, remove users. Aircraft creator is automatically Tail Admin.
- **Tail Pilot:** Can view, log flights, report squawks, post notes, create own reservations, cancel own reservations. Cannot schedule maintenance or manage service events.

### Permission Matrix

| Action | Global Admin | Tail Admin | Tail Pilot |
|--------|:---:|:---:|:---:|
| System settings, db-health | ✓ | | |
| Invite global admins | ✓ | | |
| Invite to specific aircraft | ✓ | ✓ | |
| Edit aircraft details | ✓ | ✓ | |
| Delete aircraft | ✓ | ✓ | |
| Schedule maintenance | ✓ | ✓ | |
| Manage work packages | ✓ | ✓ | |
| View active service events | ✓ | ✓ | |
| Cancel others' reservations | ✓ | ✓ | |
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
| MX reminders (cron) | Primary contact only | — |
| Service updates (mechanic) | Primary contact only | — |
| Draft work package created | Primary contact only | — |
| Work package to mechanic | Mechanic + CC primary contact | — |

Notification types respect user preferences stored in `aft_notification_preferences`. Users manage these through the Settings screen. MX-specific notification toggles are only visible to users who are the primary contact on at least one aircraft.
