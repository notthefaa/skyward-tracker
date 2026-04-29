import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// iOS PWA resume hazard: Safari suspends in-flight fetches when the
// app backgrounds and doesn't always finalize them on resume — the
// promise hangs forever, the supabase client has no timeout of its
// own, and every per-aircraft tab fetcher waits on a dead socket.
// Wrap the global fetch so REST calls abort after FETCH_TIMEOUT_MS
// and SWR can fall through to its retry path. Storage uploads keep
// their natural deadline since multi-MB uploads on a slow link can
// legitimately exceed the REST budget.
const FETCH_TIMEOUT_MS = 15_000;

const isStorageUrl = (url: string) => url.includes('/storage/v1/object/');

const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (isStorageUrl(url)) return fetch(input, init);

  const controller = new AbortController();
  // Forward an upstream abort signal — authFetch / SWR can cancel
  // through their own AbortController and we shouldn't strand the
  // request when they do.
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException('supabase_fetch_timeout', 'TimeoutError')), FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});
