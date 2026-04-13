import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/chuck/rateLimit';
import { sendMessage } from '@/lib/chuck/claude';

// GET — load thread + messages for current user + aircraft
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: thread } = await supabaseAdmin
      .from('aft_chuck_threads')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) {
      return NextResponse.json({ thread: null, messages: [] });
    }

    const { data: messages } = await supabaseAdmin
      .from('aft_chuck_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    return NextResponse.json({ thread, messages: messages || [] });
  } catch (error) { return handleApiError(error); }
}

// POST — send a message to Chuck
export async function POST(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { aircraftId, message } = await req.json();

    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: 'Message too long (max 2000 characters).' }, { status: 400 });
    }

    const { allowed, retryAfterMs } = checkRateLimit(user.id);
    if (!allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s.` },
        { status: 429 }
      );
    }

    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    // Get or create thread
    let { data: thread } = await supabaseAdmin
      .from('aft_chuck_threads')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) {
      const { data: newThread, error } = await supabaseAdmin
        .from('aft_chuck_threads')
        .insert({ aircraft_id: aircraftId, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      thread = newThread;
    }

    // Load conversation history
    const { data: history } = await supabaseAdmin
      .from('aft_chuck_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    // Fetch aircraft profile
    const { data: aircraft } = await supabaseAdmin
      .from('aft_aircraft')
      .select('*')
      .eq('id', aircraftId)
      .single();
    if (!aircraft) return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });

    // Determine user role
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', user.id)
      .eq('aircraft_id', aircraftId)
      .maybeSingle();
    const userRole = access?.aircraft_role || 'pilot';

    // Save user message
    const { data: userMsg, error: userMsgErr } = await supabaseAdmin
      .from('aft_chuck_messages')
      .insert({ thread_id: thread.id, role: 'user', content: message.trim() })
      .select()
      .single();
    if (userMsgErr) throw userMsgErr;

    // Call Claude
    const result = await sendMessage(
      message.trim(),
      history || [],
      aircraft,
      userRole,
      supabaseAdmin,
      aircraftId,
    );

    // Save assistant message with token tracking
    const { data: assistantMsg, error: assistantMsgErr } = await supabaseAdmin
      .from('aft_chuck_messages')
      .insert({
        thread_id: thread.id,
        role: 'assistant',
        content: result.assistantText,
        tool_calls: result.toolCalls,
        tool_results: result.toolResults,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_read_tokens: result.usage.cache_read_input_tokens,
        cache_create_tokens: result.usage.cache_creation_input_tokens,
        model: 'claude-sonnet-4-6',
      })
      .select()
      .single();
    if (assistantMsgErr) throw assistantMsgErr;

    // Update thread timestamp
    await supabaseAdmin
      .from('aft_chuck_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', thread.id);

    return NextResponse.json({ userMessage: userMsg, assistantMessage: assistantMsg, threadId: thread.id });
  } catch (error) { return handleApiError(error); }
}
