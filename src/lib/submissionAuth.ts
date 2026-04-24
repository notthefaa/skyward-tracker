// =============================================================
// Aircraft-access guard that returns CodedError instead of the
// plain { status, message } shape.
//
// Kept in its own file (rather than in submissions.ts) so the
// validators in submissions.ts don't transitively pull in env.ts
// — the validators are pure and unit-testable without Supabase
// env vars, which matters because the companion-app queue
// contract lives and dies by those validators behaving correctly.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAircraftAccess } from './auth';
import { CodedError } from './apiResponse';

type AdminClient = SupabaseClient<any, any, any>;

export async function requireAircraftAccessCoded(
  sb: AdminClient,
  userId: string,
  aircraftId: string,
): Promise<void> {
  try {
    await requireAircraftAccess(sb, userId, aircraftId);
  } catch (err: any) {
    if (err?.status === 403) {
      throw new CodedError(
        'NO_AIRCRAFT_ACCESS',
        err.message || 'You do not have access to this aircraft.',
        403,
      );
    }
    throw err;
  }
}
