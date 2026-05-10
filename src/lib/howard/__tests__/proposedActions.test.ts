import { describe, it, expect } from 'vitest';
import { executeAction, type ProposedAction } from '../proposedActions';

// Minimal mock builder for a Supabase fluent chain. Each test declares
// the table handlers it needs; anything else returns an empty ok result
// so accidental reads don't throw in unrelated paths.
//
// The mock intentionally does NOT try to reproduce Supabase's actual
// query semantics — it records calls and returns what the test sets up.
// If a test exposes a real shape mismatch, the fix is in the test, not
// in this harness.
function makeSb(handlers: Record<string, (op: string, ctx: any) => any>) {
  const calls: Array<{ table: string; op: string; payload?: any; filters: any }> = [];
  const from = (table: string) => {
    const ctx: any = { filters: {}, _table: table };
    const run = (op: string) => {
      const h = handlers[table];
      calls.push({ table, op, payload: ctx.payload, filters: { ...ctx.filters } });
      if (!h) return Promise.resolve({ data: null, error: null });
      return Promise.resolve(h(op, ctx));
    };
    const chain: any = {
      select: (_cols?: string) => {
        ctx.op = ctx.op || 'select';
        return chain;
      },
      insert: (payload: any) => {
        ctx.op = 'insert';
        ctx.payload = payload;
        return chain;
      },
      update: (payload: any) => {
        ctx.op = 'update';
        ctx.payload = payload;
        return chain;
      },
      upsert: (payload: any, opts?: any) => {
        ctx.op = 'upsert';
        ctx.payload = payload;
        ctx.upsertOpts = opts;
        return chain;
      },
      delete: () => {
        ctx.op = 'delete';
        return chain;
      },
      eq: (col: string, val: any) => {
        (ctx.filters.eq ||= []).push([col, val]);
        return chain;
      },
      in: (col: string, vals: any[]) => {
        (ctx.filters.in ||= []).push([col, vals]);
        return chain;
      },
      is: (col: string, val: any) => {
        (ctx.filters.is ||= []).push([col, val]);
        return chain;
      },
      maybeSingle: () => run(ctx.op || 'select'),
      single: () => run(ctx.op || 'select'),
      then: (resolve: any) => run(ctx.op || 'select').then(resolve),
    };
    return chain;
  };
  return { sb: { from } as any, calls };
}

function baseAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'pa-1',
    thread_id: 't-1',
    message_id: null,
    user_id: 'user-1',
    aircraft_id: 'ac-1',
    action_type: 'note',
    payload: {},
    summary: 'x',
    required_role: 'access',
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('executeAction — squawk_resolve', () => {
  it('rejects when the squawk belongs to a different aircraft', async () => {
    const { sb } = makeSb({
      aft_squawks: (op) => {
        if (op === 'select') {
          return { data: { id: 'sq-1', aircraft_id: 'ac-other', deleted_at: null, status: 'open' }, error: null };
        }
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'squawk_resolve',
      payload: { squawk_id: 'sq-1', resolution_note: 'replaced' },
    });
    await expect(executeAction(sb, action, 'user-1')).rejects.toThrow(/not found/i);
  });

  it('rejects when the squawk is already resolved', async () => {
    const { sb } = makeSb({
      aft_squawks: (op) => {
        if (op === 'select') {
          return { data: { id: 'sq-1', aircraft_id: 'ac-1', deleted_at: null, status: 'resolved' }, error: null };
        }
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'squawk_resolve',
      payload: { squawk_id: 'sq-1', resolution_note: 'fixed' },
    });
    await expect(executeAction(sb, action, 'user-1')).rejects.toThrow(/already resolved/i);
  });

  it('resolves an open squawk and guards the UPDATE with status=open', async () => {
    const { sb, calls } = makeSb({
      aft_squawks: (op) => {
        if (op === 'select') {
          return { data: { id: 'sq-1', aircraft_id: 'ac-1', deleted_at: null, status: 'open' }, error: null };
        }
        if (op === 'update') {
          return { data: [{ id: 'sq-1' }], error: null };
        }
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'squawk_resolve',
      payload: { squawk_id: 'sq-1', resolution_note: 'replaced brake pad' },
    });
    const result = await executeAction(sb, action, 'user-1');
    expect(result).toEqual({ recordId: 'sq-1', recordTable: 'aft_squawks' });
    const updateCall = calls.find(c => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall!.payload).toEqual({
      status: 'resolved',
      affects_airworthiness: false,
      resolved_note: 'replaced brake pad',
    });
    // Must include the status='open' guard so a racing writer can't
    // have the update clobber an already-resolved row.
    const eqFilters = updateCall!.filters.eq || [];
    expect(eqFilters).toContainEqual(['status', 'open']);
  });

  it('treats an empty update return as "already resolved by someone else"', async () => {
    const { sb } = makeSb({
      aft_squawks: (op) => {
        if (op === 'select') {
          return { data: { id: 'sq-1', aircraft_id: 'ac-1', deleted_at: null, status: 'open' }, error: null };
        }
        if (op === 'update') {
          // A racing writer flipped the status between our SELECT and UPDATE.
          return { data: [], error: null };
        }
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'squawk_resolve',
      payload: { squawk_id: 'sq-1', resolution_note: 'fixed' },
    });
    await expect(executeAction(sb, action, 'user-1')).rejects.toThrow(/already resolved/i);
  });
});

describe('executeAction — mx_schedule', () => {
  it('creates an event and attaches MX + squawk line items', async () => {
    const inserts: any[] = [];
    const { sb } = makeSb({
      aft_aircraft: (op) => {
        if (op === 'select') {
          return {
            data: {
              mx_contact: 'Bob',
              mx_contact_email: 'bob@shop.test',
              main_contact: 'Alice',
              main_contact_email: 'alice@owner.test',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      aft_maintenance_events: (op, ctx) => {
        if (op === 'insert') {
          inserts.push({ table: 'aft_maintenance_events', payload: ctx.payload });
          return { data: { id: 'evt-1' }, error: null };
        }
        return { data: null, error: null };
      },
      aft_maintenance_items: (op) => {
        if (op === 'select') {
          return {
            data: [
              { id: 'mx-1', item_name: '100 hr', tracking_type: 'time', due_time: 1234 },
              { id: 'mx-2', item_name: 'Annual', tracking_type: 'date', due_date: '2026-12-01' },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
      aft_squawks: (op) => {
        if (op === 'select') {
          return { data: [{ id: 'sq-1', description: 'Tire wear', location: null }], error: null };
        }
        return { data: null, error: null };
      },
      aft_event_line_items: (op, ctx) => {
        if (op === 'insert') {
          inserts.push({ table: 'aft_event_line_items', payload: ctx.payload });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    });

    const action = baseAction({
      action_type: 'mx_schedule',
      required_role: 'admin',
      payload: {
        proposed_date: '2026-05-01',
        mx_item_ids: ['mx-1', 'mx-2'],
        squawk_ids: ['sq-1'],
        addon_services: ['wash'],
      },
    });
    const result = await executeAction(sb, action, 'user-1');
    expect(result).toEqual({ recordId: 'evt-1', recordTable: 'aft_maintenance_events' });

    const eventInsert = inserts.find(i => i.table === 'aft_maintenance_events');
    expect(eventInsert).toBeDefined();
    expect(eventInsert!.payload).toMatchObject({
      aircraft_id: 'ac-1',
      created_by: 'user-1',
      status: 'draft',
      proposed_date: '2026-05-01',
      proposed_by: 'owner',
      addon_services: ['wash'],
      mx_contact_name: 'Bob',
      mx_contact_email: 'bob@shop.test',
      primary_contact_name: 'Alice',
      primary_contact_email: 'alice@owner.test',
    });

    const lineItemInserts = inserts.filter(i => i.table === 'aft_event_line_items');
    // One batch for MX, one batch for squawks.
    expect(lineItemInserts).toHaveLength(2);
    const mxBatch = lineItemInserts.find(i =>
      Array.isArray(i.payload) && i.payload[0]?.item_type === 'maintenance'
    );
    const sqBatch = lineItemInserts.find(i =>
      Array.isArray(i.payload) && i.payload[0]?.item_type === 'squawk'
    );
    expect(mxBatch!.payload).toHaveLength(2);
    expect(mxBatch!.payload[0]).toMatchObject({
      event_id: 'evt-1',
      item_type: 'maintenance',
      maintenance_item_id: 'mx-1',
      item_name: '100 hr',
    });
    expect(sqBatch!.payload).toHaveLength(1);
    expect(sqBatch!.payload[0]).toMatchObject({
      event_id: 'evt-1',
      item_type: 'squawk',
      squawk_id: 'sq-1',
    });
  });

  it('skips line-item inserts when no mx_item_ids / squawk_ids are given', async () => {
    const inserts: any[] = [];
    const { sb } = makeSb({
      aft_aircraft: () => ({ data: {}, error: null }),
      aft_maintenance_events: (op, ctx) => {
        if (op === 'insert') {
          inserts.push({ table: 'aft_maintenance_events', payload: ctx.payload });
          return { data: { id: 'evt-2' }, error: null };
        }
        return { data: null, error: null };
      },
      aft_event_line_items: (op, ctx) => {
        if (op === 'insert') inserts.push({ table: 'aft_event_line_items', payload: ctx.payload });
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'mx_schedule',
      required_role: 'admin',
      payload: { proposed_date: '2026-06-01' },
    });
    const result = await executeAction(sb, action, 'user-1');
    expect(result.recordTable).toBe('aft_maintenance_events');
    expect(inserts.filter(i => i.table === 'aft_event_line_items')).toHaveLength(0);
  });

  it('propagates insert errors from the event row', async () => {
    const { sb } = makeSb({
      aft_aircraft: () => ({ data: {}, error: null }),
      aft_maintenance_events: (op) => {
        if (op === 'insert') return { data: null, error: { message: 'constraint violated' } };
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'mx_schedule',
      required_role: 'admin',
      payload: {},
    });
    await expect(executeAction(sb, action, 'user-1')).rejects.toMatchObject({ message: 'constraint violated' });
  });
});

describe('executeAction — note + reservation', () => {
  it('inserts a note with the current user as author', async () => {
    const { sb, calls } = makeSb({
      aft_notes: (op, ctx) => {
        if (op === 'insert') return { data: { id: 'note-1' }, error: null };
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'note',
      payload: { content: 'Left fuel-cap seal worn' },
    });
    const result = await executeAction(sb, action, 'user-abc');
    expect(result).toEqual({ recordId: 'note-1', recordTable: 'aft_notes' });
    const insert = calls.find(c => c.op === 'insert');
    expect(insert!.payload).toEqual({
      aircraft_id: 'ac-1',
      author_id: 'user-abc',
      content: 'Left fuel-cap seal worn',
    });
  });

  it('inserts a reservation with required fields and confirmed status', async () => {
    const { sb, calls } = makeSb({
      aft_reservations: (op) => {
        if (op === 'insert') return { data: { id: 'res-1' }, error: null };
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'reservation',
      payload: {
        start_time: '2026-05-01T14:00:00Z',
        end_time: '2026-05-01T17:00:00Z',
        pilot_initials: 'AG',
        pod: 'KCMA',
        poa: 'KCMA',
      },
    });
    const result = await executeAction(sb, action, 'user-abc');
    expect(result.recordTable).toBe('aft_reservations');
    const insert = calls.find(c => c.op === 'insert');
    expect(insert!.payload).toMatchObject({
      aircraft_id: 'ac-1',
      user_id: 'user-abc',
      pilot_initials: 'AG',
      status: 'confirmed',
    });
  });
});

describe('executeAction — onboarding_setup', () => {
  it('updates profile, inserts aircraft, grants admin access, and flips onboarding flag', async () => {
    let insertedAircraftId: string | null = null;
    const { sb, calls } = makeSb({
      aft_user_roles: () => ({ data: null, error: null }),
      aft_aircraft: (op, ctx) => {
        if (op === 'insert') {
          insertedAircraftId = 'ac-new';
          return { data: { id: 'ac-new', tail_number: ctx.payload.tail_number }, error: null };
        }
        return { data: null, error: null };
      },
      aft_user_aircraft_access: () => ({ data: null, error: null }),
    });
    const action = baseAction({
      action_type: 'onboarding_setup',
      aircraft_id: null,
      payload: {
        profile: {
          full_name: 'Jane Smith',
          initials: 'js',
          faa_ratings: ['PPL', 'IFR'],
        },
        aircraft: {
          tail_number: 'n12345',
          make: 'Cessna',
          model: '172N',
          engine_type: 'Piston',
          is_ifr_equipped: true,
          home_airport: 'kdal',
          setup_hobbs: 2450.3,
          setup_tach: 2350.1,
        },
      },
    });

    const result = await executeAction(sb, action, 'user-new');

    expect(result.recordTable).toBe('aft_aircraft');
    expect(result.recordId).toBe('ac-new');
    expect(insertedAircraftId).toBe('ac-new');

    // Profile upsert seeds the user's identity; the onboarding gate
    // flag is flipped in a SECOND update only after the aircraft +
    // access rows land successfully (otherwise a partial-failure
    // strands the user on an empty-fleet screen with the gate
    // already marked done). Upsert is used so a missing role row
    // gets created for invited users whose row hasn't landed yet.
    const profileUpsert = calls.find(c => c.table === 'aft_user_roles' && c.op === 'upsert');
    expect(profileUpsert!.payload).toMatchObject({
      user_id: 'user-new',
      full_name: 'Jane Smith',
      initials: 'JS',
      faa_ratings: ['PPL', 'IFR'],
    });
    // Belt-and-suspenders: the upsert must NOT pre-flip the gate.
    expect((profileUpsert!.payload as any).completed_onboarding).toBeUndefined();
    // The completed_onboarding flip happens in a follow-up update on
    // the same table after access lands.
    const profileGateUpdate = calls.find(c => c.table === 'aft_user_roles' && c.op === 'update');
    expect(profileGateUpdate!.payload).toMatchObject({ completed_onboarding: true });

    // Aircraft insert normalized tail + home airport to uppercase and
    // seeded total_* from setup_*.
    const aircraftInsert = calls.find(c => c.table === 'aft_aircraft' && c.op === 'insert');
    expect(aircraftInsert!.payload).toMatchObject({
      tail_number: 'N12345',
      created_by: 'user-new',
      engine_type: 'Piston',
      is_ifr_equipped: true,
      home_airport: 'KDAL',
      setup_hobbs: 2450.3,
      setup_tach: 2350.1,
      total_airframe_time: 2450.3,
      total_engine_time: 2350.1,
    });

    // Admin access granted for the new aircraft.
    const accessInsert = calls.find(c => c.table === 'aft_user_aircraft_access' && c.op === 'insert');
    expect(accessInsert!.payload).toMatchObject({
      user_id: 'user-new',
      aircraft_id: 'ac-new',
      aircraft_role: 'admin',
    });
  });

  it('surfaces a friendly error on duplicate tail number', async () => {
    const { sb } = makeSb({
      aft_user_roles: () => ({ data: null, error: null }),
      aft_aircraft: (op) => {
        if (op === 'insert') {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        return { data: null, error: null };
      },
    });
    const action = baseAction({
      action_type: 'onboarding_setup',
      aircraft_id: null,
      payload: {
        profile: { full_name: 'Jane', initials: 'J' },
        aircraft: { tail_number: 'N12345', engine_type: 'Piston', is_ifr_equipped: false },
      },
    });
    await expect(executeAction(sb, action, 'user-new'))
      .rejects.toThrow(/already exists/i);
  });
});
