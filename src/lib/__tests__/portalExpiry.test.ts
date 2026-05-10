import { describe, it, expect } from 'vitest';
import { isPortalLinkExpired } from '../portalExpiry';
import { PORTAL_EXPIRY_DAYS } from '../constants';

/**
 * Mechanic portal expiry rule. The helper is shared by three callers
 * (mx-events/respond, mx-events/upload-attachment, storage/sign), so
 * a wrong-direction tweak here would silently re-open every signed
 * link past the 7-day window.
 */
describe('isPortalLinkExpired', () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  it('non-complete events are never "expired" by this rule', () => {
    // Cancellation is handled separately at each callsite (the route
    // surfaces "no longer active" before reaching this helper).
    expect(isPortalLinkExpired({ status: 'draft', completed_at: null })).toBe(false);
    expect(isPortalLinkExpired({ status: 'confirmed', completed_at: null })).toBe(false);
    expect(isPortalLinkExpired({ status: 'ready_for_pickup', completed_at: null })).toBe(false);
    expect(isPortalLinkExpired({ status: 'cancelled', completed_at: null })).toBe(false);
  });

  it('complete with no completed_at is treated as still-active (defensive)', () => {
    // Legacy events from before completed_at was set may have status
    // = complete but no timestamp. Don't expire them prematurely;
    // the route still gates uploads via the explicit cancelled/complete
    // status branch.
    expect(isPortalLinkExpired({ status: 'complete', completed_at: null })).toBe(false);
  });

  it('complete + within window: not expired', () => {
    // 1 day after completion, well inside the 7-day grace window.
    const completedAt = new Date(Date.now() - 1 * ONE_DAY_MS).toISOString();
    expect(isPortalLinkExpired({ status: 'complete', completed_at: completedAt })).toBe(false);
  });

  it('complete + at the boundary: still active (strict-greater check)', () => {
    // Exactly PORTAL_EXPIRY_DAYS days old — Date.now() is fractionally
    // past completedAt + 7d due to wall-clock progression between the
    // two getTime() calls, but the helper uses `>` not `>=`. We pad
    // by 100ms to make this deterministic.
    const completedAt = new Date(Date.now() - PORTAL_EXPIRY_DAYS * ONE_DAY_MS + 100).toISOString();
    expect(isPortalLinkExpired({ status: 'complete', completed_at: completedAt })).toBe(false);
  });

  it('complete + past the window: expired', () => {
    const completedAt = new Date(Date.now() - (PORTAL_EXPIRY_DAYS + 1) * ONE_DAY_MS).toISOString();
    expect(isPortalLinkExpired({ status: 'complete', completed_at: completedAt })).toBe(true);
  });

  it('handles missing/undefined fields without throwing', () => {
    // Defensive — the route's SELECT could miss the field on a stale
    // schema-cache or partial column projection. Default to "not
    // expired" so we don't 403 active links.
    expect(isPortalLinkExpired({})).toBe(false);
    expect(isPortalLinkExpired({ status: undefined, completed_at: undefined })).toBe(false);
  });
});
