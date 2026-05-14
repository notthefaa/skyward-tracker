// Shared cron/email constants so the dev preview surface can't drift
// from the production cron job. The cron route in
// src/app/api/cron/mx-reminders/route.ts and the email-preview fixtures
// at src/app/dev/email-preview/fixtures.ts both reference these — a
// drift here would silently misrepresent what the pilot will actually
// receive.

// How many days a service event sits in ready_for_pickup before the
// cron nudges the primary contact. Re-nudges at the same cadence until
// the owner closes the event.
export const READY_PICKUP_NUDGE_DAYS = 3;
