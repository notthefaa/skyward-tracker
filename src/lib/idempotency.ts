import { NextResponse } from 'next/server';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side idempotency check for POST routes.
 *
 * Usage in a route handler:
 *   const idem = idempotency(supabaseAdmin, user.id, req, 'squawks/POST');
 *   const cached = await idem.check();
 *   if (cached) return cached;        // repeat request → cached response
 *   // ... do the work ...
 *   await idem.save(200, responseBody);
 *
 * The client generates a UUID per form submission and sends it via the
 * X-Idempotency-Key header. If no header is present, idempotency is
 * skipped silently (backward compat with older clients / curl).
 *
 * Keys are stored in aft_idempotency_keys with a 1-hour retention.
 * Lazy cleanup happens on every check call (deletes expired rows).
 */

const RETENTION_MS = 60 * 60 * 1000; // 1 hour

// PGRST205 = "Could not find the table in the schema cache" — fired by
// PostgREST when the table is genuinely missing OR the schema cache is
// stale post-migration. Either way, every POST in the app inherits the
// failure (20+ routes use this helper). A missing cache table makes
// dedup impossible but shouldn't 500 the user-facing action — the
// underlying work is fine to do, we just can't remember the response.
// Fail-soft: log loudly so ops sees it, return as if the cache is
// absent. We do NOT extend this to other PostgREST codes; transient
// blips should still fail-closed so a network hiccup doesn't quietly
// produce duplicate writes.
function isSchemaCacheMiss(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as PostgrestError).code === 'PGRST205'
  );
}

export function idempotency(
  sb: SupabaseClient,
  userId: string,
  req: Request,
  route: string,
) {
  const key = req.headers.get('x-idempotency-key');

  return {
    /** If a cached response exists for this key, return it. Otherwise null. */
    async check(): Promise<NextResponse | null> {
      if (!key) return null;

      // Lazy cleanup — prune expired keys so the table doesn't grow.
      // Non-blocking: if the delete fails, the check still proceeds.
      sb.from('aft_idempotency_keys')
        .delete()
        .lt('created_at', new Date(Date.now() - RETENTION_MS).toISOString())
        .then(() => {});

      // Scope the lookup to route too — a client reusing the same
      // key across /api/oil-logs and /api/batch-submit (via different
      // code paths) would otherwise cross-cache-hit and return the
      // wrong response shape. See migration 043.
      //
      // Throw on read error rather than silently treating a transient
      // supabase blip as a cache miss — every POST route using this
      // helper inherits the fail-open bypass otherwise, and a network
      // hiccup turns one user submission into two committed writes.
      // Exception: PGRST205 (table missing or schema cache stale) is
      // misconfiguration, not transient — handled in isSchemaCacheMiss.
      const { data, error } = await sb
        .from('aft_idempotency_keys')
        .select('response_status, response_body')
        .eq('user_id', userId)
        .eq('key', key)
        .eq('route', route)
        .maybeSingle();
      if (error) {
        if (isSchemaCacheMiss(error)) {
          console.error(
            `[idempotency] aft_idempotency_keys schema cache miss on check (route=${route}); proceeding without dedup. Apply migration 028 + reload PostgREST schema cache.`,
          );
          return null;
        }
        throw error;
      }

      if (data) {
        return NextResponse.json(data.response_body, {
          status: data.response_status,
          headers: { 'X-Idempotent-Replay': 'true' },
        });
      }
      return null;
    },

    /** Cache the response for this key so future repeats get it. */
    async save(status: number, body: any): Promise<void> {
      if (!key) return;
      // Bubble cache-write failures so a silently-lost upsert can't
      // produce a duplicate write on the next retry. Same PGRST205
      // carve-out as check(): missing table → log + swallow, since
      // throwing here would mask successful work (the route already
      // did its primary side-effect before save() runs).
      const { error } = await sb
        .from('aft_idempotency_keys')
        .upsert(
          {
            user_id: userId,
            key,
            route,
            response_status: status,
            response_body: body,
          },
          { onConflict: 'user_id,key,route' },
        );
      if (error) {
        if (isSchemaCacheMiss(error)) {
          console.error(
            `[idempotency] aft_idempotency_keys schema cache miss on save (route=${route}); response not cached. Apply migration 028 + reload PostgREST schema cache.`,
          );
          return;
        }
        throw error;
      }
    },
  };
}
