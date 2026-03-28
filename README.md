# Skyward Fleet Tracker

A progressive web app (PWA) for general aviation fleet management. Track aircraft, log flights, manage maintenance, report squawks, and coordinate with mechanics — all from your phone.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React, Tailwind CSS v4, TypeScript |
| Backend | Next.js API Routes, Supabase (PostgreSQL + Auth + Storage + RLS) |
| Email | Resend (transactional email) |
| Hosting | Vercel |
| Companion App | Skyward LogIt — separate Next.js PWA for quick flight/squawk logging |

Both apps share a single Supabase database. The database also serves another app with a different table prefix.

## Repository Structure

```
src/
├── app/
│   ├── page.tsx                    # Main app shell — auth, data loading, tabs, nav
│   ├── layout.tsx                  # Root layout — fonts, metadata, viewport, favicon
│   ├── globals.css                 # Theme colors, body styles, animations
│   ├── api/
│   │   ├── admin/
│   │   │   └── db-health/route.ts  # Database cleanup (9 stages) — admin only
│   │   ├── aircraft/
│   │   │   └── create/route.ts     # Create aircraft — authenticated
│   │   ├── cron/
│   │   │   └── mx-reminders/       # Automated MX alerts + predictive scheduling
│   │   ├── emails/
│   │   │   ├── mx-schedule/        # Manual MX scheduling email to mechanic
│   │   │   └── squawk-notify/      # Squawk notification emails
│   │   ├── invite/route.ts         # Admin invite user — admin only
│   │   ├── resend-invite/route.ts  # Resend invite — intentionally unauthenticated
│   │   ├── users/route.ts          # User management — admin only
│   │   └── mx-events/
│   │       ├── create/route.ts     # Create maintenance event — authenticated
│   │       ├── send-workpackage/   # Send/resend work package to mechanic
│   │       ├── respond/route.ts    # Mechanic actions (propose, confirm, decline, etc.)
│   │       ├── owner-action/       # Owner actions (confirm, counter, cancel, comment)
│   │       └── complete/route.ts   # Complete event + reset MX tracking
│   ├── service/[id]/page.tsx       # Mechanic portal (accessed via secure token)
│   ├── squawk/[id]/page.tsx        # Public squawk viewer (accessed via squawk ID)
│   └── update-password/page.tsx    # Password update page
├── components/
│   ├── AuthScreen.tsx              # Login/signup UI
│   ├── PilotOnboarding.tsx         # First-time pilot setup wizard
│   ├── AppButtons.tsx              # Shared button components
│   ├── TicketField.tsx             # Reusable form field component
│   ├── modals/
│   │   ├── ServiceEventModal.tsx   # Full MX event lifecycle modal
│   │   ├── AdminModals.tsx         # Admin tools (users, settings, fleet, invites)
│   │   ├── AircraftModal.tsx       # Add/edit aircraft form
│   │   └── TutorialModal.tsx       # First-time user tutorial
│   └── tabs/
│       ├── FleetSummary.tsx        # Fleet overview grid
│       ├── SummaryTab.tsx          # Aircraft detail summary
│       ├── TimesTab.tsx            # Flight log history + entry
│       ├── MaintenanceTab.tsx      # MX tracking + service events
│       ├── SquawksTab.tsx          # Squawk management
│       └── NotesTab.tsx            # Pilot notes / crew communication
└── lib/
    ├── types.ts                    # Shared TypeScript interfaces
    ├── math.ts                     # Burn rate, confidence, MX projections
    ├── auth.ts                     # Server-side auth middleware
    ├── authFetch.ts                # Client-side authenticated fetch wrapper
    ├── env.ts                      # Environment variable validation
    └── supabase.ts                 # Supabase client initialization
```

## Key Features

### Flight Operations
- Log flights with Hobbs/Tach (piston) or AFTT/FTT (turbine)
- Track fuel state with gallons/lbs conversion
- Departure/arrival airports, passengers, trip reason codes
- CSV export of flight history
- Backward-time validation prevents data entry errors

### Maintenance Tracking
- Time-based and date-based MX item tracking
- Predictive maintenance engine using 180-day burn rate with 4-factor confidence scoring
- Automated draft work package creation when items approach due
- Weekly variance analysis for projection accuracy

### Maintenance Event Workflow
Complete service event lifecycle between owner and mechanic:

```
Draft → Scheduling → Confirmed → In Progress → Ready for Pickup → Complete
                                                                      ↕
                                              Cancel/Decline ← (from any active status)
```

- Owner creates work packages with MX items, squawks, and add-on services
- Email preview before sending
- Mechanic receives email with secure portal link
- Date negotiation (propose/confirm/counter)
- Line item status tracking with owner notifications
- Mechanic can suggest additional discovered work
- "Aircraft Ready for Pickup" signal
- Owner enters logbook data to complete and reset tracking
- Squawks auto-resolve on completion
- Cancel (owner) and decline (mechanic) flows with notifications

### Mechanic Portal
- Secure access via 256-bit hex token (no login required)
- View work package, aircraft details, squawk photos
- Propose/confirm service dates with availability notes
- Update line item statuses (pending → in progress → complete → deferred)
- Set estimated completion date
- Suggest additional work items
- Mark aircraft ready for pickup
- Decline service with reason
- Message thread with owner

### Squawk Management
- Report squawks with photos and location
- Airworthiness assessment (grounded vs monitor)
- MEL/CDL/NEF/MDL deferral support for turbine aircraft
- Digital signature capture for deferrals
- Squawk viewer page for mechanic access
- Auto-resolution when completed via service event

### Communication
- Pilot notes per aircraft with unread badges
- Owner ↔ mechanic messaging through service events
- All messages logged and timestamped
- 15 email touchpoints across 6 routes, all with actionable links
- Realtime updates via Supabase channels

### Administration
- Role-based access (admin/pilot)
- User invitation and management
- Global fleet view with aircraft assignment
- System settings for reminder thresholds
- Database health tool with 9 cleanup stages and row count monitoring

## iOS PWA Layout

The app uses `viewport-fit: cover` for the navy status bar and a three-panel fixed layout:

- **Header**: `fixed top-0` with `paddingTop: env(safe-area-inset-top)`
- **Main**: `fixed` between header and nav, `overflow-y-auto`
- **Nav**: `fixed bottom-0` with `pb-[env(safe-area-inset-bottom)]`

All modals use `z-[10000]+` to render above the header/nav (`z-[9999]`).

## Performance Optimizations

- All initial data queries run in parallel via `Promise.all` (~200ms vs ~1000ms)
- App shell renders immediately after auth; content loads progressively
- Dynamic imports for code splitting (11 components)
- Realtime channel for cross-user updates (no polling)

## Database Health Tool

Automated cleanup via `POST /api/admin/db-health` (admin only):

1. Read receipts — purge after 30 days
2. Notes — purge after 6 months
3. Squawks — never purged (permanent history)
4. Completed MX events — purge after 12 months (completion data lives on MX items)
5. Cancelled MX events — purge after 3 months
6. Orphaned child records (messages, line items for deleted events)
7. Orphaned access records (for deleted aircraft)
8. Flight logs — purge after 5 years
9. Orphaned images in 3 storage buckets
10. Table row counts for monitoring

## Environment Variables

### Main App (skyward-tracker)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
CRON_SECRET=
NEXT_PUBLIC_APP_VERSION=
NEXT_PUBLIC_COMPANION_URL=
```

### Companion App (skyward-logit)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_APP_VERSION=
NEXT_PUBLIC_MAIN_APP_URL=
```

## Security

- All API routes authenticated via `requireAuth()` middleware
- Admin routes require admin role check
- CRON route protected by `CRON_SECRET` header
- Mechanic portal uses 256-bit hex access tokens (unguessable)
- RLS enabled on all 12 tables
- User ID derived from session, never from client body
- Error responses sanitized (no Supabase internals)
- `resend-invite` intentionally unauthenticated (invite tokens are single-use)

## Brand Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Navy | #091F3C | Headers, primary text |
| Blue | #3AB0FF | Links, times, info |
| Orange | #F08B46 | MX, warnings, actions |
| Red | #CE3732 | Squawks, errors, grounded |
| Green | #56B94A | Success, airworthy, complete |
| Slate | #525659 | Notes, secondary text |
