import { describe, it, expect } from 'vitest';
import { apiOk, apiError } from '../apiResponse';

describe('apiOk', () => {
  it('emits { ok: true, data }', async () => {
    const res = apiOk({ tail: 'N205WH', total: 1234.5 });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { tail: 'N205WH', total: 1234.5 } });
  });

  it('honors a custom status (e.g. 201 for create)', async () => {
    const res = apiOk({ id: 'abc' }, 201);
    expect(res.status).toBe(201);
  });
});

describe('apiError', () => {
  it('emits { ok: false, error } and defaults to 400', async () => {
    const res = apiError('Tail already in use');
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Tail already in use');
    expect(body.requestId).toBeUndefined();
  });

  it('honors an explicit status', async () => {
    const res = apiError('Not found', 404);
    expect(res.status).toBe(404);
  });

  it('includes requestId in body + x-request-id header when a request is supplied', async () => {
    const req = new Request('https://example.com/api/whatever', {
      headers: { 'x-request-id': 'req-abc-123' },
    });
    const res = apiError('Boom', 500, req);
    const body = await res.json();
    expect(body.requestId).toBe('req-abc-123');
    expect(res.headers.get('x-request-id')).toBe('req-abc-123');
  });

  it('generates a request ID when the request has none', async () => {
    const req = new Request('https://example.com/api/whatever');
    const res = apiError('Boom', 500, req);
    const body = await res.json();
    expect(body.requestId).toBeTypeOf('string');
    expect((body.requestId as string).length).toBeGreaterThan(10);
  });
});
