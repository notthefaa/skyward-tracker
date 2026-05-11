import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools';
import { executeTool } from './toolHandlers';
import { HOWARD_STABLE_PRELUDE, HOWARD_ONBOARDING_APPENDIX, buildUserContext } from './systemPrompt';
import type { Aircraft } from '@/lib/types';
import type { HowardMessage } from './types';
import type { OilConsumptionStatus } from '@/lib/oilConsumption';
import type { SupabaseClient } from '@supabase/supabase-js';

const client = new Anthropic();

// Haiku 4.5 — fast, cheap, and naturally concise. Handles tool use
// well and matches Howard's "short, conversational" register much better
// than Sonnet, which tended to produce report-style replies.
export const HOWARD_MODEL = 'claude-haiku-4-5-20251001';
// 500 was too tight — flight briefings (weather + NOTAMs + hazards +
// bottom-line) were getting cut off mid-sentence. 2000 leaves room
// for substantive briefings without changing the "1–3 sentence"
// default register (Howard still trends short; the cap just stops
// truncating when he genuinely needs more).
const MAX_OUTPUT_TOKENS = 2000;
const MAX_TOOL_ROUNDS = 3;
const CONTEXT_WINDOW = 10;
// Hard cap per Anthropic round — if the stream never emits or finishes
// by this deadline, we abort cleanly and let the caller surface a
// timeout message. 45s is comfortably longer than a normal round
// (typically 2–15s incl. tool use) but well under Vercel's 60s
// maxDuration so a stalled round doesn't steal the whole response.
const STREAM_DEADLINE_MS = 45_000;
// Wall-clock budget across all rounds + tool calls. Vercel's
// `maxDuration=60s` will hard-kill the function — at which point the
// SSE stream just dies mid-message and the user sees an empty Howard
// reply. We bail proactively at 50s so there are 10s of slack left for
// the assistant-message DB write + final SSE flush + close. The
// per-round deadline is also clamped to whatever wall-clock remains,
// so a slow round-1 + slow round-2 can't combine to trip the platform
// kill before our own AbortSignal fires.
const WALL_CLOCK_BUDGET_MS = 50_000;
// Don't even start a new round with less than this much budget left —
// a 4 s round is basically guaranteed to stall mid-tool-call, and the
// "I'll just barely make it" attempt usually ends up in the platform-
// kill path anyway. Better to surface "wrapped up early" cleanly.
const PER_ROUND_FLOOR_MS = 5_000;

/**
 * Pure helper for the wall-clock budget logic. Exported so the unit
 * suite can pin the table of (elapsed, budget, perRound, floor) →
 * (skip, deadline) without spinning up the Anthropic stream.
 *
 *   - `skip: true` → caller should break out of the round loop and
 *     yield a `complete` with whatever text streamed so far + a
 *     "wrapped up early" suffix.
 *   - `skip: false` → caller starts the round with `deadlineMs` as
 *     the AbortSignal timeout. `deadlineMs` is min(perRound, remaining)
 *     so a barely-enough budget produces a tight per-round cap rather
 *     than a normal-length round that overshoots into the platform kill.
 */
export function computeRoundBudget(
  elapsedMs: number,
  wallClockBudgetMs: number,
  perRoundMs: number,
  perRoundFloorMs: number,
): { skip: boolean; deadlineMs: number } {
  const remaining = wallClockBudgetMs - elapsedMs;
  if (remaining < perRoundFloorMs) return { skip: true, deadlineMs: 0 };
  return { skip: false, deadlineMs: Math.min(perRoundMs, remaining) };
}

export interface HowardUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_end'; id: string; name: string }
  | {
      type: 'complete';
      assistantText: string;
      toolCalls: any[] | null;
      toolResults: any[] | null;
      usage: HowardUsage;
    };

export async function* sendMessageStream(
  userText: string,
  conversationHistory: HowardMessage[],
  userAircraft: Aircraft[],
  currentAircraft: Aircraft | null,
  userRole: string,
  faaRatings: string[],
  pilotInitials: string,
  pilotFullName: string,
  timeZone: string,
  userId: string,
  threadId: string,
  supabaseAdmin: SupabaseClient,
  onboardingMode = false,
  switchedFromTail: string | null = null,
  aircraftRole: string | null = null,
  oilConsumption: OilConsumptionStatus | null = null,
): AsyncGenerator<StreamEvent, void, unknown> {
  // Two-block system prompt: stable prelude is prompt-cached, user context
  // (fleet + currently-selected aircraft + ratings + "now" + initials) is
  // a per-request delta. Aircraft for each tool call is resolved
  // server-side from a `tail` param Howard provides.
  const userContext = buildUserContext(
    userAircraft,
    currentAircraft,
    userRole,
    faaRatings,
    pilotInitials,
    pilotFullName,
    timeZone,
    new Date(),
    switchedFromTail,
    aircraftRole,
    oilConsumption,
  );

  const toolCtx = {
    userId,
    threadId,
    aircraftId: '',
    aircraftTail: '',
    currentTail: currentAircraft?.tail_number || null,
  };

  const messages: Anthropic.MessageParam[] = conversationHistory
    .slice(-CONTEXT_WINDOW)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  messages.push({ role: 'user', content: userText });

  const allToolCalls: any[] = [];
  const allToolResults: any[] = [];
  const totalUsage: HowardUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let assistantText = '';
  let bailedForTime = false;
  const startTime = Date.now();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Wall-clock check BEFORE building the round. Two slow rounds can
    // chain to ~80s+ of compute even if neither one trips its 45s cap
    // alone — Vercel's 60s kill fires first and the user gets nothing.
    // computeRoundBudget either skips the round (we yield 'complete'
    // with the partial text and a "wrapped up early" suffix) or returns
    // a per-round deadline clamped to the lesser of STREAM_DEADLINE_MS
    // and whatever wall-clock remains.
    const elapsedMs = Date.now() - startTime;
    const { skip, deadlineMs } = computeRoundBudget(
      elapsedMs,
      WALL_CLOCK_BUDGET_MS,
      STREAM_DEADLINE_MS,
      PER_ROUND_FLOOR_MS,
    );
    if (skip) {
      bailedForTime = true;
      break;
    }
    const roundAbort = AbortSignal.timeout(deadlineMs);

    // Force text-only on the final iteration. Without this, if the
    // model chose to call tools on the last round we'd have nowhere
    // to send the results — Claude returns tool_use blocks, we have
    // no further round, and the user sees "I hit a processing limit"
    // instead of an actual reply.
    const isFinalRound = round === MAX_TOOL_ROUNDS - 1;

    const stream = client.messages.stream(
      {
        model: HOWARD_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [
          { type: 'text', text: HOWARD_STABLE_PRELUDE, cache_control: { type: 'ephemeral' } },
          ...(onboardingMode ? [{ type: 'text' as const, text: HOWARD_ONBOARDING_APPENDIX }] : []),
          { type: 'text', text: userContext },
        ],
        tools,
        messages,
        ...(isFinalRound ? { tool_choice: { type: 'none' as const } } : {}),
      },
      { signal: roundAbort },
    );

    // Capture text exactly as it streams so the saved message matches
    // what the user sees — not reconstructed from finalMsg.content,
    // where block boundaries and concatenation can drift.
    let roundStreamedText = '';
    let finalMsg: Awaited<ReturnType<typeof stream.finalMessage>>;
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name };
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            roundStreamedText += event.delta.text;
            yield { type: 'text_delta', delta: event.delta.text };
          }
        }
      }

      finalMsg = await stream.finalMessage();
    } catch (err: any) {
      // AbortError when our per-round deadline fires (or its clamped
      // wall-clock variant). Rename to a pilot-friendly message — the
      // caller catches this and saves whatever partial text already
      // streamed alongside the timeout notice.
      const isAbort = err?.name === 'AbortError' || err?.name === 'APIUserAbortError' || roundAbort.aborted;
      if (isAbort) {
        throw new Error(`Howard's reply timed out after ${Math.round(deadlineMs / 1000)}s. Try again in a moment.`);
      }
      throw err;
    }
    totalUsage.input_tokens += finalMsg.usage.input_tokens;
    totalUsage.output_tokens += finalMsg.usage.output_tokens;
    totalUsage.cache_read_input_tokens += (finalMsg.usage as any).cache_read_input_tokens || 0;
    totalUsage.cache_creation_input_tokens += (finalMsg.usage as any).cache_creation_input_tokens || 0;

    if (roundStreamedText) assistantText += roundStreamedText;

    const hasToolUse = finalMsg.content.some(b => b.type === 'tool_use');

    if (finalMsg.stop_reason === 'end_turn' || !hasToolUse) {
      yield {
        type: 'complete',
        assistantText,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        usage: totalUsage,
      };
      return;
    }

    messages.push({ role: 'assistant', content: finalMsg.content as any });

    // Parallelize all tool calls in this round. Each tool already has
    // its own 15s timeout (HOWARD_TOOL_TIMEOUT_MS); pre-fix the sequential
    // await loop meant 3 tool calls × 15s = up to 45s, which exactly
    // matches STREAM_DEADLINE_MS and trips the per-round cap. Parallel
    // execution caps the round at max-single-tool-duration regardless of
    // how many tools the model invoked.
    const toolUseBlocks = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const settled = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeTool(block.name, block.input, toolCtx, supabaseAdmin);
        return { block, result };
      }),
    );
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const { block, result } of settled) {
      allToolCalls.push({ name: block.name, input: block.input, id: block.id });
      allToolResults.push({ tool_use_id: block.id, result });
      yield { type: 'tool_use_end', id: block.id, name: block.name };
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Two distinct fall-through cases:
  //   - bailedForTime: wall-clock budget ran out before another round
  //     could safely start. Soft-suffix any streamed text so the user
  //     sees the partial answer + knows to retry.
  //   - exhausted MAX_TOOL_ROUNDS without an end_turn: model is stuck in
  //     a tool-use loop. Same soft-fail shape but a different reason.
  let finalText: string;
  if (bailedForTime) {
    finalText = assistantText
      ? `${assistantText}\n\n⚠️ Wrapped up early to stay under the request budget. Ask again to continue.`
      : `⚠️ Ran out of time before getting to a clean answer. Try again — usually a quick retry works.`;
  } else {
    finalText = assistantText || 'I hit a processing limit on this request. Could you try rephrasing your question?';
  }

  yield {
    type: 'complete',
    assistantText: finalText,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
    toolResults: allToolResults.length > 0 ? allToolResults : null,
    usage: totalUsage,
  };
}
