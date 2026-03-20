# Skyward Society - Aviation Fleet Tracker

A premium, mobile-first web application designed for aviation departments to manage fleet flight logs, maintenance tracking, squawk reporting, and pilot communications. Built with a robust backend architecture, it features automated maintenance alerts, real-time airworthiness calculations, and role-based access control.

## 🛠 Tech Stack
* **Frontend:** Next.js 16 (App Router), React, TypeScript, Tailwind CSS
* **Backend & Database:** Supabase (PostgreSQL, Auth, Storage, Row Level Security)
* **Automated Emails:** Resend API
* **Hosting & CRON Jobs:** Vercel
* **Key Libraries:** `lucide-react` (UI Icons), `browser-image-compression` (Photo Optimization), `react-signature-canvas` (Deferral Signatures), `jspdf` (Report Generation), `react-image-crop` (Avatar Editor)

---

## 📱 UI / UX Design
* **Mobile-First App Shell:** Utilizes `100dvh`, hidden overflows, and `touch-action: none` to perfectly mimic a native iOS/Android application (no disappearing Safari address bars or auto-zoom bugs).
* **Progressive Web App (PWA):** Fully configured with a Web App Manifest (`manifest.ts`) and Apple Touch Icons. Pilots can "Add to Home Screen" to use the app in a standalone, full-screen mode.
* **Dynamic Airworthiness Indicator:** A global status dot in the header constantly evaluates Maintenance and Squawk databases, glowing **Green** (Airworthy), **Orange** (Open Issues), or pulsing **Red** (Grounded).

---

## 🔐 Role-Based Access Control (RBAC)
The application utilizes strict Supabase Row Level Security (RLS) to enforce data integrity.

* **Administrators:** 
  * Can add, edit, and permanently delete Aircraft.
  * Can invite new users and trigger password reset loops.
  * Explicitly assign individual aircraft visibility to specific pilots.
  * Can track, edit, and delete Maintenance Items.
  * Can execute database health sweeps and preview automated email templates.
  * Can securely roll back the latest flight log and delete historical notes/squawks.
* **Pilots:** 
  * Can only view aircraft assigned to them by an Admin.
  * Can log flights (strict math validation prevents logging backwards times).
  * Can report and resolve squawks.
  * Can add flight notes.
  * Cannot edit historical flight logs or delete squawks/maintenance items.

*(Note: If a pilot is deleted from the system, `ON DELETE SET NULL` constraints ensure their historical flight hours and reports remain permanently intact on the aircraft's logbook).*

---

## ✈️ Core Modules

### 1. Fleet Dashboard
A high-level grid overview of all accessible aircraft. Displays real-time airworthiness status, total flight time, active fuel state, and the next maintenance item due.

### 2. Summary (Command Center)
* **Aircraft Profile:** Displays the customized aircraft avatar, Tail Number, Serial Number, and AirNav.com quick-links.
* **Dynamic Contacts:** Main Contact and MX Contact information featuring native, 1-tap `tel:` and `mailto:` buttons.
* **Fuel State:** Automatically calculates fuel weight based on Engine Type: **Turbine (6.7 lbs/gal)** or **Piston (6.0 lbs/gal)**, including a timestamp of when the fuel was last logged.
* **Quick-Glance Cards:** Interactive routing cards showing Next MX Due, Active Squawks, and the Latest Pilot Note.

### 3. Flight Times (Logbook)
* **Dynamic Inputs:** Automatically adapts to the aircraft type. Piston aircraft enforce Tach/Hobbs times, while Turbine aircraft enforce AFTT/FTT and Engine Cycles.
* **Data Validation:** Mathematically prevents users from logging times lower than the aircraft's current master times.
* **Automated Duration:** Calculates the exact duration (`FLT HRS`) of the flight by comparing the entry to the previous log.
* **CSV Export:** Downloads a strictly formatted Excel-ready document of the aircraft's entire flight history.

### 4. Maintenance Tracker
* Tracks items by **Time** (Hours) or **Date** (Calendar). 
* **Color-Coded Compliance:** Items glow Green (> 45 days/hrs), Orange (<= 30 days/hrs), or Red (<= 10 days/hrs or expired).
* Expired required items globally ground the aircraft with a pulsing red UI banner.

### 5. Squawks & Discrepancies
* **Categorization:** Separates Active issues from Resolved/Archived history.
* **Image Compression:** Uploaded photos are instantly compressed down to ~150KB locally before uploading to Supabase, ensuring lightning-fast load times.
* **Legal Deferrals (Turbine):** Exposes an expandable deferral block (MEL, CDL, NEF, MDL, Category) featuring a native digital Signature Canvas.
* **Mechanic Web Portal:** Generating an email to the MX Contact sends a clean, unbranded summary and a secure, unguessable URL. The mechanic can click the link to view the full report and swipe through a high-resolution photo lightbox *without* needing to log in to the app.
* **PDF Export:** Generates a formal, multi-page PDF report with large, embedded images via `jsPDF`.

### 6. Pilot Notes
* Chatter and temporary notes left by pilots.
* **Perpetual Read Receipts:** The database tracks exactly which notes have been read by which user. Unread notes trigger a pulsing red notification badge on the bottom navigation bar until the user opens the tab.

---

## ⏱ Automated CRON Events (Vercel)

The app utilizes a serverless `GET` route (`/api/cron/mx-reminders`) triggered automatically by Vercel every day at 12:00 PM UTC via the `vercel.json` configuration.

### 1. The 30/15/5-Day Warning Engine
The CRON job evaluates every required maintenance item across the entire fleet against the master aircraft times and dates.
* When an item hits the **30**, **15**, or **5** day/hour threshold, it triggers a Resend email.
* **Recipients:** The email is sent to all Admins and *only* the Pilots who have been explicitly granted access to that specific tail number.
* **Database Flags:** Once an email is sent, boolean flags (`reminder_30_sent`, etc.) are flipped in the database so users aren't spammed with duplicate emails the next day.

### 2. Automated Mechanic Scheduling
If an Admin checks "Automate MX Scheduling" when creating a maintenance item, the system waits until the 30-day or 10-hour threshold is crossed. Once triggered, it automatically emails the designated MX Contact (CC'ing the Main Contact) asking them to add the aircraft to their maintenance schedule.

---

## 🧰 System Tools & Database Health
Housed inside the Admin Control Center is a powerful "Database Health & Cleanup" tool. Because the app utilizes `ON DELETE CASCADE` relations, deleting rows leaves behind "orphaned" images in the Storage Buckets. This tool performs a background sweep:

1. **Read-Receipt Purge:** Deletes all `aft_note_reads` older than 30 days to keep database queries lightning fast.
2. **Note Purge:** Deletes pilot chatter notes older than 6 months (Flight Logs and Squawks are permanently kept).
3. **Orphaned Image Sweeper:** Scans all three Supabase Storage buckets, cross-references them against active database rows, and permanently deletes any image file that does not have a matching record. 

---

## 🚀 Deployment Requirements

### 1. Environment Variables (`.env.local`)
To deploy this application to Vercel, the following environment variables must be configured:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
RESEND_API_KEY=your_resend_api_key
```

### 2. Vercel Configuration (`vercel.json`)
Ensure the `vercel.json` file is present in the root directory to trigger the automated emails:
```json
{
  "crons":[
    {
      "path": "/api/cron/mx-reminders",
      "schedule": "0 12 * * *"
    }
  ]
}
```

### 3. Next.js Configuration (`next.config.mjs`)
The `jspdf` library requires the following exception to successfully pass the Vercel Turbopack compiler during Server-Side Rendering:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages:["jspdf"],
};
export default nextConfig;
```

### 4. Supabase URL Configuration
In your Supabase Dashboard, under **Authentication -> URL Configuration**:
* Set your **Site URL** to your live Vercel domain (e.g., `https://skyward-tracker.vercel.app`).
* Add `https://skyward-tracker.vercel.app/**` to your **Redirect URLs** to ensure Password Reset emails route users back to the live application securely.
```