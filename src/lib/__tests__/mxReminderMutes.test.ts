import { describe, it, expect, vi } from 'vitest';
import { loadMutedMxReminderEmails, isMxReminderMuted } from '../mxReminderMutes';

/**
 * mx_reminder mute lookup. The wrong-direction risk is asymmetric:
 *   - false positive (email IS in mute set when it shouldn't be) →
 *     user misses important reminder. Worse direction.
 *   - false negative (email NOT in mute set when it should be) →
 *     user gets one extra email until next cron tick. Mild.
 * Tests lean on locking the false-positive direction.
 */

/**
 * Build a fake supabaseAdmin client whose .from(table).select().in()
 * chain resolves to the seeded fixture per table. Mirrors the
 * minimum surface the helper actually uses.
 */
function makeFakeSupabase(fixtures: {
  user_roles?: Array<{ user_id: string; email: string }>;
  notification_preferences?: Array<{ user_id: string }>;
}) {
  const calls: Array<{ table: string; method: string; args: any[] }> = [];

  function makeChain(table: string) {
    const data =
      table === 'aft_user_roles'
        ? fixtures.user_roles ?? []
        : table === 'aft_notification_preferences'
          ? fixtures.notification_preferences ?? []
          : [];

    const chain: any = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      // Tail — the helper awaits the chain, which resolves to
      // { data, error }. We attach `.then` so `await chain` works.
      then: (onFulfilled: (val: any) => any) =>
        Promise.resolve({ data, error: null }).then(onFulfilled),
    };
    return chain;
  }

  return {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [] });
      return makeChain(table);
    },
    _calls: calls,
  };
}

describe('loadMutedMxReminderEmails', () => {
  it('empty input → empty mute set, no DB calls', async () => {
    const sb = makeFakeSupabase({});
    const muted = await loadMutedMxReminderEmails(sb, []);
    expect(muted.size).toBe(0);
    expect(sb._calls.length).toBe(0);
  });

  it('all falsy/whitespace input → empty mute set, no DB calls', async () => {
    const sb = makeFakeSupabase({});
    const muted = await loadMutedMxReminderEmails(sb, [null, undefined, '', '   ']);
    expect(muted.size).toBe(0);
    expect(sb._calls.length).toBe(0);
  });

  it('lowercases recipient list before lookup (case-insensitive match)', async () => {
    const sb = makeFakeSupabase({
      user_roles: [{ user_id: 'u1', email: 'a@example.com' }],
      notification_preferences: [{ user_id: 'u1' }],
    });
    const muted = await loadMutedMxReminderEmails(sb, ['A@Example.COM']);
    expect(muted.has('a@example.com')).toBe(true);
    expect(muted.size).toBe(1);
  });

  it('dedups identical-after-lowercase entries', async () => {
    const sb = makeFakeSupabase({
      user_roles: [{ user_id: 'u1', email: 'a@example.com' }],
      notification_preferences: [{ user_id: 'u1' }],
    });
    const muted = await loadMutedMxReminderEmails(sb, [
      'a@example.com',
      'A@EXAMPLE.COM',
      'a@example.com',
    ]);
    expect(muted.size).toBe(1);
  });

  it('non-Skyward recipient (no user row) → not in mute set', async () => {
    // External main_contact_email like an outside operations team.
    // They have no Skyward account, no settings UI, can't have muted
    // anything — must continue receiving the email.
    const sb = makeFakeSupabase({
      user_roles: [], // no match
      notification_preferences: [],
    });
    const muted = await loadMutedMxReminderEmails(sb, ['outsider@example.com']);
    expect(muted.size).toBe(0);
  });

  it('user exists but no enabled=false row → not muted (default = enabled)', async () => {
    const sb = makeFakeSupabase({
      user_roles: [{ user_id: 'u1', email: 'a@example.com' }],
      notification_preferences: [], // user is in user_roles but has not toggled off
    });
    const muted = await loadMutedMxReminderEmails(sb, ['a@example.com']);
    expect(muted.has('a@example.com')).toBe(false);
  });

  it('mixed: one muted, one not, one external', async () => {
    const sb = makeFakeSupabase({
      user_roles: [
        { user_id: 'u1', email: 'muted@x.com' },
        { user_id: 'u2', email: 'optedin@x.com' },
      ],
      notification_preferences: [{ user_id: 'u1' }], // only u1 muted
    });
    const muted = await loadMutedMxReminderEmails(sb, [
      'muted@x.com',
      'optedin@x.com',
      'outsider@x.com',
    ]);
    expect(muted.has('muted@x.com')).toBe(true);
    expect(muted.has('optedin@x.com')).toBe(false);
    expect(muted.has('outsider@x.com')).toBe(false);
    expect(muted.size).toBe(1);
  });

  it('returned set values are always lowercased', async () => {
    const sb = makeFakeSupabase({
      // aft_user_roles.email may not always be lowercased depending on
      // signup flow — the helper must normalize on the way out so
      // callers can do mute.has(email.toLowerCase()) without surprises.
      user_roles: [{ user_id: 'u1', email: 'Mixed@Case.com' }],
      notification_preferences: [{ user_id: 'u1' }],
    });
    const muted = await loadMutedMxReminderEmails(sb, ['mixed@case.com']);
    expect(muted.has('mixed@case.com')).toBe(true);
    expect(muted.has('Mixed@Case.com')).toBe(false);
  });
});

describe('isMxReminderMuted', () => {
  it('returns false for null/undefined/empty', () => {
    const muted = new Set(['a@x.com']);
    expect(isMxReminderMuted(null, muted)).toBe(false);
    expect(isMxReminderMuted(undefined, muted)).toBe(false);
    expect(isMxReminderMuted('', muted)).toBe(false);
    expect(isMxReminderMuted('   ', muted)).toBe(false);
  });

  it('case-insensitive match against the (lowercased) mute set', () => {
    const muted = new Set(['a@x.com']);
    expect(isMxReminderMuted('a@x.com', muted)).toBe(true);
    expect(isMxReminderMuted('A@X.COM', muted)).toBe(true);
    expect(isMxReminderMuted(' A@X.COM ', muted)).toBe(false); // not trimmed
  });

  it('returns false for a recipient not in the mute set', () => {
    const muted = new Set(['a@x.com']);
    expect(isMxReminderMuted('b@x.com', muted)).toBe(false);
  });
});
