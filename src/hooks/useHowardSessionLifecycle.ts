"use client";

import { useEffect, useRef } from "react";
import useSWR, { type ScopedMutator } from "swr";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import { clearPersistedSwrCache } from "@/lib/swrCache";
import { HOWARD_STALE_MS } from "@/lib/howard/quickPrompts";

// Howard thread lifecycle, all on the AppShell:
//   • Fresh sign-in clears the prior user's Howard thread so a new
//     pilot on the same device opens to a blank conversation.
//   • Spurious SIGNED_IN events (iOS token-refresh-after-resume) are
//     ignored — without the same-user guard we'd nuke the chat every
//     time the user flipped to another app and back.
//   • SIGNED_OUT wipes every cached query (in-memory + localStorage)
//     so the next user can't hydrate the previous user's notes /
//     squawks / aircraft.
//   • Idle wipe: when Howard's last interaction is older than
//     HOWARD_STALE_MS, drop the thread so the pilot isn't picking up
//     a cold conversation they've forgotten.
//   • Visibility refetch: after 5+ min hidden, re-fetch the thread so
//     the stale-check runs against fresh server state rather than
//     stale cache.
export function useHowardSessionLifecycle({
  session,
  globalMutate,
}: {
  session: any;
  globalMutate: ScopedMutator;
}) {
  // The userId-tracking ref distinguishes:
  //   prev === null + SIGNED_IN  → fresh sign-in or initial mount → wipe
  //   prev !== null + SIGNED_IN same user → session refresh → SKIP
  //   prev !== null + SIGNED_IN different user → user-switch on shared
  //                              device → wipe (SIGNED_OUT also fired
  //                              just before, so this is belt+suspenders)
  const lastSignedInUserIdRef = useRef<string | null>(null);
  // Seed the ref from the current session BEFORE the auth listener
  // mounts. If we don't, the first SIGNED_IN (which can be a spurious
  // post-resume token refresh, NOT a fresh login) sees prev=null and
  // mistakes itself for a new login → nukes the thread. Page-reload
  // sessions arrive via INITIAL_SESSION, which we also seed below.
  useEffect(() => {
    if (session?.user?.id && lastSignedInUserIdRef.current === null) {
      lastSignedInUserIdRef.current = session.user.id;
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (event === 'SIGNED_OUT') {
        // Wipe every cached query so the next user on a shared device
        // doesn't hydrate the previous user's notes / squawks / aircraft
        // from localStorage. globalMutate(() => true, ..., false) clears
        // the in-memory SWR map; clearPersistedSwrCache() drops the
        // localStorage blob so the next page load starts cold.
        lastSignedInUserIdRef.current = null;
        globalMutate(() => true, undefined, { revalidate: false });
        clearPersistedSwrCache();
        return;
      }
      // INITIAL_SESSION fires on app boot with an existing token. Use
      // it to seed the ref so the next SIGNED_IN (which iOS may fire
      // on token-refresh-after-resume) compares against a real user
      // id, not null.
      if (event === 'INITIAL_SESSION') {
        if (sess?.user?.id) lastSignedInUserIdRef.current = sess.user.id;
        return;
      }
      if (event !== 'SIGNED_IN' || !sess?.user?.id) return;
      const newUserId = sess.user.id;
      const prevUserId = lastSignedInUserIdRef.current;
      // Spurious SIGNED_IN for the user who's already in the session.
      // iOS Safari fires this on token-refresh-after-resume, even when
      // the user has been signed in continuously. Treat as no-op.
      if (prevUserId === newUserId) return;
      lastSignedInUserIdRef.current = newUserId;
      try {
        await authFetch('/api/howard', { method: 'DELETE' });
      } catch {
        // Non-blocking — the client-side cache flush below still happens.
      }
      globalMutate(swrKeys.howardUser(newUserId), { thread: null, messages: [] }, { revalidate: true });
    });
    return () => subscription.unsubscribe();
  }, [globalMutate]);

  // Subscribe to Howard's thread cache (SWR dedupes with the launcher
  // and tab subscriptions — one request across all surfaces).
  const howardUserId = session?.user?.id;
  const { data: howardData, mutate: mutateHoward } = useSWR(
    howardUserId ? swrKeys.howardUser(howardUserId) : null,
    async () => {
      const res = await authFetch('/api/howard');
      // /api/howard returns 200 + { thread: null, messages: [] } for
      // users who have never chatted with Howard — so a !res.ok here
      // is a real failure, not "no history yet." Throw so SWR retries
      // instead of pinning an empty thread in cache.
      if (!res.ok) throw new Error("Couldn't load Howard");
      return await res.json() as { thread: any; messages: any[] };
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  useEffect(() => {
    if (!howardUserId || !howardData?.messages?.length) return;
    const msgs = howardData.messages;
    const lastMs = new Date(msgs[msgs.length - 1].created_at).getTime();
    const updatedMs = howardData.thread?.updated_at
      ? new Date(howardData.thread.updated_at).getTime()
      : 0;
    const lastActive = Math.max(lastMs, updatedMs);
    if (!Number.isFinite(lastActive) || lastActive === 0) return;
    if (Date.now() - lastActive <= HOWARD_STALE_MS) return;

    (async () => {
      try { await authFetch('/api/howard', { method: 'DELETE' }); } catch {}
      globalMutate(swrKeys.howardUser(howardUserId), { thread: null, messages: [] }, false);
    })();
  }, [howardData, howardUserId, globalMutate]);

  // Visibility re-sync: after 5+ min hidden, re-fetch the thread so
  // the stale-check runs against fresh server state rather than stale
  // cache. Threshold is 30 min; poll after 5 min of hidden to give
  // the boundary cases a chance.
  useEffect(() => {
    if (!howardUserId) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        mutateHoward();
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [howardUserId, mutateHoward]);
}
