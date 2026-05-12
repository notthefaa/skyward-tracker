"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import { useToast } from "@/components/ToastProvider";

/**
 * Watches the active aircraft's documents and surfaces a toast when a
 * `status='processing'` row flips to `'ready'` or `'error'`.
 *
 * The document upload route returns immediately after the row insert
 * and runs the parse + embed work inside Next's `after()` block. The
 * user is free to navigate around the app while that's happening; this
 * hook (mounted in AppShell) is what tells them when it's done.
 *
 * Implementation:
 * - Shares the same SWR key as DocumentsTab so when the tab is open
 *   both subscribers get a single fetch and mutate() calls from the
 *   tab propagate here too.
 * - `refreshInterval` is dynamic: poll every 8 s while any row is
 *   `'processing'`, otherwise idle. SWR's revalidate-on-focus also
 *   gives a free refresh when the user returns to the tab.
 * - Tracks seen statuses in a Map keyed by `${aircraftId}:${docId}`
 *   so an aircraft switch doesn't reset state (entries auto-stale
 *   for other tails because the SWR fetch returns only the current
 *   tail's docs). This also avoids mutating a ref during render —
 *   the previous shape did `if (lastAircraftId.current !== aircraftId) reset()`
 *   inline in the function body, which is unsafe under React 19
 *   StrictMode double-invoke.
 * - A module-level `pendingUploads` Set lets the upload sites
 *   (DocumentsTab + AircraftModal) register newly-inserted doc IDs
 *   so a very fast `processing → ready` transition (small PDF, fast
 *   embed) still produces a toast — without this, the watcher's
 *   first-sighting-silencing rule would swallow it.
 */

type DocRow = { id: string; filename: string; status: string; created_at?: string; last_error_reason?: string | null };

// Module-level set of doc IDs whose first sighting should toast even
// if the status is already terminal. Populated by the upload sites
// right after `POST /api/documents` returns the new doc.id. The
// watcher drains entries when it consumes them.
const pendingUploads = new Set<string>();

/**
 * Pick a polling interval based on the oldest `processing` row's age.
 * Tight 8 s while indexing is fresh (the common case — most embeds
 * finish under 60 s); back off to 15 s and 30 s for outliers so the
 * watcher doesn't burn cellular data on a row that's already past
 * its expected completion time. `0` disables polling entirely (SWR
 * will resume on the next focus event or upload-triggered mutate).
 */
function pollIntervalFor(docs: DocRow[]): number {
  const now = Date.now();
  let oldestProcessingAgeMs = 0;
  for (const d of docs) {
    if (d.status !== 'processing' || !d.created_at) continue;
    const age = now - Date.parse(d.created_at);
    if (Number.isFinite(age) && age > oldestProcessingAgeMs) oldestProcessingAgeMs = age;
  }
  if (oldestProcessingAgeMs === 0) {
    // Either no processing row, or no created_at on any (older rows
    // pre-dated this column). Fall back to 8 s if any processing row
    // exists, else idle.
    return docs.some(d => d.status === 'processing') ? 8_000 : 0;
  }
  if (oldestProcessingAgeMs < 60_000) return 8_000;
  if (oldestProcessingAgeMs < 5 * 60_000) return 15_000;
  return 30_000;
}

export function registerPendingUpload(docId: string): void {
  if (docId) pendingUploads.add(docId);
}

export function useDocStatusWatcher(aircraftId: string | null | undefined): void {
  const { showSuccess, showError } = useToast();
  // Keys: `${aircraftId}:${docId}`. Persists across aircraft switches
  // so we don't accidentally re-record (and silence) docs we already
  // observed on a prior visit. Map grows O(unique docs seen this
  // session) — negligible.
  const seenStatuses = useRef<Map<string, string>>(new Map());

  const { data } = useSWR<{ documents: DocRow[] } | null>(
    aircraftId ? swrKeys.docs(aircraftId) : null,
    async () => {
      const res = await authFetch(`/api/documents?aircraftId=${aircraftId}`);
      if (!res.ok) throw new Error('docs fetch failed');
      return await res.json();
    },
    {
      // Poll while any row is `'processing'`, with adaptive cadence:
      // 8 s for the first minute (the common case where the embed is
      // about to finish), 15 s for minutes 1-5, 30 s after. When idle
      // refreshInterval=0 disables polling; an upload-triggered
      // mutate() from DocumentsTab repopulates the cache and the
      // watcher resumes.
      refreshInterval: (latest) => pollIntervalFor(latest?.documents || []),
      revalidateOnFocus: true,
      // Don't dedupe — each scheduled tick must actually hit the
      // server so status transitions surface quickly.
      dedupingInterval: 0,
    },
  );

  useEffect(() => {
    if (!aircraftId) return;
    const docs = data?.documents || [];
    // Prune seenStatuses entries for this aircraft whose docId no
    // longer appears in the current list — without this the map
    // grows by deleted/replaced docs over a long session. Entries
    // for OTHER aircraft are preserved (we only own the
    // `${aircraftId}:*` slice).
    const liveKeys = new Set(docs.map((d) => `${aircraftId}:${d.id}`));
    const prefix = `${aircraftId}:`;
    for (const k of Array.from(seenStatuses.current.keys())) {
      if (k.startsWith(prefix) && !liveKeys.has(k)) {
        seenStatuses.current.delete(k);
      }
    }
    for (const doc of docs) {
      const key = `${aircraftId}:${doc.id}`;
      const prev = seenStatuses.current.get(key);
      const isPending = pendingUploads.has(doc.id);

      // Compose a specific error message when last_error_reason is
      // populated (migration 065+). Falls back to the generic toast
      // for older rows / when the column is null.
      const errorToast = (filename: string, reason?: string | null) =>
        reason
          ? `Couldn't index "${filename}" — ${reason}`
          : `Couldn't index "${filename}". Try uploading again.`;

      if (prev === undefined) {
        // First sighting in this session.
        // If the upload site registered this id as pending and the
        // first sighting is already terminal, toast — the user just
        // submitted it, they deserve to hear the outcome even though
        // we never observed the 'processing' state.
        if (isPending) {
          pendingUploads.delete(doc.id);
          if (doc.status === 'ready') {
            showSuccess(`"${doc.filename}" is indexed and searchable. Howard can reference it now.`);
          } else if (doc.status === 'error') {
            showError(errorToast(doc.filename, doc.last_error_reason));
          }
          // For 'processing', fall through to the normal recording
          // path — we'll catch the transition on a subsequent poll.
        }
        seenStatuses.current.set(key, doc.status);
        continue;
      }

      if (prev === doc.status) continue;

      // Status transition. Only toast on the 'processing' → terminal
      // transitions — other transitions aren't produced by the upload
      // flow and would be confusing.
      if (prev === 'processing' && doc.status === 'ready') {
        pendingUploads.delete(doc.id);
        showSuccess(`"${doc.filename}" is indexed and searchable. Howard can reference it now.`);
      } else if (prev === 'processing' && doc.status === 'error') {
        pendingUploads.delete(doc.id);
        showError(errorToast(doc.filename, doc.last_error_reason));
      }
      seenStatuses.current.set(key, doc.status);
    }
  }, [data, aircraftId, showSuccess, showError]);
}
