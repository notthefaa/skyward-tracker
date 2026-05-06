import { test, expect } from '../fixtures/seeded-user';
import { adminClient } from '../helpers/admin';
import { getAccessToken, fetchAs } from '../helpers/auth-token';

/**
 * MX item edit + delete via API.
 *
 * Edit covers: PUT /api/maintenance-items writes through `pickAllowedFields`
 * + `validateMxItemRow`, and (the 2026-05-06 fix) when the payload contains
 * `last_completed_*` it ALSO resets the cron email-sent flags so future
 * approaching-due cycles re-fire.
 *
 * Delete covers: soft-delete via `deleted_at`, with cross-aircraft scope
 * guard.
 */
test.describe('mx-item — edit + delete', () => {
  test('PUT updates last_completed_* and resets email-sent flags', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { data: created, error: insErr } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'Annual via PUT',
        tracking_type: 'date',
        is_required: true,
        last_completed_date: '2024-06-01',
        date_interval_days: 365,
        due_date: '2025-06-01',
        primary_heads_up_sent: true,
        mx_schedule_sent: true,
        reminder_5_sent: true,
        reminder_15_sent: true,
        reminder_30_sent: true,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`seed mx item: ${insErr.message}`);
    const itemId = created.id as string;

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'PUT',
      body: JSON.stringify({
        itemId,
        aircraftId: seededUser.aircraftId,
        itemData: {
          last_completed_date: '2026-05-06',
          due_date: '2027-05-06',
        },
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_maintenance_items')
      .select('last_completed_date, due_date, primary_heads_up_sent, mx_schedule_sent, reminder_5_sent, reminder_15_sent, reminder_30_sent')
      .eq('id', itemId)
      .single();
    expect(row?.last_completed_date).toBe('2026-05-06');
    expect(row?.due_date).toBe('2027-05-06');
    // All five email-sent flags should be reset.
    expect(row?.primary_heads_up_sent).toBe(false);
    expect(row?.mx_schedule_sent).toBe(false);
    expect(row?.reminder_5_sent).toBe(false);
    expect(row?.reminder_15_sent).toBe(false);
    expect(row?.reminder_30_sent).toBe(false);

    await admin.from('aft_maintenance_items').delete().eq('id', itemId);
  });

  test('PUT without last_completed_* leaves flags untouched', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { data: created } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'No-completion edit',
        tracking_type: 'date',
        date_interval_days: 365,
        due_date: '2026-12-31',
        primary_heads_up_sent: true,
      })
      .select('id')
      .single();
    const itemId = created!.id as string;

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'PUT',
      body: JSON.stringify({
        itemId,
        aircraftId: seededUser.aircraftId,
        itemData: { item_name: 'Renamed item' },
      }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_maintenance_items')
      .select('item_name, primary_heads_up_sent')
      .eq('id', itemId)
      .single();
    expect(row?.item_name).toBe('Renamed item');
    expect(row?.primary_heads_up_sent).toBe(true); // unchanged

    await admin.from('aft_maintenance_items').delete().eq('id', itemId);
  });

  test('DELETE soft-deletes the item', async ({ seededUser, baseURL }) => {
    const admin = adminClient();
    const { data: created } = await admin
      .from('aft_maintenance_items')
      .insert({
        aircraft_id: seededUser.aircraftId,
        item_name: 'Delete-me',
        tracking_type: 'date',
        date_interval_days: 365,
      })
      .select('id')
      .single();
    const itemId = created!.id as string;

    const token = await getAccessToken(seededUser.email, seededUser.password);
    const res = await fetchAs(token, baseURL!, '/api/maintenance-items', {
      method: 'DELETE',
      body: JSON.stringify({ itemId, aircraftId: seededUser.aircraftId }),
    });
    expect(res.status).toBe(200);

    const { data: row } = await admin
      .from('aft_maintenance_items')
      .select('deleted_at')
      .eq('id', itemId)
      .single();
    expect(row?.deleted_at).not.toBeNull();

    await admin.from('aft_maintenance_items').delete().eq('id', itemId);
  });
});
