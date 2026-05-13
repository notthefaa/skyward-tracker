import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

// Trace the REAL invited-user flow end-to-end to see if
// completed_onboarding gets lost somewhere between /api/pilot-invite
// (which sets it true) and the eventual app render. The previous
// invitee-skips-onboarding test seeded state directly with admin
// client + signed in; it skipped the /update-password page where
// the invitee's own session writes to aft_user_roles. If that write
// is clobbering the onboarding flag, this test catches it.

test.describe('full invite flow — completed_onboarding survives', () => {
  test('invitee with aircraft lands in main app (not HowardWelcome)', async ({ page }) => {
    test.setTimeout(90_000);
    const admin = adminClient();

    // 1. Inviter — needs an aircraft to invite the pilot to.
    const inviterEmail = `e2e-fullinv-inviter-${randomUUID()}@skyward-test.local`;
    const { data: inviterU } = await admin.auth.admin.createUser({
      email: inviterEmail, password: 'whatever', email_confirm: true,
    });
    const inviterId = inviterU!.user!.id;
    const { data: ac } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: inviterId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    const aircraftId = (ac as { id: string }).id;

    // 2. Simulate /api/pilot-invite for a fresh user — exactly what
    //    the route does internally when the email isn't on file yet.
    //    inviteUserByEmail creates auth.users + returns the user id.
    //    The route then upserts aft_user_roles WITH
    //    completed_onboarding=true.
    // Supabase Auth rejects .local TLDs for inviteUserByEmail; use
    // createUser instead with a temporary password — the state /api/
    // pilot-invite produces is the same: an auth row, an
    // aft_user_roles row with completed_onboarding=true, an
    // aft_user_aircraft_access row.
    const inviteeEmail = `e2e-fullinv-invitee-${randomUUID()}@skyward-test.local`;
    const tempPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: invitee, error: inviteErr } = await admin.auth.admin.createUser({
      email: inviteeEmail, password: tempPw, email_confirm: true,
    });
    if (inviteErr) throw new Error(`createUser: ${inviteErr.message}`);
    const inviteeId = invitee.user!.id;

    await admin.from('aft_user_roles').upsert({
      user_id: inviteeId,
      role: 'pilot',
      email: inviteeEmail.toLowerCase(),
      completed_onboarding: true,
    });
    await admin.from('aft_user_aircraft_access').upsert({
      user_id: inviteeId,
      aircraft_id: aircraftId,
      aircraft_role: 'pilot',
    }, { onConflict: 'user_id,aircraft_id' });

    // 3. Verify the row landed correctly BEFORE the invitee touches it.
    const { data: roleAfterInvite } = await admin
      .from('aft_user_roles')
      .select('completed_onboarding, initials, full_name')
      .eq('user_id', inviteeId)
      .single();
    console.log('AFTER /api/pilot-invite simulation:', roleAfterInvite);
    expect(roleAfterInvite?.completed_onboarding).toBe(true);

    // 4. Simulate /update-password — set a password via admin (since
    //    we can't programmatically click the email link), then
    //    impersonate the user to UPDATE initials + email + full_name
    //    EXACTLY like the page does.
    const inviteePw = tempPw;
    // (Password already set above via createUser; in real flow the user
    // sets it via /update-password's `supabase.auth.updateUser({ password })`,
    // which doesn't touch aft_user_roles.)

    // Now do the user-session UPDATE — same code path the page hits.
    // Use a user-scoped client (anon key) signed in as the invitee.
    const { createClient } = await import('@supabase/supabase-js');
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await userClient.auth.signInWithPassword({ email: inviteeEmail, password: inviteePw });

    const { error: updateErr } = await userClient.from('aft_user_roles').update({
      initials: 'TST',
      email: inviteeEmail.toLowerCase(),
      full_name: 'Test Invitee',
    }).eq('user_id', inviteeId);
    console.log('User-session UPDATE error:', updateErr);

    // 5. Read the row AFTER the /update-password simulation.
    const { data: roleAfterUpdate } = await admin
      .from('aft_user_roles')
      .select('completed_onboarding, initials, full_name')
      .eq('user_id', inviteeId)
      .single();
    console.log('AFTER /update-password simulation:', roleAfterUpdate);

    // 6. Sign in via the UI and assert no welcome modal.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(inviteeEmail);
    await page.locator('input[type="password"]').fill(inviteePw);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const welcomeHeading = page.getByRole('heading', { name: /meet howard/i });

    // Wait up to 20s for either to appear, then assert main nav (good)
    // not welcome (bad).
    await expect(mainNav.or(welcomeHeading)).toBeVisible({ timeout: 20_000 });
    await expect(welcomeHeading).toHaveCount(0);
    await expect(mainNav).toBeVisible();

    // Cleanup
    try { await admin.from('aft_aircraft').delete().eq('id', aircraftId); } catch {}
    try { await admin.auth.admin.deleteUser(inviteeId); } catch {}
    try { await admin.auth.admin.deleteUser(inviterId); } catch {}

    // Final assertion: completed_onboarding should be true throughout.
    expect(roleAfterUpdate?.completed_onboarding).toBe(true);
  });

  // Regression for the production bug 2026-05-13: a user invited via
  // /api/invite (AdminModals) with NO aircraftIds gets
  // completed_onboarding=false. Later getting added to an aircraft
  // via /api/pilot-invite (SummaryTab existing-user path) used to
  // leave the flag at false — the user stayed stuck in HowardWelcome
  // forever even though they had fleet access.
  test('two-step invite flow flips completed_onboarding when aircraft access lands', async ({ request }) => {
    test.setTimeout(60_000);
    const admin = adminClient();

    // 1. Inviter admin + aircraft.
    const inviterEmail = `e2e-twostep-inviter-${randomUUID()}@skyward-test.local`;
    const inviterPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: inviterU } = await admin.auth.admin.createUser({
      email: inviterEmail, password: inviterPw, email_confirm: true,
    });
    const inviterId = inviterU!.user!.id;
    await admin.from('aft_user_roles').upsert({
      user_id: inviterId,
      role: 'admin',
      email: inviterEmail,
      completed_onboarding: true,
    });
    const { data: ac } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: inviterId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    const aircraftId = (ac as { id: string }).id;

    // 2. Seed the bad state: an invitee row with completed_onboarding
    //    =false (what /api/invite leaves for a no-aircraft invite).
    const inviteeEmail = `e2e-twostep-invitee-${randomUUID()}@skyward-test.local`;
    const { data: inviteeU } = await admin.auth.admin.createUser({
      email: inviteeEmail, password: 'whatever', email_confirm: true,
    });
    const inviteeId = inviteeU!.user!.id;
    await admin.from('aft_user_roles').upsert({
      user_id: inviteeId,
      role: 'pilot',
      email: inviteeEmail.toLowerCase(),
      completed_onboarding: false,
    });

    // 3. Sign in as the inviter and call /api/pilot-invite the way
    //    SummaryTab does. Need the inviter's bearer token for authFetch.
    const { createClient } = await import('@supabase/supabase-js');
    const inviterClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: signIn } = await inviterClient.auth.signInWithPassword({
      email: inviterEmail, password: inviterPw,
    });
    const inviterToken = signIn?.session?.access_token;
    if (!inviterToken) throw new Error('Failed to obtain inviter token');

    const inviteRes = await request.post('/api/pilot-invite', {
      headers: { Authorization: `Bearer ${inviterToken}`, 'Content-Type': 'application/json' },
      data: { email: inviteeEmail, aircraftId, aircraftRole: 'pilot' },
    });
    expect(inviteRes.ok()).toBe(true);

    // 4. Verify completed_onboarding flipped to true.
    const { data: roleAfter } = await admin
      .from('aft_user_roles')
      .select('completed_onboarding')
      .eq('user_id', inviteeId)
      .single();

    try { await admin.from('aft_aircraft').delete().eq('id', aircraftId); } catch {}
    try { await admin.auth.admin.deleteUser(inviteeId); } catch {}
    try { await admin.auth.admin.deleteUser(inviterId); } catch {}

    expect(roleAfter?.completed_onboarding).toBe(true);
  });
});
