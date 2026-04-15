import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools';
import { executeTool } from './toolHandlers';
import { HOWARD_STABLE_PRELUDE, buildAircraftContext } from './systemPrompt';
import type { Aircraft } from '@/lib/types';
import type { HowardMessage } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

const client = new Anthropic();

export const HOWARD_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 3;
const CONTEXT_WINDOW = 20;

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
  aircraft: Aircraft,
  userRole: string,
  userId: string,
  threadId: string,
  supabaseAdmin: SupabaseClient,
  aircraftId: string,
): AsyncGenerator<StreamEvent, void, unknown> {
  // Two-block system prompt: stable prelude is prompt-cached (tools + this
  // block are cached together), aircraft context is a per-request delta.
  const aircraftContext = buildAircraftContext(aircraft, userRole);

  const toolCtx = {
    userId,
    threadId,
    aircraftId,
    aircraftTail: aircraft.tail_number,
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: HOWARD_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        { type: 'text', text: HOWARD_STABLE_PRELUDE, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: aircraftContext },
      ],
      tools,
      messages,
    });

    // Capture text exactly as it streams so the saved message matches
    // what the user sees — not reconstructed from finalMsg.content,
    // where block boundaries and concatenation can drift.
    let roundStreamedText = '';
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

    const finalMsg = await stream.finalMessage();
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

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of finalMsg.content) {
      if (block.type === 'tool_use') {
        allToolCalls.push({ name: block.name, input: block.input, id: block.id });
        const result = await executeTool(block.name, block.input, toolCtx, supabaseAdmin);
        allToolResults.push({ tool_use_id: block.id, result });
        yield { type: 'tool_use_end', id: block.id, name: block.name };
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  yield {
    type: 'complete',
    assistantText: assistantText || 'I hit a processing limit on this request. Could you try rephrasing your question?',
    toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
    toolResults: allToolResults.length > 0 ? allToolResults : null,
    usage: totalUsage,
  };
}
