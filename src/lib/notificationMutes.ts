// =============================================================
// Generic notification-pref mute lookup
//
// `aft_notification_preferences` stores per-user toggles for each
// `NotificationType`. Routes that send categorical emails check this
// table to honor user opt-outs.
//
// Two callers today:
//   - mx_reminder: cron mx-reminders Phases 2/3/4
//   - service_update: cron Phase 5 ready_for_pickup nudge,
//     mx-events/respond mechanic→owner messages, mx-events/upload-
//     attachment files-uploaded notification
//
// Recipients are addressed by email (free-text on aircraft + event
// rows), not user_id, so we resolve via aft_user_roles.email →
// user_id → preference row. External recipients (no matching user
// row) get the email regardless — no Settings UI to opt out from.
// =============================================================

import type { NotificationType } from './types';

/**
 * Returns the lowercased subset of `emails` that have explicitly muted
 * the given `type`. Pure-shape return so callers can do a cheap
 * `mutedEmails.has(recipient.toLowerCase())` gate.
 */
export async function loadMutedRecipients(
  supabaseAdmin: any,
  emails: Array<string | null | undefined>,
  type: NotificationType,
): Promise<Set<string>> {
  // Dedup + lowercase + drop falsy.
  const lower = Array.from(
    new Set(
      emails
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.toLowerCase()),
    ),
  );
  if (lower.length === 0) return new Set();

  // Throw on read error so a transient supabase blip doesn't silently
  // send muted emails — better to fail the route and retry than to
  // violate a user's pref.
  const { data: users, error: usersErr } = await supabaseAdmin
    .from('aft_user_roles')
    .select('user_id, email')
    .in('email', lower);
  if (usersErr) throw usersErr;
  if (!users || users.length === 0) return new Set();

  const userIdToEmail = new Map<string, string>();
  for (const u of users) {
    if (u?.user_id && typeof u.email === 'string') {
      userIdToEmail.set(u.user_id, u.email.toLowerCase());
    }
  }
  const userIds = Array.from(userIdToEmail.keys());
  if (userIds.length === 0) return new Set();

  const { data: prefs, error: prefsErr } = await supabaseAdmin
    .from('aft_notification_preferences')
    .select('user_id')
    .in('user_id', userIds)
    .eq('notification_type', type)
    .eq('enabled', false);
  if (prefsErr) throw prefsErr;

  const muted = new Set<string>();
  for (const row of prefs || []) {
    const email = userIdToEmail.get(row.user_id);
    if (email) muted.add(email);
  }
  return muted;
}

/**
 * Convenience: tests if a given email is in a mute set, lowercase-
 * tolerant. Pure helper — no DB calls.
 */
export function isRecipientMuted(
  email: string | null | undefined,
  muted: Set<string>,
): boolean {
  if (typeof email !== 'string' || email.trim().length === 0) return false;
  return muted.has(email.toLowerCase());
}
