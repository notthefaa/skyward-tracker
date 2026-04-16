// Postgres / PostgREST error → user-friendly message.
//
// Supabase-js surfaces PostgREST errors with a `code`, `message`, and
// `details` field. Raw `error.message` often leaks column names,
// constraint names, or trigger internals. This helper returns a copy
// safe to show directly to a user. Falls back to the original message
// when we don't have a mapping — better than masking everything as
// "unexpected error".

export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

interface MapEntry {
  match: (err: PgLikeError) => boolean;
  text: (err: PgLikeError) => string;
}

const MAP: MapEntry[] = [
  {
    match: e => e.code === '23505',
    text: e => {
      const m = /Key \((.+?)\)=/.exec(e.details || '');
      const col = m?.[1];
      return col
        ? `Already in use: ${col.replace(/_/g, ' ')}. Pick a different value.`
        : 'That value is already in use elsewhere. Pick a different one.';
    },
  },
  {
    match: e => e.code === '23503',
    text: () => 'This references something that doesn\'t exist or was removed. Refresh and try again.',
  },
  {
    match: e => e.code === '23502',
    text: e => {
      const m = /column "(.+?)"/.exec(e.message || '');
      const col = m?.[1]?.replace(/_/g, ' ');
      return col ? `Missing required field: ${col}.` : 'A required field is missing.';
    },
  },
  {
    match: e => e.code === '23514',
    text: () => 'That value is out of the allowed range. Double-check the form.',
  },
  {
    match: e => e.code === '22001',
    text: () => 'One of the fields is too long. Shorten it and try again.',
  },
  {
    match: e => e.code === '22007' || e.code === '22008',
    text: () => 'That date or time isn\'t in a recognized format.',
  },
  {
    match: e => e.code === '42501',
    text: () => 'You don\'t have permission to do that.',
  },
  {
    match: e => e.code === 'P0001',
    // Custom CHECK / RAISE EXCEPTION from a trigger or RPC — message
    // is usually intentional and safe to show.
    text: e => e.message || 'That change isn\'t allowed.',
  },
  {
    match: e => e.code === 'PGRST301',
    text: () => 'Your session expired. Sign in again.',
  },
];

/**
 * Translate a Supabase/PostgREST error into a user-friendly sentence.
 * When no mapping applies, returns the original error message or a
 * generic fallback.
 */
export function friendlyPgError(err: PgLikeError | null | undefined, fallback = 'Something went wrong. Try again.'): string {
  if (!err) return fallback;
  for (const entry of MAP) {
    if (entry.match(err)) return entry.text(err);
  }
  return err.message || fallback;
}
