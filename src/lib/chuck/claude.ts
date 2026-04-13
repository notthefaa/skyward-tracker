import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools';
import { executeTool } from './toolHandlers';
import { buildSystemPrompt } from './systemPrompt';
import type { Aircraft } from '@/lib/types';
import type { ChuckMessage } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

const client = new Anthropic();

const MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 5;
const CONTEXT_WINDOW = 20;

interface SendMessageResult {
  assistantText: string;
  toolCalls: any[] | null;
  toolResults: any[] | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export async function sendMessage(
  userText: string,
  conversationHistory: ChuckMessage[],
  aircraft: Aircraft,
  userRole: string,
  supabaseAdmin: SupabaseClient,
  aircraftId: string,
): Promise<SendMessageResult> {
  const systemPrompt = buildSystemPrompt(aircraft, userRole);

  // Build message array from recent conversation history
  const messages: Anthropic.MessageParam[] = conversationHistory
    .slice(-CONTEXT_WINDOW)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Add new user message
  messages.push({ role: 'user', content: userText });

  const allToolCalls: any[] = [];
  const allToolResults: any[] = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  // Tool-use loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    // Accumulate usage
    totalUsage.input_tokens += response.usage.input_tokens;
    totalUsage.output_tokens += response.usage.output_tokens;
    totalUsage.cache_read_input_tokens += (response.usage as any).cache_read_input_tokens || 0;
    totalUsage.cache_creation_input_tokens += (response.usage as any).cache_creation_input_tokens || 0;

    // Check if done (no tool use blocks)
    const hasToolUse = response.content.some(b => b.type === 'tool_use');
    if (response.stop_reason === 'end_turn' || !hasToolUse) {
      const textBlock = response.content.find(b => b.type === 'text');
      return {
        assistantText: textBlock?.type === 'text' ? textBlock.text : '',
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        usage: totalUsage,
      };
    }

    // Process tool calls
    const assistantContent = response.content;
    messages.push({ role: 'assistant', content: assistantContent as any });

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        allToolCalls.push({ name: block.name, input: block.input, id: block.id });
        const result = await executeTool(block.name, block.input, supabaseAdmin, aircraftId);
        allToolResults.push({ tool_use_id: block.id, result });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Exhausted tool rounds
  return {
    assistantText: 'I hit a processing limit on this request. Could you try rephrasing your question?',
    toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
    toolResults: allToolResults.length > 0 ? allToolResults : null,
    usage: totalUsage,
  };
}
