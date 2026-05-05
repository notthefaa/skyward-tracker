import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';

/**
 * More → Notes: post → edit → delete a flight note. Notes are a
 * pilot↔pilot communication channel; the route fans out emails to
 * other assigned pilots, so we keep the test focused on the DB-side
 * truth (note row) and the UI-side toast/listing — the email path is
 * covered separately when we wire the Resend smoke.
 */
test.describe('More → Notes — post / edit / delete', () => {
  test('admin posts a note, edits it, deletes it', async ({ page, seededUser }) => {
    test.setTimeout(120_000);

    const apiErrors: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/notes') && !res.ok()) {
        apiErrors.push(`${res.status()} ${res.url()} :: ${await res.text().catch(() => '')}`);
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(seededUser.email);
    await page.locator('input[type="password"]').fill(seededUser.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    const secondaryNav = page.getByRole('navigation', { name: 'Secondary navigation' });

    await expect(mainNav.getByRole('button', { name: 'More', exact: true })).toBeVisible({ timeout: 20_000 });
    await mainNav.getByRole('button', { name: 'More', exact: true }).click();
    await secondaryNav.getByRole('button', { name: 'Notes', exact: true }).click();

    // ── Post a new note
    await page.getByRole('button', { name: /add new note/i }).click();
    await expect(page.getByRole('heading', { name: /add note/i })).toBeVisible();

    const ORIGINAL = 'Refilled tach oil to full. Consumption was slightly above normal — keep an eye on it.';
    await page.getByPlaceholder('Share info with the next pilot...').fill(ORIGINAL);
    await page.getByRole('button', { name: /^Post Note$/ }).click();

    if (apiErrors.length) {
      throw new Error(`/api/notes errored on post:\n${apiErrors.join('\n')}`);
    }
    // The toast is gated on the awaited /api/emails/note-notify call,
    // which compiles cold on first dev hit. 30s covers the worst case.
    await expect(page.getByText(/note posted/i).first()).toBeVisible({ timeout: 30_000 });

    // DB-side: the note exists.
    const admin = adminClient();
    const { data: rows1, error: e1 } = await admin
      .from('aft_notes')
      .select('id, content, deleted_at')
      .eq('aircraft_id', seededUser.aircraftId)
      .is('deleted_at', null);
    if (e1) throw new Error(`notes read: ${e1.message}`);
    expect(rows1?.length).toBe(1);
    expect(rows1![0].content).toBe(ORIGINAL);
    const noteId = rows1![0].id as string;

    // UI-side: visible in the list. Use first() — the note's text could
    // appear in multiple cards if there's a "share" preview etc.
    await expect(page.getByText(ORIGINAL).first()).toBeVisible({ timeout: 5_000 });

    // ── Edit
    await page.getByRole('button', { name: 'Edit note' }).first().click();

    await expect(page.getByRole('heading', { name: /edit note/i })).toBeVisible();
    const EDITED = ORIGINAL + ' (edited — checked oil sample, no metal)';
    const ta = page.getByPlaceholder('Share info with the next pilot...');
    await ta.fill(EDITED);
    // After editing the save button text changes — same Post Note
    // label is reused (component doesn't differentiate edit vs post).
    await page.getByRole('button', { name: /^Post Note$/ }).click();

    if (apiErrors.length) {
      throw new Error(`/api/notes errored on edit:\n${apiErrors.join('\n')}`);
    }
    await expect(page.getByText(/note updated/i).first()).toBeVisible({ timeout: 30_000 });

    const { data: rows2 } = await admin
      .from('aft_notes')
      .select('content')
      .eq('id', noteId)
      .single();
    expect(rows2?.content).toBe(EDITED);

    // ── Delete. Trash2 icon opens the in-app ConfirmProvider modal
    // (role=dialog, custom UI — NOT a window.confirm). Confirm via the
    // dialog's "Delete" button.
    await page.getByRole('button', { name: 'Delete note' }).first().click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

    if (apiErrors.length) {
      throw new Error(`/api/notes errored on delete:\n${apiErrors.join('\n')}`);
    }
    await expect(page.getByText(/note deleted/i).first()).toBeVisible({ timeout: 30_000 });

    const { data: rows3 } = await admin
      .from('aft_notes')
      .select('id, deleted_at')
      .eq('id', noteId)
      .single();
    expect(rows3?.deleted_at).not.toBeNull();
  });
});
