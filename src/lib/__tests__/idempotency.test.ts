import { describe, it, expect, vi } from 'vitest';
import { idempotency } from '../idempotency';

// Minimal SupabaseClient stub. Only the .from(...).select / upsert / etc.
// chain is exercised, so we mirror just that surface and let the tests
// inject whatever shape they need per call.
function buildClient(opts: {
  selectResult?: { data: any; error: any };
  upsertResult?: { error: any };
}) {
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(
      opts.selectResult ?? { data: null, error: null },
    ),
  };
  const deleteChain = {
    lt: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue(selectChain),
      delete: vi.fn().mockReturnValue(deleteChain),
      upsert: vi.fn().mockResolvedValue(opts.upsertResult ?? { error: null }),
    })),
  } as any;
}

function buildRequest(idempotencyKey?: string): Request {
  const headers = new Headers();
  if (idempotencyKey) headers.set('x-idempotency-key', idempotencyKey);
  return new Request('https://example.test/api/anything', { method: 'POST', headers });
}

describe('idempotency.check', () => {
  it('returns null and skips DB when no idempotency key header', async () => {
    const sb = buildClient({});
    const idem = idempotency(sb, 'user-1', buildRequest(), 'route/POST');
    const result = await idem.check();
    expect(result).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('returns null on cache miss (no row found)', async () => {
    const sb = buildClient({ selectResult: { data: null, error: null } });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    const result = await idem.check();
    expect(result).toBeNull();
  });

  it('returns cached NextResponse when row exists', async () => {
    const sb = buildClient({
      selectResult: {
        data: { response_status: 200, response_body: { ok: true } },
        error: null,
      },
    });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    const result = await idem.check();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
    expect(result!.headers.get('X-Idempotent-Replay')).toBe('true');
  });

  it('throws on transient PostgrestError so the route fails closed', async () => {
    const sb = buildClient({
      selectResult: { data: null, error: { code: 'PGRST116', message: 'transient' } },
    });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    await expect(idem.check()).rejects.toMatchObject({ code: 'PGRST116' });
  });

  it('fails-soft on PGRST205 (schema cache miss / missing table)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sb = buildClient({
      selectResult: {
        data: null,
        error: { code: 'PGRST205', message: 'Could not find the table' },
      },
    });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    const result = await idem.check();
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema cache miss on check'),
    );
    errSpy.mockRestore();
  });
});

describe('idempotency.save', () => {
  it('skips DB when no idempotency key header', async () => {
    const sb = buildClient({});
    const idem = idempotency(sb, 'user-1', buildRequest(), 'route/POST');
    await idem.save(200, { ok: true });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('throws on transient upsert error so the caller knows the cache write was lost', async () => {
    const sb = buildClient({
      upsertResult: { error: { code: '23505', message: 'duplicate' } },
    });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    await expect(idem.save(200, { ok: true })).rejects.toMatchObject({ code: '23505' });
  });

  it('fails-soft on PGRST205 — primary work already done, log + swallow', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sb = buildClient({
      upsertResult: {
        error: { code: 'PGRST205', message: 'Could not find the table' },
      },
    });
    const idem = idempotency(sb, 'user-1', buildRequest('key-1'), 'route/POST');
    await expect(idem.save(200, { ok: true })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema cache miss on save'),
    );
    errSpy.mockRestore();
  });
});
