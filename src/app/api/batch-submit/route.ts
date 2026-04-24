import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { apiErrorCoded, handleCodedError, CodedError } from '@/lib/apiResponse';
import type { ApiErrorCode } from '@/lib/apiResponse';
import {
  validateFlightLogInput,
  validateVorCheckInput,
  validateOilLogInput,
  validateTireCheckInput,
  validateSquawkInput,
  submitFlightLog,
  submitVorCheck,
  submitOilLog,
  submitTireCheck,
  submitSquawk,
} from '@/lib/submissions';
import { requireAircraftAccessCoded } from '@/lib/submissionAuth';

// =============================================================
// POST /api/batch-submit
// Companion-app offline-queue flush endpoint.
// =============================================================
// One round-trip for many queued submissions. The client POSTs:
//
//   {
//     "submissions": [
//       {
//         "type": "flight-log" | "vor" | "oil" | "tire" | "squawk",
//         "aircraftId": "<uuid>",
//         "idempotencyKey": "<uuid, optional but recommended>",
//         "payload": { ...type-specific fields },
//         "aircraftUpdate": { ... }   // flight-log only, optional
//       },
//       ...
//     ]
//   }
//
// Response (200 even on per-item failures — the HTTP status covers
// the overall request, per-item status lives in `results`):
//
//   {
//     "ok": true,
//     "data": {
//       "results": [
//         { "index": 0, "ok": true,  "type": "flight-log", "id": "..." },
//         { "index": 1, "ok": false, "type": "vor", "code": "VALIDATION_ERROR",
//           "error": "bearing_error must be finite", "status": 400 },
//         ...
//       ]
//     }
//   }
//
// Ordering: submissions are sorted server-side by the payload's
// `occurred_at` ASC before processing. That guarantees earlier-
// occurred rows land in the DB before later-occurred ones so the
// per-row sanity checks (e.g. flight-log's 24hr bound against the
// prior-by-occurred_at row) see a stable history. Items without
// occurred_at sort to the end (stamped with now() at write time).
//
// Atomicity: each item is its own transaction. A partial failure
// doesn't roll back successful ones — the companion app re-queues
// only the failed indices. That beats all-or-nothing: a single bad
// item would otherwise block the whole flush.
//
// Idempotency: per-item X-Idempotency-Key semantics are opt-in.
// If the companion app sends an `idempotencyKey` on each item, a
// replay of the same batch (e.g. network flap after partial
// success) returns the cached per-item response instead of
// re-inserting. Implemented by writing (user_id, key) into
// aft_idempotency_keys just like the individual routes.
//
// Limits: 100 submissions per batch. Larger batches should be
// chunked client-side — keeps request bodies reasonable and the
// per-item loop below bounded.
// =============================================================

const MAX_SUBMISSIONS_PER_BATCH = 100;

type SubmissionType = 'flight-log' | 'vor' | 'oil' | 'tire' | 'squawk';

interface BatchSubmission {
  type: SubmissionType;
  aircraftId: string;
  idempotencyKey?: string;
  payload: unknown;
  aircraftUpdate?: Record<string, unknown>;
}

interface BatchResult {
  index: number;
  type: SubmissionType;
  ok: boolean;
  id?: string;
  code?: ApiErrorCode;
  error?: string;
  status?: number;
}

const VALID_TYPES: ReadonlySet<SubmissionType> = new Set<SubmissionType>([
  'flight-log', 'vor', 'oil', 'tire', 'squawk',
]);

function getOccurredAt(submission: BatchSubmission): number {
  const p = submission.payload as any;
  const raw = p?.occurred_at;
  if (typeof raw !== 'string') return Number.POSITIVE_INFINITY;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const body = await req.json();
    const submissions = body?.submissions;

    if (!Array.isArray(submissions)) {
      return apiErrorCoded('VALIDATION_ERROR', 'Body must be { submissions: [...] }.', 400, req);
    }
    if (submissions.length === 0) {
      return apiErrorCoded('VALIDATION_ERROR', 'No submissions provided.', 400, req);
    }
    if (submissions.length > MAX_SUBMISSIONS_PER_BATCH) {
      return apiErrorCoded('VALIDATION_ERROR', `Batch size exceeds ${MAX_SUBMISSIONS_PER_BATCH}.`, 400, req);
    }

    // Index-stable pairs so result[].index tracks the client's
    // original position even after the occurred_at sort.
    const indexed = submissions.map((s: BatchSubmission, index: number) => ({ s, index }));

    // Sort by occurred_at ASC. Items without occurred_at go to the
    // end so they stamp "now" after all backfills have landed.
    indexed.sort((a, b) => getOccurredAt(a.s) - getOccurredAt(b.s));

    const results: BatchResult[] = [];

    for (const { s, index } of indexed) {
      const result: BatchResult = { index, type: s?.type, ok: false };
      try {
        if (!s || typeof s !== 'object') {
          throw new CodedError('VALIDATION_ERROR', 'Invalid submission.', 400);
        }
        if (!VALID_TYPES.has(s.type)) {
          throw new CodedError('VALIDATION_ERROR', `Unknown type: ${s.type}`, 400);
        }
        if (!s.aircraftId) {
          throw new CodedError('AIRCRAFT_ID_REQUIRED', 'aircraftId required.', 400);
        }

        // Per-item idempotency — if the companion app supplied a key,
        // check for a cached response and short-circuit.
        if (s.idempotencyKey) {
          const { data: cached } = await supabaseAdmin
            .from('aft_idempotency_keys')
            .select('response_status, response_body')
            .eq('user_id', user.id)
            .eq('key', s.idempotencyKey)
            .maybeSingle();
          if (cached) {
            const body = cached.response_body as any;
            results.push({
              index,
              type: s.type,
              ok: cached.response_status < 400,
              id: body?.id ?? body?.logId ?? body?.squawk?.id,
              status: cached.response_status,
            });
            continue;
          }
        }

        await requireAircraftAccessCoded(supabaseAdmin, user.id, s.aircraftId);

        let id: string | undefined;
        let responseBody: any;

        switch (s.type) {
          case 'flight-log': {
            const input = validateFlightLogInput(s.payload);
            const out = await submitFlightLog(
              supabaseAdmin,
              user.id,
              s.aircraftId,
              input,
              s.aircraftUpdate ?? {},
            );
            id = out.logId;
            responseBody = { success: true, logId: out.logId, isLatest: out.isLatest };
            break;
          }
          case 'vor': {
            const input = validateVorCheckInput(s.payload);
            const out = await submitVorCheck(supabaseAdmin, user.id, s.aircraftId, input);
            id = out.id;
            responseBody = { success: true, id: out.id, passed: out.passed };
            break;
          }
          case 'oil': {
            const input = validateOilLogInput(s.payload);
            const out = await submitOilLog(supabaseAdmin, user.id, s.aircraftId, input);
            id = out.id;
            responseBody = { success: true, id: out.id };
            break;
          }
          case 'tire': {
            const input = validateTireCheckInput(s.payload);
            const out = await submitTireCheck(supabaseAdmin, user.id, s.aircraftId, input);
            id = out.id;
            responseBody = { success: true, id: out.id };
            break;
          }
          case 'squawk': {
            const input = validateSquawkInput(s.payload);
            const out = await submitSquawk(supabaseAdmin, user.id, s.aircraftId, input);
            id = out.id;
            responseBody = { success: true, squawk: out.row };
            break;
          }
        }

        // Cache the success response for idempotent retries.
        if (s.idempotencyKey) {
          await supabaseAdmin
            .from('aft_idempotency_keys')
            .upsert(
              {
                user_id: user.id,
                key: s.idempotencyKey,
                route: `batch-submit/${s.type}`,
                response_status: 200,
                response_body: responseBody,
              },
              { onConflict: 'user_id,key' },
            );
        }

        result.ok = true;
        result.id = id;
        result.status = 200;
      } catch (err) {
        if (err instanceof CodedError) {
          result.code = err.code;
          result.error = err.message;
          result.status = err.status;
        } else if (typeof err === 'object' && err !== null && 'status' in err && 'message' in err) {
          const authErr = err as { status: number; message: string };
          result.status = authErr.status;
          result.code = authErr.status === 401 ? 'UNAUTHENTICATED'
            : authErr.status === 403 ? 'NO_AIRCRAFT_ACCESS'
            : 'INTERNAL_ERROR';
          result.error = authErr.message;
        } else {
          result.code = 'INTERNAL_ERROR';
          result.error = (err as Error)?.message || 'Unexpected error.';
          result.status = 500;
        }
      }
      results.push(result);
    }

    // Sort results back to the client's original index order so the
    // companion app can match them 1:1 to the queue positions.
    results.sort((a, b) => a.index - b.index);

    return NextResponse.json({ ok: true, data: { results } });
  } catch (error) {
    return handleCodedError(error, req);
  }
}
