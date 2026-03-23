# 📖 Technical Codex: Skyward Fleet Tracker

## 1. System Architecture Overview
The platform utilizes a **Dual-App Serverless Architecture** to bypass iOS Progressive Web App (PWA) domain-caching limitations and provide targeted user experiences.
*   **Main App (`skyward-tracker`):** The heavy-duty administrative dashboard for deep fleet management.
*   **Companion App (`skyward-logit`):** A streamlined, mobile-first PWA designed solely for rapid data entry (flight logs and squawks) on the ramp.
*   **Backend:** Both Vercel apps point to the identical Supabase (PostgreSQL) database, allowing for instant, real-time data syncing between the two platforms.

To prevent collisions with other company apps sharing the same Supabase project, **all database tables, storage buckets, and RLS policies are strictly prefixed with `aft_` (Aviation Fleet Tracker).**

---

## 2. Database Schema (PostgreSQL)

### A. Core Tables
*   **`aft_user_roles`**: Maps a Supabase `auth.users(id)` to an app-specific role (`'admin'` or `'pilot'`). Also stores the user's `email` and `initials`.
*   **`aft_aircraft`**: The master record for each tail number. 
    *   *Tracking:* Tracks master times (`total_airframe_time`, `total_engine_time`), `current_fuel_gallons`, `fuel_last_updated`, `engine_type` ('Piston' or 'Turbine').
    *   *Baseline Math:* `setup_aftt`, `setup_ftt`, `setup_hobbs`, and `setup_tach` permanently store the starting times of the aircraft upon creation to allow the first flight log duration to calculate perfectly.
    *   *Ownership:* `created_by` maps to `auth.users(id)`. Used in the frontend to grant standard Pilots edit-rights to aircraft they personally onboarded.
*   **`aft_user_aircraft_access`**: A junction table (`user_id`, `aircraft_id`). Explicitly dictates which specific aircraft a Pilot or Admin is allowed to see and interact with.
*   **`aft_system_settings`**: A single-row configuration table (`id = 1`) managing global integer configurations for MX Email triggers (`reminder_1`, `reminder_2`, `reminder_3`, `sched_time`, `sched_days`).

### B. Relational Data Tables
*   **`aft_flight_logs`**: Tracks individual flights. Includes `pod` (Point of Departure) and `poa` (Point of Arrival) using ICAO strings. Columns structurally adapt based on aircraft type (`hobbs`/`tach` vs `aftt`/`ftt`/`engine_cycles`).
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
*   *Pilots:* Can `SELECT` and `UPDATE` (to save fuel/flight times) **only if** their `auth.uid()` exists in the `aft_user_aircraft_access` table for that specific `aircraft_id`. They can only freely edit the master profile if `created_by` matches their `auth.uid()`.

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

*   **`POST /api/aircraft/create`**: The Pilot Onboarding interceptor. Pilots submit their new aircraft to this route, which securely creates the plane as a super-admin and immediately maps it to their `aft_user_aircraft_access` list.
*   **`POST /api/invite`**: Uses the Supabase Admin Auth API to generate a secure invite link, emails the user, and writes their email and role to `aft_user_roles`.
*   **`POST /api/resend-invite`**: Used on the Link Expired page. Re-triggers `admin.inviteUserByEmail()` for a specific address to generate a fresh token without overwriting their previously assigned aircraft access.
*   **`DELETE /api/users`**: Securely deletes a user from the Supabase Auth system entirely.
*   **`POST /api/admin/db-health`**: A maintenance script that forcefully purges `aft_note_reads` older than 30 days, `aft_notes` older than 6 months, and iterates through all 3 Storage Buckets to permanently delete orphaned images that no longer have a matching database row.
*   **`POST /api/emails/*`**: Handles HTML compilation and dispatches Resend emails for Squawk alerts and Maintenance scheduling. Uses the `Reply-To` trick to prevent spam bouncing (detailed below).
*   **`GET /api/cron/mx-reminders`**: Triggered by Vercel's CRON engine (via `vercel.json`). Iterates through all aircraft, fetches the dynamic `aft_system_settings`, cross-references due times/dates, and automatically dispatches warning emails to the assigned pilots and admins while flipping boolean flags (e.g., `reminder_30_sent = true`) to prevent spamming.

---

## 6. Frontend Component Architecture & Extraction

To prevent the main `page.tsx` from bloating, massive UI forms were modularized into `src/components/`, leaving `page.tsx` to act purely as a "Traffic Cop" to route the user.

1.  **`AuthScreen.tsx`**: Encapsulates Login/Forgot Password.
2.  **`PilotOnboarding.tsx`**: Encapsulates the "Setup Your Aircraft" flow. Collects initial `setup_` times and triggers the `/api/aircraft/create` route.
3.  **`modals/AircraftModal.tsx`**: Encapsulates the Add/Edit Aircraft forms and the React Image Cropper logic. Prevents running totals (`total_`) from being overwritten during edits.
4.  **`modals/AdminModals.tsx`**: Manages all 6 admin overlays (Global Fleet, Invite, Access, Settings, DB Health, Email Previewer) keeping the root file incredibly lean.
5.  **`tabs/TimesTab.tsx`**: Handles flight logging. Fetches 11 records from the database instead of 10, allowing the frontend to subtract record 10 from record 11 to calculate the exact `Flt Hrs` duration. The absolute oldest log calculates against the aircraft's `setup_` times.

---

## 7. Advanced PWA & Mobile Quirks

### A. The iOS "Standalone App Trap"
When a user adds a PWA to their iOS home screen, Apple places the app into a strict, chromeless sandbox. iOS actively overrides `target="_blank"` and `window.open()` commands for links sharing the same root domain to prevent the app from "escaping." 
*   **The Fix:** The "Log It" companion app was moved to a completely separate Vercel repository and URL. The Main App features a "Breakout Modal" utilizing `navigator.clipboard` and `navigator.share` to instruct iOS users to manually open native Safari to install the secondary app.

### B. Vercel Automated Cache-Busting
PWAs cache Javascript aggressively. To ensure updates reach all iPads/Phones instantly:
*   The `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` environment variable is checked on the initial React mount. If the device's `localStorage` string doesn't match the live Vercel commit hash, the app forcibly wipes its memory and executes a `window.location.reload()`.

### C. Image Compression
Users upload multi-megabyte photos from their phones. The frontend relies on `browser-image-compression` to resize images (Max 1MB, Max 1920px) inside the browser *before* transmitting to Supabase. This keeps storage costs negligible and load times instantaneous.

### D. The `jsPDF` Turbopack Crash
The `jspdf` library relies on a Node.js binary. If Vercel's Turbopack attempts to compile this during Server-Side Rendering (SSR), the build fatally crashes. `next.config.mjs` explicitly flags `jspdf` inside the `serverExternalPackages` array to force Turbopack to ignore it.

---

## 8. Security & Authentication Engineering

### A. Enterprise Email Scanner Bypass (SafeLinks)
Corporate email providers (Microsoft 365, Mimecast) utilize bots that click links in incoming emails to check for phishing. When using Supabase's default Auto-Verify endpoints, these bots were "burning" the one-time-use invite tokens before the human pilot ever saw the email, resulting in "Auth Session Missing" errors.
*   **The Fix:** Supabase Email Templates were rewritten to point to `/update-password?token_hash={{ .TokenHash }}&type=invite`. The email bots download the HTML but cannot execute the complex React `useEffect` hooks. When the actual human opens the link in a real browser, the client-side code extracts the hash, fires `supabase.auth.verifyOtp()`, and successfully establishes the session.

### B. Email Spoofing Prevention (The `Reply-To` Trick)
Resend APIs will bounce any email attempting to send "from" an unverified domain (e.g., `john.doe@gmail.com`). 
*   **The Fix:** All automated system emails are securely dispatched from the verified `notifications@skywardsociety.com` domain. The backend dynamically manipulates the email headers, inserting the aircraft's `main_contact` as the Display Name, and the `main_contact_email` into the `Reply-To` header. This ensures 100% deliverability while allowing mechanics to simply hit "Reply" to talk directly to the human manager.