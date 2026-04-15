const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const userRequests = new Map<string, number[]>();

export function checkRateLimit(userId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const timestamps = (userRequests.get(userId) || []).filter(t => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0];
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }

  timestamps.push(now);
  userRequests.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
