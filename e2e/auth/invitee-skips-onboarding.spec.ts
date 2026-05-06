import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

/**
 * The 2026-05-06 fix: an invited user must NOT be pushed into the
 * Howard welcome modal that asks them to create an aircraft. Instead
 * they should land directly in the main app on first sign-in.
 *
 * We simulate the post-invite state: auth.users + aft_user_roles
 * (with completed_onboarding=true) + aft_user_aircraft_access on the
 * inviter's aircraft. The invitee then signs in normally.
 */
test.describe('invited user — skips welcome modal', () => {
  test('first sign-in lands on the main app, not the welcome modal', async ({ page }) => {
    const admin = adminClient();

    // 1. Inviter (admin) — creates an aircraft.
    const inviterEmail = `e2e-invtr-${randomUUID()}@skyward-test.local`;
    const inviterPw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: inviterU } = await admin.auth.admin.createUser({
      email: inviterEmail, password: inviterPw, email_confirm: true,
    });
    const inviterId = inviterU!.user!.id;

    const { data: aircraft, error: rpcErr } = await admin.rpc('create_aircraft_atomic', {
      p_user_id: inviterId,
      p_payload: {
        tail_number: `N${randomUUID().slice(0, 5).toUpperCase()}`,
        aircraft_type: 'Cessna 172S',
        engine_type: 'Piston',
      },
    });
    if (rpcErr) throw new Error(`create_aircraft: ${rpcErr.message}`);
    const aircraftId = (aircraft as { id: string }).id;

    // 2. Invitee — auth.user + role row with completed_onboarding=true
    //    + access on the same aircraft. Mirrors what /api/pilot-invite
    //    sets up, minus the email step.
    const inviteeEmail = `e2e-invitee-${randomUUID()}@skyward-test.local`;
    const inviteePw = `pw-${randomUUID().slice(0, 12)}`;
    const { data: inviteeU } = await admin.auth.admin.createUser({
      email: inviteeEmail, password: inviteePw, email_confirm: true,
    });
    const inviteeId = inviteeU!.user!.id;

    await admin.from('aft_user_roles').upsert({
      user_id: inviteeId,
      role: 'pilot',
      email: inviteeEmail,
      completed_onboarding: true,
    }, { onConflict: 'user_id' });

    await admin.from('aft_user_aircraft_access').upsert({
      user_id: inviteeId,
      aircraft_id: aircraftId,
      aircraft_role: 'pilot',
    }, { onConflict: 'user_id,aircraft_id' });

    // 3. Sign in as invitee.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(inviteeEmail);
    await page.locator('input[type="password"]').fill(inviteePw);
    await page.getByRole('button', { name: 'Log in' }).click();

    // 4. Should land in the main app — top nav visible. Welcome modal
    // ("Meet Howard") should NOT appear.
    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(mainNav).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /meet howard/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /set up together/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /i.ll do it myself/i })).toHaveCount(0);

    // Cleanup.
    await admin.from('aft_aircraft').delete().eq('id', aircraftId);
    await admin.auth.admin.deleteUser(inviteeId).then(undefined, () => {});
    await admin.auth.admin.deleteUser(inviterId).then(undefined, () => {});
  });
});
