import { test, expect } from '@playwright/test';
import { adminClient } from '../helpers/admin';
import { randomUUID } from 'node:crypto';

// Regression for the drift bug a pilot reported 2026-05-13: the
// PilotOnboarding "set up your aircraft" form was missing fields
// the post-onboarding AircraftModal had (Make, Type Cert, Time
// Zone, IFR-equipped, Equipment + Documents collapsibles).
//
// Both surfaces now render <AircraftForm> from the same module —
// AircraftModal at src/components/modals/AircraftModal.tsx,
// PilotOnboarding at src/components/PilotOnboarding.tsx. Code reuse
// guarantees AircraftModal can't drift from the form below; this
// test guards PilotOnboarding specifically: confirms it pulls in
// every expected field on first render, so the next "I'll do it
// myself" pilot doesn't lose IFR-equipped or Time Zone again.
test('PilotOnboarding renders the full AircraftForm field set', async ({ page }) => {
  test.setTimeout(60_000);
  const admin = adminClient();

  // Brand-new user — no aircraft, no completed_onboarding. Lands in
  // HowardWelcome on sign-in, then tap "I'll do it myself" to reach
  // PilotOnboarding.
  const email = `e2e-parity-onb-${randomUUID()}@skyward-test.local`;
  const password = `pw-${randomUUID().slice(0, 12)}`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = u!.user!.id;
  await admin.from('aft_user_roles').upsert({
    user_id: userId,
    role: 'pilot',
    email,
    completed_onboarding: false,
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // HowardWelcome appears for completed_onboarding=false.
  await expect(page.getByRole('heading', { name: /meet howard/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /i.ll do it myself/i }).click();

  // PilotOnboarding renders the shared AircraftForm.
  await expect(page.getByRole('heading', { name: /set up your aircraft/i })).toBeVisible({ timeout: 10_000 });

  // Every expected label/section is on the page. getByText(exact:false)
  // matches the label inside its <label> wrapper. The 14 labels below
  // are the union of the pre-refactor PilotOnboarding fields PLUS the
  // ones that had drifted off (Make, Type Cert, Time Zone, IFR-equipped,
  // Equipment & Avionics, Documents).
  const EXPECTED = [
    'Add Aircraft Photo',
    'Tail Number',
    'Serial Num',
    'Make',
    'Type Cert',
    'Model Name',
    'Engine Type',
    'Home Airport',
    'Time Zone',
    'IFR-equipped',
    'Main Contact',
    'MX Contact',
    'Equipment & Avionics',
    'Documents',
  ];
  for (const label of EXPECTED) {
    await expect(
      page.getByText(label, { exact: false }).first(),
    ).toBeVisible({ timeout: 5_000 });
  }

  try { await admin.from('aft_user_roles').delete().eq('user_id', userId); } catch {}
  try { await admin.auth.admin.deleteUser(userId); } catch {}
});
