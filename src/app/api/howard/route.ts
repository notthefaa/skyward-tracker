import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/howard/rateLimit';
import { sendMessageStream, HOWARD_MODEL } from '@/lib/howard/claude';
import { getOilConsumptionStatus, hoursSinceLastOilAdd, type OilConsumptionStatus } from '@/lib/oilConsumption';
import { getRequestId, logError } from '@/lib/requestId';

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
// Only the messages are deleted; the thread row is kept so proposed
// actions (which have ON DELETE CASCADE on thread_id) survive as an
// audit trail of what Howard proposed vs. what the user accepted.
// message_id on each proposed_action goes NULL via its FK's ON DELETE
// SET NULL, which is fine — the payload and summary are self-contained.
export async function DELETE(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);

    const { data: thread, error: threadErr } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (threadErr) throw threadErr;

    if (!thread) return NextResponse.json({ success: true, cleared: 0 });

    // Use count: 'exact' so a silent zero-row delete (RLS misconfig,
    // service-role key missing, etc.) surfaces instead of letting the
    // UI show an optimistic-empty state that snaps back on reload.
    const { error: delErr, count } = await supabaseAdmin
      .from('aft_howard_messages')
      .delete({ count: 'exact' })
      .eq('thread_id', thread.id);
    if (delErr) throw delErr;

    const { error: bumpErr } = await supabaseAdmin
      .from('aft_howard_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', thread.id);
    if (bumpErr) throw bumpErr;

    return NextResponse.json({ success: true, cleared: count ?? 0 });
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
  const requestId = getRequestId(req);
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { message, currentTail, previousTail, timeZone, onboardingMode } = await req.json();

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: 'Message too long (max 2000 characters).' }, { status: 400 });
    }

    const { allowed, retryAfterMs } = await checkRateLimit(supabaseAdmin, user.id);
    if (!allowed) {
      return NextResponse.json(
        { error: `You've hit the Howard rate limit. Try again in ${Math.ceil(retryAfterMs / 1000)}s — this protects the shared API budget from runaway loops.` },
        { status: 429 }
      );
    }

    // Get or create the user's single thread. Throw on read errors so
    // a transient failure can't drop us into the "create new thread"
    // branch and trigger a unique-constraint violation against the
    // already-existing row.
    let { data: thread, error: threadReadErr } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (threadReadErr) throw threadReadErr;

    if (!thread) {
      const { data: newThread, error } = await supabaseAdmin
        .from('aft_howard_threads')
        .insert({ user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      thread = newThread;
    }

    // Load conversation history. Throw on error so we don't silently
    // hand Claude an empty history (which makes the model lose context
    // and start repeating earlier turns).
    const { data: history, error: historyErr } = await supabaseAdmin
      .from('aft_howard_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true });
    if (historyErr) throw historyErr;

    // Load the user's full fleet for Howard's context
    const userAircraft = await loadUserFleet(supabaseAdmin, user.id);

    // Resolve the currently-selected aircraft (if any) from the tail hint.
    // Must be one of the user's aircraft.
    let currentAircraft: any = null;
    if (currentTail && typeof currentTail === 'string') {
      const normalized = currentTail.toUpperCase().trim();
      currentAircraft = userAircraft.find((a: any) => a.tail_number === normalized) || null;
    }

    // User role + FAA ratings + initials — global first, else fall back
    // to per-aircraft role for the currently-selected aircraft (or
    // 'pilot' if none). Ratings + initials come straight from the profile.
    const { data: profile } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role, faa_ratings, initials, full_name')
      .eq('user_id', user.id)
      .maybeSingle();
    let userRole: string = (profile as any)?.role || 'pilot';
    const faaRatings: string[] = ((profile as any)?.faa_ratings as string[] | null) || [];
    const pilotInitials: string = (profile as any)?.initials || '';
    const pilotFullName: string = (profile as any)?.full_name || '';
    let aircraftRole: string | null = null;
    let oilConsumption: OilConsumptionStatus | null = null;
    if (currentAircraft) {
      const { data: acAccess } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', currentAircraft.id)
        .maybeSingle();
      aircraftRole = (acAccess as any)?.aircraft_role || null;
      if (userRole !== 'admin' && aircraftRole) {
        userRole = aircraftRole;
      }

      // Proactive oil-consumption flag — same signal as the Ops Checks
      // dial. Surfacing it in Howard's per-request context means he'll
      // mention orange/red states when the pilot asks about the plane,
      // not just when he happens to pull the oil log.
      const { data: lastAddRow } = await supabaseAdmin
        .from('aft_oil_logs')
        .select('engine_hours')
        .eq('aircraft_id', currentAircraft.id)
        .is('deleted_at', null)
        .gt('oil_added', 0)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentHrs = (currentAircraft as any)?.total_engine_time ?? null;
      const hrsSince = hoursSinceLastOilAdd((lastAddRow as any)?.engine_hours ?? null, currentHrs);
      oilConsumption = getOilConsumptionStatus(hrsSince);
    }

    // Only flag a switch when the client's previousTail is different
    // from the current one AND isn't the same physical tail (avoids
    // false positives on casing / whitespace drift).
    const switchedFromTail: string | null =
      (previousTail && typeof previousTail === 'string'
        && currentAircraft
        && previousTail.toUpperCase().trim() !== currentAircraft.tail_number)
        ? previousTail.toUpperCase().trim()
        : null;

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

        // SSE comment lines keep the TCP/HTTP pipe warm through long
        // tool rounds (FAA NOTAM, aviationweather, embeddings). Without
        // these, Vercel's edge proxy and some browsers close an idle
        // connection even while the serverless function is still
        // running — the client then reports a premature disconnect.
        // Client ignores lines that don't start with `data: `.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': hb\n\n'));
          } catch {
            // Controller may already be closed — nothing to do.
          }
        }, 15000);

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
            faaRatings,
            pilotInitials,
            pilotFullName,
            typeof timeZone === 'string' && timeZone ? timeZone : 'UTC',
            user.id,
            threadId,
            supabaseAdmin,
            onboardingMode === true,
            switchedFromTail,
            aircraftRole,
            oilConsumption,
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
          clearInterval(heartbeat);
          controller.close();
        } catch (err: any) {
          clearInterval(heartbeat);
          // Inner-catch errors (Anthropic stream failure, tool crash,
          // DB write after partial stream, etc.) never reach the outer
          // `handleApiError` because the HTTP response has already
          // started — they were invisible in prod prior to this log.
          logError('[Howard stream failed]', err, {
            requestId,
            route: '/api/howard',
            userId: user.id,
            extra: {
              had_partial_stream: streamedSoFar.trim().length > 0,
              onboarding_mode: onboardingMode === true,
              current_tail: typeof currentTail === 'string' ? currentTail : '',
            },
          });
          const reason = err?.message || 'Stream failed';
          const partial = streamedSoFar.trim();
          const content = partial
            ? `${partial}\n\n⚠️ Howard got cut off before finishing. (${reason})`
            : `⚠️ I hit a snag answering that. (${reason}) Try again.`;
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
