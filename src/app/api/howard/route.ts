import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/howard/rateLimit';
import { sendMessageStream, HOWARD_MODEL } from '@/lib/howard/claude';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE — clear thread + messages for current user + aircraft
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: thread } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('id')
      .eq('aircraft_id', aircraftId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) return NextResponse.json({ success: true, cleared: 0 });

    // Delete messages first (FK), then the thread itself
    await supabaseAdmin.from('aft_howard_messages').delete().eq('thread_id', thread.id);
    await supabaseAdmin.from('aft_howard_threads').delete().eq('id', thread.id);

    return NextResponse.json({ success: true, cleared: 1 });
  } catch (error) { return handleApiError(error); }
}

// GET — load thread + messages for current user + aircraft
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: thread } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) {
      return NextResponse.json({ thread: null, messages: [] });
    }

    const { data: messages } = await supabaseAdmin
      .from('aft_howard_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });

    return NextResponse.json({ thread, messages: messages || [] });
  } catch (error) { return handleApiError(error); }
}

// POST — send a message to Howard (streamed SSE response)
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
      .from('aft_howard_threads')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) {
      const { data: newThread, error } = await supabaseAdmin
        .from('aft_howard_threads')
        .insert({ aircraft_id: aircraftId, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      thread = newThread;
    }

    // Load conversation history
    const { data: history } = await supabaseAdmin
      .from('aft_howard_messages')
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

    // Determine user role (for this aircraft)
    const { data: access } = await supabaseAdmin
      .from('aft_user_aircraft_access')
      .select('aircraft_role')
      .eq('user_id', user.id)
      .eq('aircraft_id', aircraftId)
      .maybeSingle();
    const userRole = access?.aircraft_role || 'pilot';

    // Save user message up-front
    const { data: userMsg, error: userMsgErr } = await supabaseAdmin
      .from('aft_howard_messages')
      .insert({ thread_id: thread.id, role: 'user', content: message.trim() })
      .select()
      .single();
    if (userMsgErr) throw userMsgErr;

    const threadId = thread.id;
    const trimmed = message.trim();
    const historySnapshot = history || [];

    // Stream SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send({ type: 'user_saved', userMessage: userMsg, threadId });

          let assistantText = '';
          let finalUsage: any = null;
          let finalToolCalls: any = null;
          let finalToolResults: any = null;

          for await (const ev of sendMessageStream(
            trimmed,
            historySnapshot,
            aircraft,
            userRole,
            user.id,
            threadId,
            supabaseAdmin,
            aircraftId,
          )) {
            if (ev.type === 'complete') {
              assistantText = ev.assistantText;
              finalUsage = ev.usage;
              finalToolCalls = ev.toolCalls;
              finalToolResults = ev.toolResults;
            } else {
              send(ev);
            }
          }

          const { data: assistantMsg, error: asstErr } = await supabaseAdmin
            .from('aft_howard_messages')
            .insert({
              thread_id: threadId,
              role: 'assistant',
              content: assistantText,
              tool_calls: finalToolCalls,
              tool_results: finalToolResults,
              input_tokens: finalUsage?.input_tokens ?? 0,
              output_tokens: finalUsage?.output_tokens ?? 0,
              cache_read_tokens: finalUsage?.cache_read_input_tokens ?? 0,
              cache_create_tokens: finalUsage?.cache_creation_input_tokens ?? 0,
              model: HOWARD_MODEL,
            })
            .select()
            .single();
          if (asstErr) throw asstErr;

          await supabaseAdmin
            .from('aft_howard_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', threadId);

          send({ type: 'done', assistantMessage: assistantMsg, threadId });
          controller.close();
        } catch (err: any) {
          // Persist an error placeholder so the user's question doesn't hang
          // in history with no reply — matters for an audit-style chat log.
          const reason = err?.message || 'Stream failed';
          try {
            const { data: errorMsg } = await supabaseAdmin
              .from('aft_howard_messages')
              .insert({
                thread_id: threadId,
                role: 'assistant',
                content: `⚠️ I ran into a problem responding to that. (${reason}) Please try again.`,
                model: HOWARD_MODEL,
              })
              .select()
              .single();
            if (errorMsg) {
              await supabaseAdmin
                .from('aft_howard_threads')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', threadId);
              send({ type: 'done', assistantMessage: errorMsg, threadId });
            } else {
              send({ type: 'error', error: reason });
            }
          } catch {
            send({ type: 'error', error: reason });
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) { return handleApiError(error); }
}
