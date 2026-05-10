import { PORTAL_EXPIRY_DAYS } from './constants';

/**
 * Mechanic portal links are tied to a `aft_maintenance_events.access_token`.
 * The token itself never changes for a live event, but its scope shifts
 * with the event's lifecycle:
 *
 *   - active (any status except complete/cancelled): full access
 *   - cancelled: token is rotated server-side on cancel, so old links
 *     become dead refs (the access_token lookup can't match). No
 *     additional check needed in callers — but explicit cancellation
 *     guards in routes also short-circuit before doing work.
 *   - complete: stays signable + responsive for `PORTAL_EXPIRY_DAYS`
 *     after `completed_at`, then expires. Mechanic still sees the
 *     final email + can pull attachments for that window in case they
 *     missed something during the visit.
 *
 * This helper centralizes the "complete + past expiry window" check
 * so the rule lives in one place. Used by:
 *   - /api/mx-events/respond (mechanic actions on the event)
 *   - /api/mx-events/upload-attachment (file upload to the event)
 *   - /api/storage/sign (signed-URL handout for portal renderers)
 *
 * The cancelled-status check stays inline at each callsite — the
 * surface message and HTTP code differ (403 "no longer active" vs.
 * 400 "cannot upload to a cancelled event") and the `cancel` action
 * already rotates the token to dead-end any stale link.
 */
export function isPortalLinkExpired(event: {
  status?: string | null;
  completed_at?: string | null;
}): boolean {
  if (event.status !== 'complete' || !event.completed_at) return false;
  const completedMs = new Date(event.completed_at).getTime();
  const expiryMs = completedMs + PORTAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() > expiryMs;
}
