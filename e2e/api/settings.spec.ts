import { test, expect } from '../fixtures/seeded-user';
import { test as crossTest } from '../fixtures/two-users';
import { adminClient } from '../helpers/admin';
import { createClient } from '@supabase/supabase-js';

/**
 * Settings — FAA ratings + notification preferences live entirely
 * client-side via supabase-js with RLS. No API route to call. The
 * tests open a non-service-role supabase client signed in as the
 * user, exercise the same writes the SettingsModal does, and verify
 * the row + that cross-user writes are silently rejected by RLS.
 *
 * What's locked in here:
 *   - User can update their own faa_ratings.
 *   - User can upsert their own notification_preferences rows.
 *   - User CANNOT update someone else's faa_ratings (RLS rejects).
 *   - User CANNOT insert prefs as another user (RLS rejects).
 */

function authedClient(): ReturnType<typeof createClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL / ANON_KEY must be set');
  return createClient(url, anon, { auth: { persistSession: false } });
}

test.describe('settings — FAA ratings', () => {
  test('user updates their own faa_ratings (powers Howard tone)', async ({ seededUser }) => {
    const client = authedClient();
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: seededUser.email,
      password: seededUser.password,
    });
    expect(signInErr).toBeNull();

    const newRatings = ['PPL', 'IFR', 'CPL'];
    const { error } = await client
      .from('aft_user_roles')
      .update({ faa_ratings: newRatings })
      .eq('user_id', seededUser.userId);
    expect(error).toBeNull();

    const admin = adminClient();
    const { data: row } = await admin
      .from('aft_user_roles')
      .select('faa_ratings')
      .eq('user_id', seededUser.userId)
      .single();
    expect(row?.faa_ratings).toEqual(newRatings);
  });
});

test.describe('settings — notification preferences', () => {
  test('user upserts their own notification preferences', async ({ seededUser }) => {
    const client = authedClient();
    await client.auth.signInWithPassword({ email: seededUser.email, password: seededUser.password });

    // Mirror the SettingsModal upsert shape: one row per
    // (user_id, notification_type).
    const rows = [
      { user_id: seededUser.userId, notification_type: 'note_posted', enabled: false },
      { user_id: seededUser.userId, notification_type: 'squawk_reported', enabled: true },
      { user_id: seededUser.userId, notification_type: 'mx_due', enabled: true },
    ];
    const { error } = await client
      .from('aft_notification_preferences')
      .upsert(rows, { onConflict: 'user_id,notification_type' });
    expect(error).toBeNull();

    const admin = adminClient();
    const { data } = await admin
      .from('aft_notification_preferences')
      .select('notification_type, enabled')
      .eq('user_id', seededUser.userId);
    expect(data?.length).toBe(3);
    const map = Object.fromEntries((data || []).map(r => [r.notification_type, r.enabled]));
    expect(map.note_posted).toBe(false);
    expect(map.squawk_reported).toBe(true);
    expect(map.mx_due).toBe(true);

    // Toggling one updates without dup'ing.
    const { error: e2 } = await client
      .from('aft_notification_preferences')
      .upsert([{ user_id: seededUser.userId, notification_type: 'note_posted', enabled: true }], {
        onConflict: 'user_id,notification_type',
      });
    expect(e2).toBeNull();
    const { data: after } = await admin
      .from('aft_notification_preferences')
      .select('enabled')
      .eq('user_id', seededUser.userId)
      .eq('notification_type', 'note_posted')
      .single();
    expect(after?.enabled).toBe(true);
  });
});

crossTest.describe('settings — cross-user RLS', () => {
  crossTest('user A cannot update user B faa_ratings', async ({ userA, userB }) => {
    const client = authedClient();
    await client.auth.signInWithPassword({ email: userA.email, password: userA.password });

    // Snapshot B's ratings via service role.
    const admin = adminClient();
    const { data: before } = await admin
      .from('aft_user_roles')
      .select('faa_ratings')
      .eq('user_id', userB.userId)
      .single();

    // Attempt the cross-user update via authed client. RLS hides B's
    // row from A's UPDATE: no error, no rows affected.
    const { error } = await client
      .from('aft_user_roles')
      .update({ faa_ratings: ['ATP', 'CFII'] })
      .eq('user_id', userB.userId);
    expect(error).toBeNull(); // RLS makes it a silent no-op, not an error.

    const { data: after } = await admin
      .from('aft_user_roles')
      .select('faa_ratings')
      .eq('user_id', userB.userId)
      .single();
    // B's ratings unchanged.
    expect(after?.faa_ratings).toEqual(before?.faa_ratings);
  });

  crossTest('user A cannot insert notification prefs as user B', async ({ userA, userB }) => {
    const client = authedClient();
    await client.auth.signInWithPassword({ email: userA.email, password: userA.password });

    // RLS WITH CHECK clause uses (user_id = auth.uid()), so an INSERT
    // with someone else's user_id MUST error.
    const { error } = await client
      .from('aft_notification_preferences')
      .insert({ user_id: userB.userId, notification_type: 'note_posted', enabled: false });
    expect(error).not.toBeNull();

    const admin = adminClient();
    const { data } = await admin
      .from('aft_notification_preferences')
      .select('user_id')
      .eq('user_id', userB.userId);
    // No row should have been created on B's behalf.
    expect((data || []).length).toBe(0);
  });
});
