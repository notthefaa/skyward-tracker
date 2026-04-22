import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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

      const { data } = await sb
        .from('aft_idempotency_keys')
        .select('response_status, response_body')
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle();

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
      await sb
        .from('aft_idempotency_keys')
        .upsert(
          {
            user_id: userId,
            key,
            route,
            response_status: status,
            response_body: body,
          },
          { onConflict: 'user_id,key' },
        )
        .then(() => {});
    },
  };
}
