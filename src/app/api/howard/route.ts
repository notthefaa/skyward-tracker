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
  // Throw on either read failure: silent fallback to an empty fleet
  // makes Howard prompt onboarding for an existing user, or quietly
  // miss the aircraft they meant to ask about.
  const { data: access, error: accessErr } = await supabaseAdmin
    .from('aft_user_aircraft_access')
    .select('aircraft_id')
    .eq('user_id', userId);
  if (accessErr) throw accessErr;
  const ids = (access || []).map((a: any) => a.aircraft_id);
  if (ids.length === 0) return [];
  const { data, error: fleetErr } = await supabaseAdmin
    .from('aft_aircraft')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
    .order('tail_number');
  if (fleetErr) throw fleetErr;
  return data || [];
}

// DELETE — clear the current user's Howard thread
// Soft-archive (archived_at = now()) rather than hard delete. The chat
// surface filters archived_at IS NULL so the user gets a fresh thread
// next time they open Howard, but the Usage page (which reads token
// columns off aft_howard_messages) still sees the full 30-day window.
// Hard-delete used to make Usage look empty for any pilot who'd been
// idle longer than 30 min — see migration 068.
//
// The thread row stays so proposed actions (which have ON DELETE
// CASCADE on thread_id) survive as an audit trail of what Howard
// proposed vs. what the user accepted.
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

    // Only flip rows that aren't already archived. count: 'exact' so a
    // silent zero-row update (RLS misconfig, service-role key missing,
    // etc.) surfaces instead of letting the UI show an optimistic-empty
    // state that snaps back on reload.
    const { error: delErr, count } = await supabaseAdmin
      .from('aft_howard_messages')
      .update({ archived_at: new Date().toISOString() }, { count: 'exact' })
      .eq('thread_id', thread.id)
      .is('archived_at', null);
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

    // Throw on read errors so a transient failure doesn't render the
    // chat as an empty thread (the user thinks their history vanished).
    const { data: thread, error: threadErr } = await supabaseAdmin
      .from('aft_howard_threads')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (threadErr) throw threadErr;

    if (!thread) {
      return NextResponse.json({ thread: null, messages: [] });
    }

    // Filter out archived rows so a soft-wiped thread reads as empty
    // to the chat surface. The Usage page counts ALL rows regardless
    // of archived_at — that's why we soft-archive instead of hard delete.
    const { data: messages, error: messagesErr } = await supabaseAdmin
      .from('aft_howard_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (messagesErr) throw messagesErr;

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
    // and start repeating earlier turns). Skip archived rows so a
    // soft-wiped thread starts the model on a clean slate.
    const { data: history, error: historyErr } = await supabaseAdmin
      .from('aft_howard_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .is('archived_at', null)
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
    // Throw on read error so a transient DB hiccup doesn't quietly downgrade
    // the user to 'pilot' with empty ratings — Howard would then mis-tailor
    // its tone for an admin or a CFI without us noticing.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('aft_user_roles')
      .select('role, faa_ratings, initials, full_name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    let userRole: string = (profile as any)?.role || 'pilot';
    const faaRatings: string[] = ((profile as any)?.faa_ratings as string[] | null) || [];
    const pilotInitials: string = (profile as any)?.initials || '';
    const pilotFullName: string = (profile as any)?.full_name || '';
    let aircraftRole: string | null = null;
    let oilConsumption: OilConsumptionStatus | null = null;
    if (currentAircraft) {
      const { data: acAccess, error: acAccessErr } = await supabaseAdmin
        .from('aft_user_aircraft_access')
        .select('aircraft_role')
        .eq('user_id', user.id)
        .eq('aircraft_id', currentAircraft.id)
        .maybeSingle();
      if (acAccessErr) throw acAccessErr;
      aircraftRole = (acAccess as any)?.aircraft_role || null;
      if (userRole !== 'admin' && aircraftRole) {
        userRole = aircraftRole;
      }

      // Proactive oil-consumption flag — same signal as the Ops Checks
      // dial. Surfacing it in Howard's per-request context means he'll
      // mention orange/red states when the pilot asks about the plane,
      // not just when he happens to pull the oil log.
      // Pull the latest add (for hours-since math) plus a total count of
      // add events. The helper holds back red/orange until count >= 2 —
      // one log isn't a consumption rate, just a single timestamp.
      const [{ data: lastAddRow }, { count: addEventCount }] = await Promise.all([
        supabaseAdmin
          .from('aft_oil_logs')
          .select('engine_hours')
          .eq('aircraft_id', currentAircraft.id)
          .is('deleted_at', null)
          .gt('oil_added', 0)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('aft_oil_logs')
          .select('id', { count: 'exact', head: true })
          .eq('aircraft_id', currentAircraft.id)
          .is('deleted_at', null)
          .gt('oil_added', 0),
      ]);
      const currentHrs = (currentAircraft as any)?.total_engine_time ?? null;
      const hrsSince = hoursSinceLastOilAdd((lastAddRow as any)?.engine_hours ?? null, currentHrs);
      oilConsumption = getOilConsumptionStatus(hrsSince, 'Piston', addEventCount ?? 0);
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

    // The user-message INSERT used to live up here, before the stream
    // existed. That left a race window: between the insert and the
    // first SSE byte, if the request was cancelled (network drop, tab
    // close, an early hook throw) the message was committed to DB
    // with no follow-up assistant response — and the user, having
    // seen no acknowledgment, would retry and create a duplicate.
    //
    // Moving the insert INTO `start()` ties the DB write to a live
    // subscriber: if the request errors or aborts before stream
    // subscribe, no insert happens. If the insert itself fails, we
    // surface a clean SSE `error` event (which the client throws on)
    // instead of a hanging chat with no input row.
    const threadId = thread.id;
    const trimmed = message.trim();
    const historySnapshot = history || [];

    // Stream SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Client-cancel detector. When the consumer cancels the body
        // (navigation, tab close, AbortController.abort), `enqueue`
        // throws ERR_INVALID_STATE. Without this, every legitimate
        // cancel logs as `[Howard stream failed]` in monitoring and
        // races into the DB-error-message write below — noise that
        // masks real stream failures.
        let clientGone = false;
        const send = (data: any) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            clientGone = true;
          }
        };
        const closeController = () => {
          if (clientGone) return;
          try {
            controller.close();
          } catch {
            clientGone = true;
          }
        };

        // SSE comment lines keep the TCP/HTTP pipe warm through long
        // tool rounds (FAA NOTAM, aviationweather, embeddings). Without
        // these, Vercel's edge proxy and some browsers close an idle
        // connection even while the serverless function is still
        // running — the client then reports a premature disconnect.
        // Client ignores lines that don't start with `data: `. 8s
        // beat keeps the client's 14s stall-watchdog comfortably
        // under one-and-three-quarter heartbeats of slack so an
        // iOS-suspended socket recovers in ≤14s instead of ≤20s.
        const heartbeat = setInterval(() => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(': hb\n\n'));
          } catch {
            // Client cancelled between sends — flag so subsequent
            // send() / closeController() short-circuit instead of
            // throwing into the catch block below.
            clientGone = true;
          }
        }, 8000);

        // Hoisted so the catch block can recover partial text from
        // events that already streamed before the failure.
        let streamedSoFar = '';

        try {
          // Insert the user message now that we have a live subscriber.
          // Any failure here ships as an SSE `error` event so the client
          // throws and the optimistic row in the chat is rolled back —
          // no orphan user message stranded in the thread.
          const { data: userMsg, error: userMsgErr } = await supabaseAdmin
            .from('aft_howard_messages')
            .insert({ thread_id: threadId, role: 'user', content: trimmed })
            .select()
            .single();
          if (userMsgErr) throw userMsgErr;

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
          closeController();
        } catch (err: any) {
          clearInterval(heartbeat);
          // Client cancelled mid-stream (navigation, tab close, abort).
          // No partial reply to persist — the user won't see it. Skip
          // the noisy log + DB error-message write so monitoring isn't
          // swamped with false-positive "stream failed" entries.
          if (clientGone) {
            closeController();
            return;
          }
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
          // Sanitize the user-visible reason. Anthropic SDK errors are
          // mostly safe but raw HTTP bodies / prompt fragments from
          // less-common error classes have leaked verbatim into the
          // chat in past incidents. Allowlist the user-visible message:
          // known timeout/budget classes get a friendly string; anything
          // else collapses to a generic "Stream failed" so the saved
          // assistant message can't expose credentials or prompts.
          // We DO expose an error-class hint (e.g. "Stream failed:
          // APIError 529") — class names + HTTP statuses are safe and
          // make field-report diagnosis much faster.
          const rawMessage = typeof err?.message === 'string' ? err.message : '';
          const errName = typeof err?.name === 'string' ? err.name : '';
          const errCtor = err?.constructor?.name;
          const errClass = (errName || errCtor || 'Error')
            // Strip anything that's not [A-Za-z0-9]; never leak prompt
            // fragments via a synthesized class name.
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 40);
          const errStatus = typeof err?.status === 'number' ? err.status : null;
          const errCode = typeof err?.code === 'string'
            ? err.code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)
            : '';
          // Sanitized message-hint: a-z, 0-9, spaces, basic punctuation
          // only. Bounded to 80 chars so a leaked prompt fragment can't
          // fit. Anthropic SDK error messages typically look like
          // "529 - {"type":"error","error":{"type":"overloaded_error"...}}"
          // or "Connection error." — both have plenty of useful signal
          // inside the first 80 chars after sanitizing.
          const msgHint = rawMessage
            .replace(/[^\w\s.,!?:;'\-/()]/g, '')
            .slice(0, 80)
            .trim();
          const isTimeout = errName === 'AbortError'
            || errName === 'APIUserAbortError'
            || /timed out|wall-clock|wall_clock|deadline/i.test(rawMessage);
          const reason = isTimeout
            ? (rawMessage.match(/^Howard's reply timed out[^.]*\./)?.[0] || 'Reply timed out')
            : `Stream failed: ${errClass}${errStatus ? ` ${errStatus}` : ''}${errCode ? ` [${errCode}]` : ''}${msgHint ? ` — ${msgHint}` : ''}`;
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
          closeController();
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
