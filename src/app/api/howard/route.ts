import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/howard/rateLimit';
import { sendMessageStream, HOWARD_MODEL } from '@/lib/howard/claude';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Howard streams a reply that can involve multiple tool rounds. The
// default platform timeout (10–15s) kills the function mid-stream,
// which is why replies appeared to vanish. Vercel Hobby caps at 60s.
export const maxDuration = 60;

/** Load the user's personal fleet for Howard's per-request context.
 * Always scoped to aft_user_aircraft_access — we do NOT apply the
 * global-admin bypass here, because "the user's fleet" from Howard's
 * perspective means the aircraft they personally operate, not every
 * aircraft in the DB. Per-tool-call access (resolveAircraftFromTail)
 * still honors global admin so admins can query any aircraft by name. */
async function loadUserFleet(supabaseAdmin: any, userId: string) {
  const { data: access } = await supabaseAdmin
    .from('aft_user_aircraft_access')
    .select('aircraft_id')
    .eq('user_id', userId);
  const ids = (access || []).map((a: any) => a.aircraft_id);
  if (ids.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('aft_aircraft')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
    .order('tail_number');
  return data || [];
}

// DELETE — clear the current user's Howard thread
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: thread } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) return NextResponse.json({ success: true, cleared: 0 });

    await supabaseAdmin.from('aft_howard_messages').delete().eq('thread_id', thread.id);
    await supabaseAdmin.from('aft_howard_threads').delete().eq('id', thread.id);

    return NextResponse.json({ success: true, cleared: 1 });
  } catch (error) { return handleApiError(error); }
}

// GET — load the current user's thread + messages + fleet
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: thread } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('*')
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
    const { message, currentTail } = await req.json();

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

    // Get or create the user's single thread
    let { data: thread } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!thread) {
      const { data: newThread, error } = await supabaseAdmin
        .from('aft_howard_threads')
        .insert({ user_id: user.id })
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

    // Load the user's full fleet for Howard's context
    const userAircraft = await loadUserFleet(supabaseAdmin, user.id);

    // Resolve the currently-selected aircraft (if any) from the tail hint.
    // Must be one of the user's aircraft.
    let currentAircraft: any = null;
    if (currentTail && typeof currentTail === 'string') {
      const normalized = currentTail.toUpperCase().trim();
      currentAircraft = userAircraft.find((a: any) => a.tail_number === normalized) || null;
    }

    // User role — global first, else fall back to per-aircraft role for
    // the currently-selected aircraft (or 'pilot' if none).
    const { data: globalRole } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    let userRole: string = (globalRole as any)?.role || 'pilot';
    if (userRole !== 'admin' && currentAircraft) {
      const { data: acAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', currentAircraft.id)
        .maybeSingle();
      userRole = (acAccess as any)?.aircraft_role || userRole;
    }

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

        // Hoisted so the catch block can recover partial text from
        // events that already streamed before the failure.
        let streamedSoFar = '';

        try {
          send({ type: 'user_saved', userMessage: userMsg, threadId });

          let assistantText = '';
          let finalUsage: any = null;
          let finalToolCalls: any = null;
          let finalToolResults: any = null;

          for await (const ev of sendMessageStream(
            trimmed,
            historySnapshot,
            userAircraft,
            currentAircraft,
            userRole,
            user.id,
            threadId,
            supabaseAdmin,
          )) {
            if (ev.type === 'complete') {
              assistantText = ev.assistantText;
              finalUsage = ev.usage;
              finalToolCalls = ev.toolCalls;
              finalToolResults = ev.toolResults;
            } else {
              if (ev.type === 'text_delta') streamedSoFar += ev.delta;
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
          const reason = err?.message || 'Stream failed';
          const partial = streamedSoFar.trim();
          const content = partial
            ? `${partial}\n\n⚠️ Howard got cut off before finishing. (${reason})`
            : `⚠️ I ran into a problem responding to that. (${reason}) Please try again.`;
          try {
            const { data: errorMsg } = await supabaseAdmin
              .from('aft_howard_messages')
              .insert({
                thread_id: threadId,
                role: 'assistant',
                content,
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
