// =============================================================
// mx_reminder mute lookup
//
// `aft_notification_preferences` has a `mx_reminder` row per primary
// contact who has explicitly toggled OFF the reminder. The cron
// (api/cron/mx-reminders) emails `aircraft.main_contact_email` across
// four phases — all four are user-facing "Maintenance Reminders" per
// the Settings UI label, so all four should honor the toggle.
//
// `aircraft.main_contact_email` is free-text; the recipient may or may
// not be a Skyward user. We resolve via `aft_user_roles.email`
// (denormalized at signup; canonical-enough for a best-effort gate)
// and skip emails that have an `enabled=false` row for the user_id.
//
// External recipients (no matching user row) get the email regardless
// — they have no Settings UI to toggle, so muting wasn't possible.
// =============================================================

/**
 * Returns the lowercased subset of `emails` that have explicitly muted
 * `mx_reminder` notifications. Pure-shape return so callers can do a
 * cheap `mutedEmails.has(aircraft.main_contact_email.toLowerCase())`
 * gate before composing the email body.
 */
export async function loadMutedMxReminderEmails(
  supabaseAdmin: any,
  emails: Array<string | null | undefined>,
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

  // Look up matching user rows. Throw on read error so a transient
  // supabase blip doesn't silently send muted emails — better to fail
  // the cron tick and retry than to violate a user's pref.
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
    .eq('notification_type', 'mx_reminder')
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
 * Convenience: tests if a given email is muted, lowercase-tolerant.
 */
export function isMxReminderMuted(
  email: string | null | undefined,
  muted: Set<string>,
): boolean {
  if (typeof email !== 'string' || email.trim().length === 0) return false;
  return muted.has(email.toLowerCase());
}
