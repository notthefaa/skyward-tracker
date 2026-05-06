import { describe, it, expect } from 'vitest';
import { stripProtectedFields } from '../validation';

const baseProtected = {
  id: 'aaa', aircraft_id: 'bbb',
  reported_by: 'u1', author_id: 'u2', created_by: 'u3',
  deleted_at: 'x', deleted_by: 'u4',
  created_at: 'x', updated_at: 'x',
};

describe('stripProtectedFields — base set', () => {
  it('always drops the universal-protected fields regardless of table', () => {
    const out = stripProtectedFields({ ...baseProtected, location: 'left tire' });
    expect(out).toEqual({ location: 'left tire' });
  });

  it('returns an empty object on a non-object input', () => {
    expect(stripProtectedFields(null)).toEqual({});
    expect(stripProtectedFields(undefined)).toEqual({});
    expect(stripProtectedFields('hi')).toEqual({});
  });

  it('keeps unknown fields when no table key is supplied', () => {
    const out = stripProtectedFields({ status: 'resolved', anything: 1 });
    // Without a table key, status passes through (legacy behavior)
    expect(out).toEqual({ status: 'resolved', anything: 1 });
  });
});

describe('stripProtectedFields — squawks table', () => {
  it('blocks event linkage / token / notify-failed forgery', () => {
    const payload = {
      // base set
      id: 'x', aircraft_id: 'y', reported_by: 'u', deleted_at: 'd', created_at: 'c', updated_at: 'u',
      // squawks-specific (server-managed)
      resolved_by_event_id: 'event-id',
      access_token: 'leak',
      mx_notify_failed: false,
      // pass-through (legitimate user fields)
      status: 'resolved',
      location: 'left tire',
      description: 'flat',
    };
    const out = stripProtectedFields(payload, 'squawks');
    // status is the user-facing state the resolve / reopen UX writes
    // — it must pass through. Auth gates (author OR aircraft admin)
    // enforce who can change it.
    expect(out).toEqual({ status: 'resolved', location: 'left tire', description: 'flat' });
  });
});

describe('stripProtectedFields — equipment table', () => {
  it('lets removed_at pass through (the "Mark Removed" PUT writes it)', () => {
    // The equipment strip set is intentionally empty — only the
    // BASE_PROTECTED set applies (deleted_at, deleted_by, etc.).
    // Resurrect protection (no-null-when-existing-non-null) lives in
    // the equipment PUT route handler itself, since stripping
    // unconditionally broke the legitimate "Mark Removed" path.
    const out = stripProtectedFields({
      removed_at: '2026-05-06',
      name: 'Garmin GTX-345',
      category: 'transponder',
      // BASE_PROTECTED still strips deleted_at across all tables.
      deleted_at: '2024-01-01',
    }, 'equipment');
    expect(out).toEqual({
      removed_at: '2026-05-06',
      name: 'Garmin GTX-345',
      category: 'transponder',
    });
  });
});

describe('stripProtectedFields — ads table', () => {
  it('blocks every DRS-managed field so a manual PUT can\'t spoof sync state', () => {
    const out = stripProtectedFields({
      source: 'drs_sync',
      is_superseded: true,
      superseded_by: 'fake-id',
      synced_at: '2026-01-01',
      sync_hash: 'abc',
      applicability_status: 'applies',
      applicability_reason: 'forged',
      applicability_checked_at: '2026-01-01',
      // legitimate compliance update
      last_complied_date: '2026-04-01',
      last_complied_time: 1500,
    }, 'ads');
    expect(out).toEqual({
      last_complied_date: '2026-04-01',
      last_complied_time: 1500,
    });
  });
});
