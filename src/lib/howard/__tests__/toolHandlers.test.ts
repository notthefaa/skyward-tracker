import { describe, it, expect } from 'vitest';
import { capResultSize } from '../toolHandlers';

describe('capResultSize', () => {
  it('returns the result unchanged when under the size cap', () => {
    const small = { items: [{ a: 1 }, { a: 2 }], note: 'ok' };
    expect(capResultSize(small)).toEqual(small);
  });

  it('returns primitives and null unchanged', () => {
    expect(capResultSize(null)).toBe(null);
    expect(capResultSize('string')).toBe('string');
    expect(capResultSize(42)).toBe(42);
  });

  it('halves the largest array when the serialized result exceeds the cap', () => {
    // Each entry is ~80 chars; 2000 entries ≈ 160 KB, well over 40 KB.
    const bigArray = Array.from({ length: 2000 }, (_, i) => ({
      id: `item-${i}`,
      description: 'x'.repeat(60),
    }));
    const result = capResultSize({ items: bigArray, meta: { source: 'test' } });
    expect(result.items.length).toBeLessThan(bigArray.length);
    expect(result._truncated).toBeDefined();
    // After trimming: returned_count must equal the array's actual
    // length, and original_count must be strictly larger (the function
    // records the pre-trim length at the iteration it fired, which may
    // not be the very first length if multiple halvings run).
    expect(result._truncated.items.returned_count).toBe(result.items.length);
    expect(result._truncated.items.original_count).toBeGreaterThan(result.items.length);
    expect(result.meta).toEqual({ source: 'test' });
  });

  it('keeps at least 3 entries even when trimming', () => {
    const bigArray = Array.from({ length: 500 }, (_, i) => ({
      id: `item-${i}`,
      payload: 'y'.repeat(200),
    }));
    const result = capResultSize({ items: bigArray });
    expect(result.items.length).toBeGreaterThanOrEqual(3);
  });

  it('stops trimming once the result fits', () => {
    // 200 entries × ~60 chars ≈ 12 KB — already under cap.
    const borderlineArray = Array.from({ length: 200 }, (_, i) => ({ id: i, x: 'ok' }));
    const result = capResultSize({ items: borderlineArray });
    expect(result.items.length).toBe(200);
    expect(result._truncated).toBeUndefined();
  });

  it('prefers the largest array when multiple are present', () => {
    const small = Array.from({ length: 10 }, (_, i) => ({ i }));
    const huge = Array.from({ length: 2000 }, (_, i) => ({ i, body: 'z'.repeat(60) }));
    const result = capResultSize({ small, huge });
    expect(result.small.length).toBe(10);
    expect(result.huge.length).toBeLessThan(2000);
    expect(result._truncated.huge).toBeDefined();
    expect(result._truncated.small).toBeUndefined();
  });
});
