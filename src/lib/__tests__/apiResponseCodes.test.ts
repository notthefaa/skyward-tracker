import { describe, it, expect } from 'vitest';
import { apiErrorCoded, handleCodedError, CodedError } from '../apiResponse';

describe('apiErrorCoded', () => {
  it('emits { ok: false, code, error, status }', async () => {
    const res = apiErrorCoded('AIRCRAFT_ID_REQUIRED', 'Aircraft ID required.', 400);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('AIRCRAFT_ID_REQUIRED');
    expect(body.error).toBe('Aircraft ID required.');
  });

  it('stamps requestId when a request is supplied', async () => {
    const req = new Request('https://example.com/api/x', {
      headers: { 'x-request-id': 'abc-123' },
    });
    const res = apiErrorCoded('INTERNAL_ERROR', 'boom', 500, req);
    const body = await res.json();
    expect(body.requestId).toBe('abc-123');
    expect(res.headers.get('x-request-id')).toBe('abc-123');
  });
});

describe('handleCodedError', () => {
  it('forwards CodedError as-is', async () => {
    const res = handleCodedError(new CodedError('SQUAWK_NOT_FOUND', 'Squawk not found.', 404));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('SQUAWK_NOT_FOUND');
    expect(body.error).toBe('Squawk not found.');
  });

  it('maps 401 auth errors to UNAUTHENTICATED', async () => {
    const res = handleCodedError({ status: 401, message: 'No token' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('maps 403 aircraft-access errors to NO_AIRCRAFT_ACCESS', async () => {
    const res = handleCodedError({ status: 403, message: 'You do not have access to this aircraft.' });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('NO_AIRCRAFT_ACCESS');
  });

  it('maps 403 admin-required errors to NO_ADMIN_ACCESS', async () => {
    const res = handleCodedError({ status: 403, message: 'This action requires aircraft admin privileges.' });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('NO_ADMIN_ACCESS');
  });

  it('falls back to INTERNAL_ERROR for unknown throws', async () => {
    const res = handleCodedError(new Error('boom'));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
