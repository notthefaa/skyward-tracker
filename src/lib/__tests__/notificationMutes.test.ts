import { describe, it, expect, vi } from 'vitest';
import { loadMutedRecipients, isRecipientMuted } from '../notificationMutes';
import type { NotificationType } from '../types';

/**
 * Generic notification-pref mute lookup. Replaces the
 * mx_reminder-specific helper with a parameterized version so the
 * same surface gates `mx_reminder` (cron mx-reminders Phases 2/3/4)
 * and `service_update` (cron Phase 5 + mx-events/respond +
 * mx-events/upload-attachment).
 *
 * Wrong-direction risk asymmetry:
 *   - false positive (email muted when it shouldn't be) → user misses
 *     a notification. Worse direction; the test grid leans on
 *     locking that direction across edge cases.
 *   - false negative (one extra email until next opt-out propagates)
 *     → mild.
 */

/**
 * Build a fake supabaseAdmin client whose .from(table).select().in()
 * chain resolves to seeded fixtures per table. Mirrors only the
 * surface the helper actually uses.
 */
function makeFakeSupabase(fixtures: {
  user_roles?: Array<{ user_id: string; email: string }>;
  notification_preferences?: Array<{ user_id: string }>;
}) {
  const calls: Array<{ table: string }> = [];

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
      then: (onFulfilled: (val: any) => any) =>
        Promise.resolve({ data, error: null }).then(onFulfilled),
    };
    return chain;
  }

  return {
    from: (table: string) => {
      calls.push({ table });
      return makeChain(table);
    },
    _calls: calls,
  };
}

describe('loadMutedRecipients', () => {
  const TYPES: NotificationType[] = ['mx_reminder', 'service_update'];

  for (const type of TYPES) {
    describe(`type=${type}`, () => {
      it('empty input → empty mute set, no DB calls', async () => {
        const sb = makeFakeSupabase({});
        const muted = await loadMutedRecipients(sb, [], type);
        expect(muted.size).toBe(0);
        expect(sb._calls.length).toBe(0);
      });

      it('all falsy/whitespace input → empty mute set, no DB calls', async () => {
        const sb = makeFakeSupabase({});
        const muted = await loadMutedRecipients(sb, [null, undefined, '', '   '], type);
        expect(muted.size).toBe(0);
        expect(sb._calls.length).toBe(0);
      });

      it('lowercases recipient list before lookup', async () => {
        const sb = makeFakeSupabase({
          user_roles: [{ user_id: 'u1', email: 'a@example.com' }],
          notification_preferences: [{ user_id: 'u1' }],
        });
        const muted = await loadMutedRecipients(sb, ['A@Example.COM'], type);
        expect(muted.has('a@example.com')).toBe(true);
        expect(muted.size).toBe(1);
      });

      it('non-Skyward recipient → not in mute set (no Settings UI to opt out from)', async () => {
        const sb = makeFakeSupabase({ user_roles: [], notification_preferences: [] });
        const muted = await loadMutedRecipients(sb, ['outsider@example.com'], type);
        expect(muted.size).toBe(0);
      });

      it('user exists but no enabled=false row → not muted (default = enabled)', async () => {
        const sb = makeFakeSupabase({
          user_roles: [{ user_id: 'u1', email: 'a@example.com' }],
          notification_preferences: [],
        });
        const muted = await loadMutedRecipients(sb, ['a@example.com'], type);
        expect(muted.has('a@example.com')).toBe(false);
      });

      it('mixed: one muted, one not, one external', async () => {
        const sb = makeFakeSupabase({
          user_roles: [
            { user_id: 'u1', email: 'muted@x.com' },
            { user_id: 'u2', email: 'optedin@x.com' },
          ],
          notification_preferences: [{ user_id: 'u1' }],
        });
        const muted = await loadMutedRecipients(
          sb,
          ['muted@x.com', 'optedin@x.com', 'outsider@x.com'],
          type,
        );
        expect(muted.has('muted@x.com')).toBe(true);
        expect(muted.has('optedin@x.com')).toBe(false);
        expect(muted.has('outsider@x.com')).toBe(false);
      });

      it('returned set values are always lowercased', async () => {
        const sb = makeFakeSupabase({
          user_roles: [{ user_id: 'u1', email: 'Mixed@Case.com' }],
          notification_preferences: [{ user_id: 'u1' }],
        });
        const muted = await loadMutedRecipients(sb, ['mixed@case.com'], type);
        expect(muted.has('mixed@case.com')).toBe(true);
        expect(muted.has('Mixed@Case.com')).toBe(false);
      });
    });
  }
});

describe('isRecipientMuted', () => {
  it('returns false for null/undefined/empty', () => {
    const muted = new Set(['a@x.com']);
    expect(isRecipientMuted(null, muted)).toBe(false);
    expect(isRecipientMuted(undefined, muted)).toBe(false);
    expect(isRecipientMuted('', muted)).toBe(false);
    expect(isRecipientMuted('   ', muted)).toBe(false);
  });

  it('case-insensitive match against the lowercased mute set', () => {
    const muted = new Set(['a@x.com']);
    expect(isRecipientMuted('a@x.com', muted)).toBe(true);
    expect(isRecipientMuted('A@X.COM', muted)).toBe(true);
    expect(isRecipientMuted(' A@X.COM ', muted)).toBe(false); // not trimmed
  });

  it('returns false for a recipient not in the mute set', () => {
    const muted = new Set(['a@x.com']);
    expect(isRecipientMuted('b@x.com', muted)).toBe(false);
  });
});
