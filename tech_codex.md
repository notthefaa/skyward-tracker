# 📖 Technical Codex: Skyward Fleet Tracker

## 1. System Architecture Overview
The application is a **Monolithic Serverless Web App** designed with a mobile-first, Progressive Web App (PWA) architecture. 
*   **Frontend Framework:** Next.js 16 (App Router) using React and Tailwind CSS v4.
*   **Backend/Database:** Supabase (PostgreSQL).
*   **Authentication:** Supabase Auth (Email/Password) with custom Role-Based Access Control (RBAC).
*   **Hosting & Execution:** Vercel (Hosts frontend, Serverless API routes, and CRON jobs).
*   **Email Provider:** Resend API.

To prevent collisions with other company apps sharing the same Supabase project, **all database tables, storage buckets, and RLS policies are strictly prefixed with `aft_` (Aviation Fleet Tracker).**

---

## 2. Database Schema (PostgreSQL)

### A. Core Tables
*   **`aft_user_roles`**: Maps a Supabase `auth.users(id)` to an app-specific role (`'admin'` or `'pilot'`). Also stores the user's `email` and `initials`.
*   **`aft_aircraft`**: The master record for each tail number. Tracks master times (`total_airframe_time`, `total_engine_time`), `current_fuel_gallons`, `fuel_last_updated`, `engine_type` ('Piston' or 'Turbine'), and contact details.
*   **`aft_user_aircraft_access`**: A junction table (`user_id`, `aircraft_id`). Used to explicitly grant a specific pilot visibility to a specific aircraft.

### B. Relational Data Tables
*   **`aft_flight_logs`**: Tracks individual flights. Columns structurally adapt based on aircraft type (e.g., `hobbs`/`tach` vs `aftt`/`ftt`/`engine_cycles`).
*   **`aft_maintenance_items`**: Tracks maintenance compliance. Uses `tracking_type` ('time' or 'date') to determine if the trigger uses `due_time` or `due_date`.
*   **`aft_squawks`**: Tracks discrepancies. Includes boolean flags (`affects_airworthiness`, `is_deferred`), array columns for `pictures`, and text strings for signature data and MEL/CDL tracking.
*   **`aft_notes`**: General pilot chatter. Contains an array column for `pictures` and `edited_at` timestamps.
*   **`aft_note_reads`**: A composite primary key table (`note_id`, `user_id`) acting as a ledger for Read Receipts. If a row exists here, the user has read that note.

### C. Foreign Key Behavior (Crucial)
To preserve historical data when a user is deleted from the system, the foreign keys linking `user_id` on Flight Logs, Squawks, and Notes are configured with `ON DELETE SET NULL`. If an admin deletes a pilot, the pilot's flight logs remain permanently on the aircraft to preserve mathematical integrity, but the `user_id` simply becomes `null`.

---

## 3. Row Level Security (RLS) Rules

The database is heavily locked down using Supabase RLS. The frontend UI hiding a button is *not* the primary security layer; the database physically rejects unauthorized API calls.

**1. Aircraft Visibility (`aft_aircraft`):**
*   *Admins:* `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all rows.
*   *Pilots:* Can `SELECT` and `UPDATE` (to save fuel/flight times) **only if** their `auth.uid()` exists in the `aft_user_aircraft_access` table for that specific `aircraft_id`.

**2. Flight Logs (`aft_flight_logs`):**
*   *Pilots:* Can `INSERT` a log, but the `user_id` must match their `auth.uid()`. They **cannot** `UPDATE` or `DELETE` historical logs (prevents rolling back master aircraft times maliciously or accidentally).
*   *Admins:* Can `UPDATE` and `DELETE` logs.

**3. Squawks (`aft_squawks`):**
*   *Pilots & Admins:* Can `INSERT` and `UPDATE` (to allow mechanics/pilots to resolve issues or add deferrals). 
*   *Admins:* Only admins can `DELETE` a squawk entirely.

**4. Notes & Receipts (`aft_notes` & `aft_note_reads`):**
*   *Pilots:* Can `INSERT` notes, but can only `UPDATE` their *own* notes. They can `INSERT/UPDATE` the read-receipts ledger to clear their own notification badges.
*   *Admins:* Can `DELETE` notes.

---

## 4. Storage Buckets
The application uses 3 public Supabase Storage buckets:
1.  `aft_aircraft_avatars`
2.  `aft_squawk_images`
3.  `aft_note_images`

**Security:** `SELECT` (Viewing) is set to `anon` (public) so that unauthenticated mechanics can view images sent to them via email links. `INSERT`, `UPDATE`, and `DELETE` operations are strictly restricted to `authenticated` users.

---

## 5. Server-Side API Routes (Next.js)
To bypass RLS for administrative tasks or hide secret API keys (like Resend), the app uses Next.js serverless API routes located in `src/app/api/`. These utilize the `SUPABASE_SERVICE_ROLE_KEY` to act as a super-admin.

*   **`POST /api/invite`**: Uses the Supabase Admin Auth API to generate a secure invite link, emails the user, and writes their email and role to `aft_user_roles`.
*   **`DELETE /api/users`**: Securely deletes a user from the Supabase Auth system entirely.
*   **`POST /api/admin/db-health`**: A maintenance script that forcefully purges `aft_note_reads` older than 30 days, `aft_notes` older than 6 months, and iterates through all 3 Storage Buckets to permanently delete orphaned images that no longer have a matching database row.
*   **`POST /api/emails/*`**: Handles HTML compilation and dispatches Resend emails for Squawk alerts and Maintenance scheduling.
*   **`GET /api/cron/mx-reminders`**: Triggered by Vercel's CRON engine (via `vercel.json`). Iterates through all aircraft. If an item is <= 30, 15, or 5 days/hours away, it compiles a deduped array of authorized pilot and admin emails, dispatches alerts, and sets a boolean flag (e.g., `reminder_30_sent = true`) in the database to prevent duplicate firing the next day.

> ⚠️ **TypeScript Nuance in API Routes:** Due to Vercel's strict ES5 compilation targets, modern ES6 array deduplication (`[...new Set(array)]`) will throw a `TS2802` build crash. All API routes rely on standard ES5 `for` loops and `Array.concat()` methods to manipulate data.

---

## 6. Frontend Component Architecture

### A. The App Shell (`page.tsx`)
The app utilizes a "Locked Flex" layout (`h-[100dvh]`, `overflow-hidden`, `touch-action: none` applied via `globals.css`). This perfectly mimics a native mobile application, preventing iOS Safari from triggering the "pull-to-refresh" bounce or hiding the top/bottom navigation toolbars on scroll.

`page.tsx` manages all master state: `session`, `aircraftList`, `activeTail`, `activeTab`, and `aircraftStatus`. It passes these down as props to the modular tab components.

### B. The Tabs (`src/components/tabs/`)
1.  **`FleetSummary.tsx`**: Renders the high-level grid view.
2.  **`SummaryTab.tsx`**: The dashboard. Performs dynamic math on mount to calculate Fuel Lbs (using the engine type coefficient) and sorts maintenance arrays to find the single closest due item.
3.  **`TimesTab.tsx`**: Handles flight logging. 
    *   *Math Note:* Fetches 11 records from the database instead of 10, allowing the frontend to subtract record 10 from record 11 to calculate the exact `Flt Hrs` duration for the UI.
4.  **`MaintenanceTab.tsx`**: Evaluates all due items. Items > 45 days/hrs turn `text-success` (Green). Items <= 30 turn `#F08B46` (Orange). Items <= 10 or expired turn `#CE3732` (Red).
5.  **`SquawksTab.tsx`**: Splits data into `activeSquawks` and `resolvedSquawks`.
6.  **`NotesTab.tsx`**: Evaluates the `aft_note_reads` table against the `aft_notes` table to calculate unread badges.

### C. The Mechanic Portal (`squawk/[id]/page.tsx`)
A completely isolated, unauthenticated public web page. Sent via `mailto:` links, it allows third-party mechanics to securely view squawk details and access the React Image Lightbox without creating an account.

---

## 7. Crucial Next.js & Vercel Specifics

### A. Image Compression
Users upload multi-megabyte photos from their phones. The frontend relies on `browser-image-compression` to resize images (Max 1MB, Max 1920px) inside the browser *before* transmitting to Supabase. This keeps storage costs negligible and load times instantaneous.

### B. The `jsPDF` Turbopack Crash
The `jspdf` library relies on a Node.js binary (`fflate/lib/node.cjs`). If Vercel's Turbopack attempts to compile this during Server-Side Rendering (SSR), the build will fatally crash.
*   **Fix 1:** `jsPDF` is loaded using an asynchronous dynamic import (`await import('jspdf')`) inside the button click handler, preventing it from executing during the page load.
*   **Fix 2:** `next.config.mjs` explicitly flags `jspdf` inside the `serverExternalPackages` array to force Turbopack to ignore it.

### C. PWA Manifest & Icons
The app relies on a dynamically generated `src/app/manifest.ts` and a single `public/icon.png`. Next.js automatically maps these to Apple Touch Icons and Favicons, allowing users to "Add to Home Screen" and run the app in standalone mode. The `layout.tsx` specifically enforces `userScalable: false` to prevent iOS Safari from breaking the UI when input fields are focused.
```