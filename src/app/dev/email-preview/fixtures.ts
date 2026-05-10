// =============================================================
// Email preview fixtures.
//
// One sample of every email the app sends, composed with the same
// shared components the production routes use. Wiring:
//
//   /dev/email-preview           → index page listing all variants
//   /dev/email-preview/[slug]    → renders one variant as raw HTML
//
// Both routes are gated on a dev-only env check (see route files).
//
// When a production email template changes, update its matching
// `build…` function below so the preview stays current. The preview
// is intentionally decoupled from the route handlers — extracting
// each template to a shared builder function would mean a fatter
// refactor of the existing routes. The preview being a conscious
// mirror keeps the production routes tidy while still giving us a
// browsable / forwardable surface for visual QA.
// =============================================================

import {
  emailShell,
  heading,
  paragraph,
  callout,
  bulletList,
  keyValueBlock,
  button,
  sectionHeading,
} from '@/lib/email/layout';

const APP_URL = 'https://track.skywardsociety.com';
const PORTAL_URL = 'https://track.skywardsociety.com/service/sample-token-abc123';
const SQUAWK_URL = 'https://track.skywardsociety.com/squawk/sample-token-xyz789';

const SIGNATURE_MX = `
  <div class="sw-paragraph" style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:#091F3C;">
    Thank you,<br />
    <strong>Alex Gornakov</strong><br />
    (555) 867-5309<br />
    <a href="mailto:alex@example.com" style="color:#091F3C;text-decoration:underline;">alex@example.com</a>
  </div>
`;

export interface Variant {
  slug: string;
  label: string;
  description: string;
  category: 'Note' | 'Squawk' | 'Scheduling' | 'Mechanic Portal' | 'Owner → Mechanic' | 'Reservation' | 'Auto-Cancel';
  subject: string;
  from: string;
  to: string;
  html: string;
}

// --- 1. Note posted ----------------------------------------

const noteNew: Variant = {
  slug: 'note-new',
  label: 'New note posted',
  description: 'A pilot posted a shared note on an aircraft the recipient has access to.',
  category: 'Note',
  subject: 'New Note: N205WH',
  from: 'Skyward Alerts <notifications@skywardsociety.com>',
  to: 'All other assigned pilots',
  html: emailShell({
    title: 'New Note: N205WH',
    preheader: 'AG posted a note on N205WH.',
    body: `
      ${heading('New Note')}
      ${paragraph(`<strong>AG</strong> posted a note on <strong>N205WH</strong>.`)}
      ${callout(
        `Fuel truck was 30 min late — might wanna pad before your next slot. Left tire still holding pressure fine after last top-off.<div style="margin-top:10px;font-size:12px;color:#091F3C;">2 photos attached</div>`,
        { variant: 'info' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

// --- 2. Squawk to mechanic --------------------------------

const squawkToMechanic: Variant = {
  slug: 'squawk-to-mechanic',
  label: 'Squawk reported (to mechanic)',
  description: 'Fired only when reporter checked "Notify MX?" — red accent for grounding squawks.',
  category: 'Squawk',
  subject: 'Service Request: N205WH Squawk',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary contact)',
  html: emailShell({
    title: 'Service Request: N205WH',
    preheader: 'New squawk on N205WH — aircraft is grounded.',
    body: `
      ${heading('Service Request')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`A new squawk was reported for <strong>N205WH</strong>. Let us know when you can accommodate this aircraft to address the issue.`)}
      ${callout(
        keyValueBlock([
          { label: 'Location', value: 'KSQL' },
          { label: 'Status', value: `<span style="color:#CE3732;font-weight:700;">AOG / GROUNDED</span>` },
          { label: 'Description', value: 'Engine oil streaking down left side of cowling. Appears to be coming from the quick-drain area. Caught on pre-flight, aircraft not flown.' },
        ]),
        { variant: 'danger', label: 'Squawk Details' },
      )}
      ${button(SQUAWK_URL, 'View Full Report')}
      ${SIGNATURE_MX}
    `,
  }),
};

// --- 3. Squawk internal alert -----------------------------

const squawkInternal: Variant = {
  slug: 'squawk-internal',
  label: 'Squawk reported (internal)',
  description: 'Hangar-wide heads-up to every other assigned pilot. Grounding squawks get the danger palette.',
  category: 'Squawk',
  subject: 'New Squawk: N205WH',
  from: 'Skyward Alerts <notifications@skywardsociety.com>',
  to: 'All assigned pilots (minus reporter)',
  html: emailShell({
    title: 'New Squawk: N205WH',
    preheader: 'AG reported a squawk on N205WH — aircraft is grounded.',
    body: `
      ${heading('New Squawk', 'danger')}
      ${paragraph(`A new squawk was reported on <strong>N205WH</strong> by <strong>AG</strong>.`)}
      ${callout(
        keyValueBlock([
          { label: 'Location', value: 'KSQL' },
          { label: 'Grounded', value: `<span style="color:#CE3732;font-weight:700;">Yes</span>` },
          { label: 'Description', value: 'Engine oil streaking down left side of cowling. Appears to be coming from the quick-drain area.' },
        ]),
        { variant: 'danger', label: 'Squawk Details' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

// --- 4. Manual MX schedule request ------------------------

const mxScheduleManual: Variant = {
  slug: 'mx-schedule-manual',
  label: 'Manual scheduling request',
  description: 'Fired when an admin taps "Notify MX" on a specific maintenance item.',
  category: 'Scheduling',
  subject: 'Scheduling Request: N205WH Maintenance',
  from: 'Skyward Maintenance <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary contact)',
  html: emailShell({
    title: 'Scheduling Request: N205WH',
    preheader: '100-Hour Inspection coming due at 1247.5 hours on N205WH.',
    body: `
      ${heading('Scheduling Request')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`The following maintenance item is coming due for <strong>N205WH</strong>. Let us know when you can fit this aircraft into your schedule.`)}
      ${callout(
        keyValueBlock([
          { label: 'Item', value: '100-Hour Inspection' },
          { label: 'Due', value: 'at 1247.5 hours' },
        ]),
        { variant: 'warning' },
      )}
      ${paragraph('Reply to this email to coordinate scheduling.')}
      ${SIGNATURE_MX}
    `,
  }),
};

// --- 5. Cron: work-package draft ready --------------------

const cronDraft: Variant = {
  slug: 'cron-workpackage-draft',
  label: 'Draft work package ready',
  description: 'Cron job created a draft — primary contact reviews + sends to the shop.',
  category: 'Scheduling',
  subject: 'Action Required: Review & Send Work Package for N205WH',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Work Package Ready — N205WH',
    preheader: '3 items coming due on N205WH. Draft work package ready for review.',
    body: `
      ${heading('Maintenance Coming Due', 'warning')}
      ${paragraph(`Hello Alex,`)}
      ${paragraph(`The following maintenance items are approaching for <strong>N205WH</strong>:`)}
      ${callout(
        bulletList([
          `<strong>100-Hour Inspection</strong> — <span style="color:#091F3C;">due at 1247.5 hours</span>`,
          `<strong>Annual Inspection</strong> — <span style="color:#091F3C;">due 2026-06-14</span>`,
          `<strong>Transponder Check (§91.413)</strong> — <span style="color:#091F3C;">due 2026-06-01</span>`,
        ]),
        { variant: 'warning' },
      )}
      ${paragraph(`We've prepared a <strong>draft work package</strong> for you. Open the app to:`)}
      ${bulletList([
        'Add any open squawks you&apos;d like addressed',
        'Request additional services (wash, fluid top-off, nav update, etc.)',
        'Propose a preferred service date',
        'Send the complete package to Dave',
      ])}
      ${button(APP_URL, 'Review & Send')}
    `,
  }),
};

// --- 6. Cron: low-confidence heads-up ---------------------

const cronHeadsUp: Variant = {
  slug: 'cron-heads-up',
  label: 'Predictive heads-up (low confidence)',
  description: 'Early warning when projections are shaky — no draft created, informational only.',
  category: 'Scheduling',
  subject: 'Heads Up: N205WH MX Approaching (Low Confidence)',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Heads Up — N205WH',
    preheader: '2 items may be coming due on N205WH. No action yet.',
    body: `
      ${heading('Predictive Maintenance Alert', 'note')}
      ${paragraph(`Hello Alex,`)}
      ${paragraph(`Based on recent flight activity, we estimate the following items for <strong>N205WH</strong> may be coming due:`)}
      ${bulletList([
        `<strong>100-Hour Inspection</strong> — projected ~42 days`,
        `<strong>Oil & Filter</strong> — projected ~38 days`,
      ])}
      ${paragraph(`However, flight logs have been irregular (System Confidence: <strong>47%</strong>), so these estimates may shift significantly.`)}
      ${paragraph(`No action is needed yet. We'll create a draft work package automatically when items get closer to their thresholds. You can also schedule service proactively from the Maintenance tab at any time.`)}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

// --- 7. Cron: internal reminder ---------------------------

const cronReminder: Variant = {
  slug: 'cron-reminder',
  label: 'Internal reminder (30/15/5 day)',
  description: 'Threshold-based nudge that fires even when automate_scheduling is off.',
  category: 'Scheduling',
  subject: 'Maintenance Alert: N205WH Due Soon',
  from: 'Skyward Alerts <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Maintenance Alert — N205WH',
    preheader: 'Annual Inspection: ~15 days remaining on N205WH.',
    body: `
      ${heading('Maintenance Alert', 'warning')}
      ${paragraph(`Required maintenance is coming due for <strong>N205WH</strong>.`)}
      ${callout(
        `<div style="margin-bottom:4px;"><strong>Item:</strong> Annual Inspection</div><div><strong>Status:</strong> Due in 15 days (2026-05-09)</div>`,
        { variant: 'warning' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

// --- 8. Cron: ready-for-pickup nudge ----------------------

const cronPickupNudge: Variant = {
  slug: 'cron-pickup-nudge',
  label: 'Ready-for-pickup nudge',
  description: 'Fires after 3 days when a service event is stuck in ready_for_pickup.',
  category: 'Scheduling',
  subject: 'Reminder: N205WH Awaiting Logbook Entry',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Awaiting Logbook Entry — N205WH',
    preheader: "N205WH has been ready for pickup for 3+ days. Logbook entry needed to close the event.",
    body: `
      ${heading('Service Event Still Open', 'warning')}
      ${paragraph(`Your mechanic marked <strong>N205WH</strong> as ready for pickup more than 3 days ago, but the service event hasn't been closed yet.`)}
      ${paragraph(`Until you enter the logbook data, maintenance tracking won't reset and the aircraft may remain blocked on the calendar. Open the app to complete the event when you get a moment.`)}
      ${button(APP_URL, 'Enter Logbook Data')}
    `,
  }),
};

// --- 9. Work package to mechanic --------------------------

const workpackageToMechanic: Variant = {
  slug: 'workpackage-to-mechanic',
  label: 'Work package → mechanic',
  description: 'The full bundled service request — MX items, squawks, add-ons, portal link.',
  category: 'Mechanic Portal',
  subject: 'Service Request: N205WH — Work Package',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary contact)',
  html: emailShell({
    title: 'Service Request — N205WH',
    preheader: 'Work package for N205WH: 5 items, requested 2026-05-15. Reply via portal link.',
    body: `
      ${heading('Service Request')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`We'd like to schedule service for <strong>N205WH</strong> (Cessna 182T). Below is the full work package.`)}
      ${callout(`<strong>Requested Service Date:</strong> 2026-05-15`, { variant: 'info' })}
      ${sectionHeading('Maintenance Items Due', 'warning')}
      ${bulletList([
        `<strong>100-Hour Inspection</strong>`,
        `<strong>Oil & Filter Change</strong> — includes oil sample for analysis`,
      ])}
      ${sectionHeading('Squawks / Discrepancies', 'danger')}
      ${bulletList([
        `<strong>Left tire low</strong> — keeps dropping pressure, please investigate`,
        `<strong>GPS nav database out of date</strong> — update to current cycle`,
      ])}
      ${sectionHeading('Additional Services Requested', 'note')}
      ${bulletList([
        `Exterior wash & wax`,
        `Pitot-static system inspection`,
      ])}
      ${button(PORTAL_URL, 'Open Service Portal')}
      ${SIGNATURE_MX}
    `,
  }),
};

// --- 10–13. Owner → Mechanic -----------------------------

const ownerConfirm: Variant = {
  slug: 'owner-confirm',
  label: 'Owner confirms date',
  description: "Owner accepted the mechanic's proposed date.",
  category: 'Owner → Mechanic',
  subject: 'Date Confirmed — 2026-05-15',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary)',
  html: emailShell({
    title: 'Date Confirmed',
    preheader: 'Alex confirmed 2026-05-15, 3 days.',
    body: `
      ${heading('Date Confirmed', 'success')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`Alex Gornakov has confirmed the proposed service date of <strong>2026-05-15</strong> (3 days).`)}
      ${callout(`Perfect, see you Tuesday. I'll drop it off around 0730.`, { variant: 'success' })}
      ${button(PORTAL_URL, 'View Service Portal', { variant: 'success' })}
    `,
  }),
};

const ownerCounter: Variant = {
  slug: 'owner-counter',
  label: 'Owner counters with new date',
  description: 'Owner proposed a different date than the mechanic offered.',
  category: 'Owner → Mechanic',
  subject: 'New Date Proposed — 2026-05-22',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary)',
  html: emailShell({
    title: 'Counter Proposal',
    preheader: 'Alex proposed 2026-05-22 instead.',
    body: `
      ${heading('Counter Proposal', 'warning')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`Alex Gornakov has proposed a different service date: <strong>2026-05-22</strong>.`)}
      ${callout(`Tuesday I'm teaching a checkride that morning — Thursday would work better if your shop has the slot.`, { variant: 'warning' })}
      ${button(PORTAL_URL, 'View Service Portal')}
    `,
  }),
};

const ownerMessage: Variant = {
  slug: 'owner-message',
  label: 'Owner → mechanic comment',
  description: 'Generic message from the owner to the mechanic on an active service event.',
  category: 'Owner → Mechanic',
  subject: 'Message from Alex Gornakov',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary)',
  html: emailShell({
    title: 'Message from Alex Gornakov',
    preheader: 'Alex sent you a message about the service event.',
    body: `
      ${heading('New Message', 'note')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`Alex Gornakov sent you a message:`)}
      ${callout(`Heads up — the left brake has been a little soft lately. Not a squawk yet, but might be worth eyeballing while you've got it in the shop.`, { variant: 'note' })}
      ${button(PORTAL_URL, 'View Service Portal')}
    `,
  }),
};

const ownerCancel: Variant = {
  slug: 'owner-cancel',
  label: 'Owner cancels service event',
  description: 'Owner walked away from a pending service event.',
  category: 'Owner → Mechanic',
  subject: 'Service Cancelled — Alex Gornakov',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Mechanic (+CC primary)',
  html: emailShell({
    title: 'Service Cancelled',
    preheader: 'Alex cancelled the pending service event.',
    body: `
      ${heading('Service Event Cancelled', 'danger')}
      ${paragraph(`Hello Dave,`)}
      ${paragraph(`Alex Gornakov has cancelled the pending service event.`)}
      ${callout(`Going to hold off — the squawk turned out to be a loose fitting and I handled it myself. Thanks for being ready.`, { variant: 'danger' })}
      ${paragraph(`Nothing more to do on your end. Sorry for the inconvenience.`)}
    `,
  }),
};

// --- 14–21. Mechanic → Owner ------------------------------

const mechPropose: Variant = {
  slug: 'mech-propose',
  label: 'Mechanic proposes date',
  description: 'Mechanic offered a date + duration from the portal.',
  category: 'Mechanic Portal',
  subject: 'Schedule Update: Dave Reynolds proposed 2026-05-15',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Schedule Proposal — 2026-05-15',
    preheader: 'Dave Reynolds proposed 2026-05-15, estimated 3 days. Confirm or counter via the app.',
    body: `
      ${heading('Schedule Proposal', 'warning')}
      ${paragraph(`Dave Reynolds has proposed <strong>2026-05-15</strong> for service on your aircraft.`)}
      ${paragraph(`Estimated duration: <strong>3 days</strong> (through 2026-05-17)`)}
      ${callout(`I can fit the 100-hour + the squawk work in that window. Tuesday morning drop-off works best for my schedule.`, { variant: 'warning' })}
      ${paragraph('Open the app to confirm or propose a different date.')}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechConfirm: Variant = {
  slug: 'mech-confirm',
  label: 'Mechanic confirms appointment',
  description: 'Mechanic accepted the owner-proposed date.',
  category: 'Mechanic Portal',
  subject: 'Confirmed: 2026-05-15 Service Appointment',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Appointment Confirmed',
    preheader: 'Dave Reynolds confirmed 2026-05-15, 3 days. Calendar conflicts auto-cancelled.',
    body: `
      ${heading('Appointment Confirmed', 'success')}
      ${paragraph(`Dave Reynolds has confirmed service for <strong>2026-05-15</strong>.`)}
      ${paragraph(`Estimated duration: <strong>3 days</strong> (through 2026-05-17)`)}
      ${callout(`Confirmed. Bring the logbooks and I'll get you rolling first thing Tuesday.`, { variant: 'success' })}
      ${button(APP_URL, 'Open Skyward', { variant: 'success' })}
    `,
  }),
};

const mechMessage: Variant = {
  slug: 'mech-message',
  label: 'Mechanic → owner comment',
  description: 'Generic mid-service update from mechanic.',
  category: 'Mechanic Portal',
  subject: 'Service Update from Dave Reynolds',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Service Update from Dave Reynolds',
    preheader: 'Dave Reynolds sent you a message about your aircraft.',
    body: `
      ${heading('Service Update', 'note')}
      ${paragraph(`Dave Reynolds sent a message:`)}
      ${callout(`Oil analysis came back clean — all metals within normal. No action needed on your end, just thought you'd want to know.`, { variant: 'note' })}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechProgress: Variant = {
  slug: 'mech-progress',
  label: 'Mechanic updates line-item status',
  description: 'Progress update with colored status badges per item.',
  category: 'Mechanic Portal',
  subject: 'Work Package Update — 3/5 items complete, 1 in progress',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Work Package Progress',
    preheader: '3/5 items complete, 1 in progress on your aircraft.',
    body: `
      ${heading('Work Package Progress')}
      ${paragraph(`Dave Reynolds updated the status of work items on your aircraft.`)}
      ${callout(`<strong style="font-size:16px;">3/5 items complete, 1 in progress</strong>`, { variant: 'info' })}
      ${bulletList([
        `100-Hour Inspection — <span style="color:#56B94A;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">COMPLETE</span>`,
        `Oil & Filter Change — <span style="color:#56B94A;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">COMPLETE</span>`,
        `Left Tire Pressure Check — <span style="color:#56B94A;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">COMPLETE</span>`,
        `GPS Nav Database Update — <span style="color:#3AB0FF;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">IN_PROGRESS</span>`,
        `Pitot-Static Inspection — <span style="color:#F08B46;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;">PENDING</span>`,
      ])}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechEstimate: Variant = {
  slug: 'mech-estimate',
  label: 'Mechanic updates completion estimate',
  description: 'Mechanic revised the estimated ready-date.',
  category: 'Mechanic Portal',
  subject: 'Estimated Completion: 2026-05-18',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Estimated Completion',
    preheader: 'Dave Reynolds estimates your aircraft ready by 2026-05-18.',
    body: `
      ${heading('Completion Estimate')}
      ${paragraph(`Dave Reynolds estimates your aircraft will be ready by <strong>2026-05-18</strong>.`)}
      ${callout(`Waiting on the nav database — shipment arriving Friday. Everything else is done.`, { variant: 'warning' })}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechSuggest: Variant = {
  slug: 'mech-suggest',
  label: 'Mechanic suggests additional work',
  description: 'Discovered work added to the package during service.',
  category: 'Mechanic Portal',
  subject: 'Additional Work Suggested: Alternator Brush Replacement',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Additional Work Found',
    preheader: 'Dave Reynolds found something else that needs attention on your aircraft.',
    body: `
      ${heading('Additional Work Found', 'warning')}
      ${paragraph(`Dave Reynolds has identified additional work needed on your aircraft:`)}
      ${callout(
        `<strong>Alternator Brush Replacement</strong><div style="margin-top:8px;color:#091F3C;">Brushes are down to ~30% — not critical yet but worth doing while the cowling is off. Adds ~1 hour + $85 parts.</div>`,
        { variant: 'warning' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechDecline: Variant = {
  slug: 'mech-decline',
  label: 'Mechanic declines service',
  description: "Mechanic can't accommodate the request.",
  category: 'Mechanic Portal',
  subject: 'Service Declined by Dave Reynolds',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Service Declined',
    preheader: "Dave Reynolds can't accommodate this service request.",
    body: `
      ${heading('Service Declined', 'danger')}
      ${paragraph(`Dave Reynolds can&apos;t accommodate this service request.`)}
      ${callout(`Booked solid through June. I can refer you to Carlos over at Palo Alto — he's got openings and does good work.`, { variant: 'danger' })}
      ${paragraph(`You might want to reach out to a different mechanic or reschedule.`)}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

const mechReady: Variant = {
  slug: 'mech-ready',
  label: 'Aircraft ready for pickup',
  description: 'All work complete — owner needs to enter logbook data to close.',
  category: 'Mechanic Portal',
  subject: 'Aircraft Ready for Pickup',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Aircraft Ready for Pickup',
    preheader: 'All work complete. Enter logbook data to close out the service event.',
    body: `
      ${heading('Aircraft Ready for Pickup', 'success')}
      ${paragraph(`Dave Reynolds has completed all work and your aircraft is ready.`)}
      ${callout(`All squared away. Logbook is stamped, oil is warm. You're good to fly whenever you get over here.`, { variant: 'success' })}
      ${paragraph(`Log in to enter the logbook data from your mechanic&apos;s sign-off. That closes out the service event and resets maintenance tracking.`)}
      ${button(APP_URL, 'Enter Logbook Data', { variant: 'success' })}
    `,
  }),
};

// --- 22. Mechanic uploaded files -------------------------

const mechFiles: Variant = {
  slug: 'mech-files',
  label: 'Mechanic uploaded files',
  description: 'Photos or docs attached to the service event.',
  category: 'Mechanic Portal',
  subject: 'Dave Reynolds uploaded files to your work package',
  from: 'Skyward Operations <notifications@skywardsociety.com>',
  to: 'Primary contact',
  html: emailShell({
    title: 'Files Uploaded',
    preheader: 'Dave Reynolds uploaded 3 files to your service event.',
    body: `
      ${heading('Files Uploaded', 'note')}
      ${paragraph(`Dave Reynolds has uploaded 3 files to your service event:`)}
      ${callout(`Here's the teardown photos of the oil filter element and the inspection sheet for the 100-hour.`, { variant: 'note' })}
      ${bulletList([
        '📷 oil-filter-element-teardown.jpg',
        '📷 left-tire-sidewall.jpg',
        '📎 100hr-inspection-signoff.pdf',
      ])}
      ${button(APP_URL, 'Open Skyward')}
    `,
  }),
};

// --- 23–26. Reservations ---------------------------------

const reservationSingle: Variant = {
  slug: 'reservation-single',
  label: 'New single-day reservation',
  description: 'Pilot booked one flight. Hangar-wide awareness ping.',
  category: 'Reservation',
  subject: 'N205WH Reserved: May 20',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'All assigned pilots (minus booker)',
  html: emailShell({
    title: 'N205WH Reserved',
    preheader: 'AG reserved N205WH — Tue May 20, 08:00 → 13:00 PDT.',
    body: `
      ${heading('New Reservation', 'note')}
      ${paragraph(`<strong>AG</strong> has reserved <strong>N205WH</strong>:`)}
      ${callout(
        keyValueBlock([
          { label: 'From', value: 'Tue May 20, 08:00 PDT' },
          { label: 'To', value: 'Tue May 20, 13:00 PDT' },
          { label: 'Purpose', value: 'Proficiency / IFR currency' },
          { label: 'Route', value: 'KSQL → KMRY → KSQL' },
        ]),
        { variant: 'note' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

const reservationRecurring: Variant = {
  slug: 'reservation-recurring',
  label: 'Recurring reservation series',
  description: 'Multiple bookings from a single submission (weekly or custom cadence).',
  category: 'Reservation',
  subject: 'N205WH Reserved: 6 recurring bookings',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'All assigned pilots (minus booker)',
  html: emailShell({
    title: 'N205WH Reserved — 6 bookings',
    preheader: 'AG booked N205WH on 6 dates.',
    body: `
      ${heading('Recurring Reservation', 'note')}
      ${paragraph(`<strong>AG</strong> has reserved <strong>N205WH</strong> for 6 dates:`)}
      ${paragraph(`<strong>Purpose:</strong> CFI lessons with student pilot`)}
      ${callout(
        bulletList([
          `Sat May 10 — 09:00 to 11:00`,
          `Sat May 17 — 09:00 to 11:00`,
          `Sat May 24 — 09:00 to 11:00`,
          `Sat May 31 — 09:00 to 11:00`,
          `Sat Jun 7 — 09:00 to 11:00`,
          `Sat Jun 14 — 09:00 to 11:00`,
        ]),
        { variant: 'note' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

const reservationUpdated: Variant = {
  slug: 'reservation-updated',
  label: 'Reservation times updated',
  description: "Pilot shifted an existing booking's times.",
  category: 'Reservation',
  subject: 'N205WH Reservation Updated: May 20',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'All assigned pilots (minus pilot)',
  html: emailShell({
    title: 'N205WH Reservation Updated',
    preheader: 'AG moved their N205WH reservation — Tue May 20, 10:00 → 15:00 PDT.',
    body: `
      ${heading('Reservation Updated', 'warning')}
      ${paragraph(`<strong>AG</strong> has updated their reservation for <strong>N205WH</strong>:`)}
      ${callout(
        keyValueBlock([
          { label: 'New From', value: 'Tue May 20, 10:00 PDT' },
          { label: 'New To', value: 'Tue May 20, 15:00 PDT' },
        ]),
        { variant: 'warning' },
      )}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

const reservationCancelled: Variant = {
  slug: 'reservation-cancelled',
  label: 'Reservation cancelled (by pilot)',
  description: 'Pilot-initiated cancellation. Hangar awareness ping.',
  category: 'Reservation',
  subject: 'N205WH Reservation Cancelled: May 20',
  from: 'Skyward Aircraft Manager <notifications@skywardsociety.com>',
  to: 'All assigned pilots (minus canceller)',
  html: emailShell({
    title: 'N205WH Reservation Cancelled',
    preheader: 'Reservation on N205WH for Tue May 20, 08:00 PDT has been cancelled.',
    body: `
      ${heading('Reservation Cancelled', 'danger')}
      ${paragraph(`A reservation for <strong>N205WH</strong> on <strong>Tue May 20, 08:00 PDT</strong> has been cancelled.`)}
      ${paragraph(`<span style="color:#525659;">Originally booked by: Alex Gornakov</span>`)}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

// --- 27. MX conflict auto-cancellation -------------------

const mxConflictCancel: Variant = {
  slug: 'mx-conflict-cancel',
  label: 'Reservation auto-cancelled for MX',
  description: 'Confirmed maintenance event displaced an affected pilot&apos;s booking.',
  category: 'Auto-Cancel',
  subject: 'Reservation Cancelled: N205WH — Maintenance Scheduled',
  from: 'Skyward Alerts <notifications@skywardsociety.com>',
  to: 'Each affected pilot',
  html: emailShell({
    title: 'Reservation Cancelled — N205WH',
    preheader: 'Your N205WH reservations have been cancelled: maintenance scheduled 2026-05-15 → 2026-05-17.',
    body: `
      ${heading('Reservation Cancelled', 'danger')}
      ${paragraph(`Your reservations for <strong>N205WH</strong> have been automatically cancelled due to scheduled maintenance.`)}
      ${callout(
        bulletList([
          `Thu May 15, 08:00 — 12:00 PDT (XC practice)`,
          `Fri May 16, 10:00 — 13:00 PDT`,
          `Sat May 17, 09:00 — 15:00 PDT (KSQL → KMRY → KSQL)`,
        ]),
        { variant: 'danger', label: 'Cancelled Reservations' },
      )}
      ${callout(
        `<strong>May 15, 2026 – May 17, 2026</strong><div style="margin-top:4px;color:#091F3C;font-size:13px;">Serviced by Dave Reynolds</div>`,
        { variant: 'warning', label: 'Maintenance Period' },
      )}
      ${paragraph(`Rebook your flight for after the maintenance period. Sorry for the inconvenience.`)}
      ${button(APP_URL, 'Open Skyward')}
    `,
    preferencesUrl: `${APP_URL}#settings`,
  }),
};

export const variants: Variant[] = [
  noteNew,
  squawkToMechanic,
  squawkInternal,
  mxScheduleManual,
  cronDraft,
  cronHeadsUp,
  cronReminder,
  cronPickupNudge,
  workpackageToMechanic,
  ownerConfirm,
  ownerCounter,
  ownerMessage,
  ownerCancel,
  mechPropose,
  mechConfirm,
  mechMessage,
  mechProgress,
  mechEstimate,
  mechSuggest,
  mechDecline,
  mechReady,
  mechFiles,
  reservationSingle,
  reservationRecurring,
  reservationUpdated,
  reservationCancelled,
  mxConflictCancel,
];

export function findVariant(slug: string): Variant | undefined {
  return variants.find(v => v.slug === slug);
}

/**
 * Dev-only env gate. Returns true if the preview surface should be
 * served. Available in development unconditionally; available in
 * production only when ENABLE_EMAIL_PREVIEW is set so a deploy
 * without the flag can't accidentally expose the surface.
 */
export function isPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_EMAIL_PREVIEW === 'true';
}
