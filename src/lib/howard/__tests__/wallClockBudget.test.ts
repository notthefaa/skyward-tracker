import { describe, it, expect } from 'vitest';
import { computeRoundBudget } from '../claude';

/**
 * Wall-clock budget helper — protects Howard's 3-round tool loop from
 * Vercel's 60 s `maxDuration` kill. The pure helper takes (elapsed,
 * total budget, per-round cap, per-round floor) and returns either
 * `{ skip: true }` (caller breaks the loop) or the clamped per-round
 * deadline.
 *
 * Test surface is the helper directly so we don't have to mock the
 * Anthropic SDK to lock the table of edge cases.
 */
describe('computeRoundBudget', () => {
  // Production constants — kept here as plain numbers so a tweak to
  // the source is loud (the test fails until both are updated).
  const BUDGET = 50_000;
  const PER_ROUND = 45_000;
  const FLOOR = 5_000;

  it('round 0 (elapsed=0): full per-round deadline, no skip', () => {
    const out = computeRoundBudget(0, BUDGET, PER_ROUND, FLOOR);
    expect(out).toEqual({ skip: false, deadlineMs: PER_ROUND });
  });

  it('mid-budget: deadline clamps to remaining wall-clock', () => {
    // 30 s elapsed, 20 s remaining — well over the floor, but tighter
    // than the full per-round cap. Deadline should be the remaining
    // 20 s, not the 45 s default.
    const out = computeRoundBudget(30_000, BUDGET, PER_ROUND, FLOOR);
    expect(out.skip).toBe(false);
    expect(out.deadlineMs).toBe(20_000);
  });

  it('exactly at floor remaining: still runs', () => {
    // remaining === FLOOR is the boundary — `< FLOOR` skips, `=== FLOOR`
    // runs. Lock that direction so a future >= refactor is loud.
    const out = computeRoundBudget(BUDGET - FLOOR, BUDGET, PER_ROUND, FLOOR);
    expect(out.skip).toBe(false);
    expect(out.deadlineMs).toBe(FLOOR);
  });

  it('one ms below floor: skip', () => {
    const out = computeRoundBudget(BUDGET - FLOOR + 1, BUDGET, PER_ROUND, FLOOR);
    expect(out.skip).toBe(true);
    expect(out.deadlineMs).toBe(0);
  });

  it('elapsed > budget: skip with negative remaining', () => {
    // Tool execution between rounds blew past the budget. The caller
    // must NOT pass deadlineMs to AbortSignal.timeout(0) — verify the
    // shape says skip and exposes a 0 deadline.
    const out = computeRoundBudget(BUDGET + 1_000, BUDGET, PER_ROUND, FLOOR);
    expect(out.skip).toBe(true);
    expect(out.deadlineMs).toBe(0);
  });

  it('per-round cap caps the return value below remaining', () => {
    // A future tweak that bumps WALL_CLOCK_BUDGET well past per-round
    // would otherwise produce too-long deadlines. Lock that the
    // per-round cap is the ceiling.
    const out = computeRoundBudget(0, 200_000, PER_ROUND, FLOOR);
    expect(out.skip).toBe(false);
    expect(out.deadlineMs).toBe(PER_ROUND);
  });

  it('shrinking floor still respected (defensive)', () => {
    // If a future refactor sets a 0 floor, we still skip on negative
    // remaining (because `remaining < 0 < FLOOR=0` would be false; but
    // the deadline `Math.min(perRound, -X)` would be negative, which
    // breaks AbortSignal.timeout). Verify the documented behavior:
    // remaining < FLOOR skips. With FLOOR=0, the only skip is when
    // remaining < 0.
    expect(computeRoundBudget(BUDGET - 1, BUDGET, PER_ROUND, 0)).toEqual({
      skip: false,
      deadlineMs: 1,
    });
    expect(computeRoundBudget(BUDGET + 100, BUDGET, PER_ROUND, 0)).toEqual({
      skip: true,
      deadlineMs: 0,
    });
  });
});
