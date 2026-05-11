import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, handleApiError } from '@/lib/auth';
import { logError } from '@/lib/requestId';
import { env } from '@/lib/env';
import { escapeHtml } from '@/lib/sanitize';
import { computeMetrics, computeMxDueState } from '@/lib/math';
import { FLIGHT_DATA_LOOKBACK_DAYS, MX_AGGREGATION_WINDOW_DAYS } from '@/lib/constants';
import { emailShell, heading, paragraph, callout, bulletList, button } from '@/lib/email/layout';
import { getAppUrl } from '@/lib/email/appUrl';
import { loadMutedRecipients, isRecipientMuted } from '@/lib/notificationMutes';

// Cap the cron at 5 minutes so a slow Resend round can't let the next
// scheduled invocation overlap and double-send reminders. Vercel will
// hard-kill at this boundary; the per-aircraft work is already
// idempotent (skip-if-already-sent flags on each row), so a partial
// run resumes cleanly on the next tick.
export const maxDuration = 300;

// How many days to let an event sit in ready_for_pickup before nudging
// the primary contact. The cron will re-nudge at the same cadence until
// the owner closes the event.
const READY_PICKUP_NUDGE_DAYS = 3;
// Marker string we embed in the nudge message row so we can avoid
// re-nudging on every cron tick without needing a new DB column.
const READY_PICKUP_NUDGE_MARKER = '[NUDGE:ready_for_pickup]';

const resend = new Resend(env.RESEND_API_KEY);
const FROM_EMAIL = 'notifications@skywardsociety.com';

export async function GET(req: Request) {
  try {
    // Verify this is a legitimate Vercel CRON call
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();

    // Throw on read failures rather than silently returning success — a
    // transient supabase blip would otherwise let the cron report green
    // while no reminders went out. The outer try/catch funnels the
    // failure through handleApiError so Vercel sees a non-2xx and the
    // alert routes through the normal cron-failure channel.
    const { data: aircraftList, error: fleetErr } = await supabaseAdmin.from('aft_aircraft').select('*').is('deleted_at', null);
    if (fleetErr) throw fleetErr;
    const { data: mxItems, error: mxItemsErr } = await supabaseAdmin.from('aft_maintenance_items').select('*').eq('is_required', true).is('deleted_at', null);
    if (mxItemsErr) throw mxItemsErr;

    if (!aircraftList || !mxItems) return NextResponse.json({ success: true, note: 'No data' });

    // Build the mx_reminder mute set up-front. Settings exposes the
    // `mx_reminder` toggle to anyone who's a primary contact on at
    // least one aircraft; opting out should suppress every mx-reminder
    // email this cron sends (Phase 2 work-package draft, Phase 3
    // heads-up, Phase 4 per-item reminder). Phase 2 still ships the
    // in-app draft so the user has the alert via the maintenance tab —
    // muting only quiets the email channel. Phase 5 (ready_for_pickup
    // nudge) is `service_update` territory, intentionally not gated
    // by this pref.
    const mutedMxRecipients = await loadMutedRecipients(
      supabaseAdmin,
      aircraftList.map((a: any) => a.main_contact_email),
      'mx_reminder',
    );

    // Fetch Global Settings
    const { data: settings } = await supabaseAdmin.from('aft_system_settings').select('*').eq('id', 1).single();
    const reminder1 = settings?.reminder_1 ?? 30;
    const reminder2 = settings?.reminder_2 ?? 15;
    const reminder3 = settings?.reminder_3 ?? 5;
    const reminderHours1 = settings?.reminder_hours_1 ?? 30;
    const reminderHours2 = settings?.reminder_hours_2 ?? 15;
    const reminderHours3 = settings?.reminder_hours_3 ?? 5;
    const schedTime = settings?.sched_time ?? 10;
    const schedDays = settings?.sched_days ?? 30;
    const predictiveSchedDays = settings?.predictive_sched_days ?? 45;

    // Fetch Flight Logs from lookback window. Filter + order by
    // `occurred_at` (when the flight physically happened), not
    // `created_at` (server write time). Without this, a companion-app
    // offline flush would dump a batch of logs with `created_at=today`
    // and skew both the 180-day window inclusion AND the burn-rate
    // math — every just-flushed flight would look like "flown today"
    // and spike recency-weighted projections.
    //
    // Throw on read failure: a transient supabase blip would otherwise
    // return undefined → empty array → burnRate=0 → predictive heads-up
    // alerts never fire on this tick. Silent missed maintenance is the
    // worst failure mode for a cron, so let the next tick retry.
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - FLIGHT_DATA_LOOKBACK_DAYS);
    const { data: recentLogs, error: recentLogsErr } = await supabaseAdmin
      .from('aft_flight_logs')
      .select('aircraft_id, ftt, tach, created_at, occurred_at')
      .is('deleted_at', null)
      .gte('occurred_at', lookbackDate.toISOString())
      .order('occurred_at', { ascending: true })
      .order('created_at', { ascending: true });
    if (recentLogsErr) throw recentLogsErr;

    // Build set of MX items already in active events. Throw on read
    // errors here — a silent fallback to an empty set would let the
    // cron create duplicate draft work packages for every item that's
    // already in an active event, fanning out duplicate emails.
    const { data: activeEventLines, error: linesErr } = await supabaseAdmin
      .from('aft_event_line_items')
      .select('maintenance_item_id, event_id')
      .not('maintenance_item_id', 'is', null);
    if (linesErr) throw linesErr;

    const mxIdsInActiveEvents = new Set<string>();
    if (activeEventLines && activeEventLines.length > 0) {
      const eventIds = Array.from(new Set(activeEventLines.map((l: any) => l.event_id)));
      if (eventIds.length > 0) {
        const { data: activeEvents, error: activeErr } = await supabaseAdmin
          .from('aft_maintenance_events')
          .select('id')
          .in('id', eventIds)
          .in('status', ['draft', 'scheduling', 'confirmed', 'in_progress'])
          .is('deleted_at', null);
        if (activeErr) throw activeErr;

        if (activeEvents) {
          const activeEvIds = new Set(activeEvents.map((e: any) => e.id));
          for (const line of activeEventLines) {
            if (line.maintenance_item_id && activeEvIds.has(line.event_id)) {
              mxIdsInActiveEvents.add(line.maintenance_item_id);
            }
          }
        }
      }
    }

    // =====================================================
    // GROUP MX ITEMS BY AIRCRAFT
    // =====================================================
    const itemsByAircraft: Record<string, any[]> = {};
    for (const mx of (mxItems as any[])) {
      if (!itemsByAircraft[mx.aircraft_id]) itemsByAircraft[mx.aircraft_id] = [];
      itemsByAircraft[mx.aircraft_id].push(mx);
    }

    // Collect all MX item flag updates for batching
    const flagUpdates: { id: string; flags: Record<string, boolean> }[] = [];

    // =====================================================
    // PROCESS EACH AIRCRAFT
    // Wrapped in per-aircraft try/catch so one bad fleet entry
    // (corrupt mx-item, missing tail, etc.) doesn't bury the
    // remaining fleet's reminders on this tick. Errors get logged;
    // the next tick retries the failed aircraft.
    // =====================================================
    for (const aircraft of (aircraftList as any[])) {
      try {
      const acMxItems = itemsByAircraft[aircraft.id];
      if (!acMxItems || acMxItems.length === 0) continue;

      const planeLogs = recentLogs?.filter(l => l.aircraft_id === aircraft.id) || [];
      const { burnRate, confidenceScore } = computeMetrics(aircraft, planeLogs);

      // ─────────────────────────────────────────────────
      // PHASE 1: Evaluate each item's status
      // ─────────────────────────────────────────────────
      interface EvaluatedItem {
        mx: any;
        remaining: number;
        projectedDays: number;
        // Per-dimension remaining, kept on the evaluated item so Phase 4
        // (internal reminders) can frame the "due in X hrs / Y days"
        // message correctly for 'both' items without recomputing.
        // Infinity when the dimension isn't configured or doesn't apply.
        hoursLeft: number;
        daysLeft: number;
        triggersScheduling: boolean;
        triggersHeadsUp: boolean;
        withinAggregationWindow: boolean;
      }

      const evaluated: EvaluatedItem[] = [];

      for (const mx of acMxItems) {
        // Skip items already in an active maintenance event
        if (mxIdsInActiveEvents.has(mx.id)) continue;

        // Per-dimension due state — shared helper used by the client
        // UI (`processMxItem`) and here. One formula, one place to
        // update. 'both' items (annuals: tracking_type='both',
        // time_interval=100, date_interval_days=365) fire on whichever
        // deadline hits first; the helper populates both sides so the
        // threshold-hit checks below can pick either.
        const state = computeMxDueState(
          mx,
          aircraft.total_engine_time || 0,
          burnRate,
          aircraft.time_zone,
        );
        const { hasTimeData, hasDateData, hoursLeft, daysFromHours, daysLeft } = state;

        // Skip items that haven't been set up yet (no relevant due value
        // configured — a template insert that was never filled in).
        if (!hasTimeData && !hasDateData) continue;

        // Headline `remaining` + `projectedDays` for downstream sort
        // and aggregation window. For 'time'-only it's hours; for
        // 'date' / 'both' it's the nearer deadline in days.
        //
        // When a dimension is already expired (hoursLeft <= 0 or
        // daysLeft <= 0) `daysFromHours` may still be Infinity if
        // the aircraft has been idle (burnRate = 0). Force
        // projectedDays to 0 in that case so the aggregation
        // window picks the item up — otherwise an expired-by-hours
        // item on a hangared aircraft would silently fall out of
        // the daily reminder digest.
        const eitherExpired = state.isTimeExpired || state.isDateExpired;
        let remaining: number;
        let projectedDays: number;
        if (mx.tracking_type === 'time') {
          remaining = hoursLeft;
          projectedDays = state.isTimeExpired ? 0 : daysFromHours;
        } else if (mx.tracking_type === 'date') {
          remaining = daysLeft;
          projectedDays = daysLeft;
        } else {
          // 'both' — pick whichever dimension is nearer in days.
          projectedDays = eitherExpired ? 0 : Math.min(daysLeft, daysFromHours);
          remaining = projectedDays;
        }

        // Does this item hit the scheduling threshold? Each dimension
        // is checked in its own units. 'both' fires on either.
        const mxThresholdHitTime = hasTimeData && hoursLeft <= schedTime;
        const mxThresholdHitPredictive = hasTimeData && daysFromHours <= predictiveSchedDays;
        const mxThresholdHitDate = hasDateData && daysLeft <= schedDays;

        const triggersScheduling = mx.automate_scheduling && !mx.mx_schedule_sent && (
          mxThresholdHitTime || mxThresholdHitDate || (mxThresholdHitPredictive && confidenceScore >= 80)
        );

        const triggersHeadsUp = mx.automate_scheduling && !mx.mx_schedule_sent && !triggersScheduling &&
          mxThresholdHitPredictive && confidenceScore < 80 && !mx.primary_heads_up_sent;

        const withinAggregationWindow = projectedDays <= MX_AGGREGATION_WINDOW_DAYS || remaining <= MX_AGGREGATION_WINDOW_DAYS;

        evaluated.push({
          mx,
          remaining,
          projectedDays,
          hoursLeft,
          daysLeft,
          triggersScheduling,
          triggersHeadsUp,
          withinAggregationWindow,
        });
      }

      // ─────────────────────────────────────────────────
      // PHASE 2: AGGREGATE SCHEDULING
      // ─────────────────────────────────────────────────
      const schedulingTriggers = evaluated.filter(e => e.triggersScheduling);
      const appUrl = getAppUrl(req);

      if (schedulingTriggers.length > 0) {
        const itemsForDraft = evaluated.filter(e =>
          e.triggersScheduling ||
          (e.withinAggregationWindow && e.mx.automate_scheduling && !e.mx.mx_schedule_sent)
        );

        const lineItemDescriptions = itemsForDraft.map(e => {
          let dueString: string;
          if (e.mx.tracking_type === 'time') {
            dueString = `at ${e.mx.due_time} hours`;
            if (burnRate > 0) dueString += ` (projected ~${Math.ceil(e.projectedDays)} days)`;
          } else if (e.mx.tracking_type === 'date') {
            dueString = `on ${e.mx.due_date}`;
          } else {
            // 'both' — show whichever dimension is actually configured,
            // and note "whichever first" so the shop understands the
            // item has two triggers.
            const bits: string[] = [];
            if (e.mx.due_time != null) bits.push(`at ${e.mx.due_time} hours`);
            if (e.mx.due_date != null) bits.push(`on ${e.mx.due_date}`);
            dueString = bits.length === 2 ? `${bits.join(' or ')} (whichever first)` : bits[0] || '—';
          }
          return { mx: e.mx, dueString };
        });

        // Create a single draft event
        const { data: draftEvent, error: draftErr } = await supabaseAdmin
          .from('aft_maintenance_events')
          .insert({
            aircraft_id: aircraft.id,
            status: 'draft',
            addon_services: [],
            mx_contact_name: aircraft.mx_contact || null,
            mx_contact_email: aircraft.mx_contact_email || null,
            primary_contact_name: aircraft.main_contact || null,
            primary_contact_email: aircraft.main_contact_email || null,
          } as any)
          .select()
          .single();
        if (draftErr) {
          console.error(`[cron/mx-reminders] failed to create draft for ${aircraft.tail_number}:`, draftErr.message);
        }

        if (draftEvent) {
          // Insert all line items. If this fails we MUST tear the draft
          // back down — otherwise the email below describes line items
          // that don't exist, the customer clicks "Review & Send" and
          // hits an empty work package, AND the active-event filter
          // skips these items on every subsequent cron tick.
          const lineItems = lineItemDescriptions.map(({ mx, dueString }) => ({
            event_id: draftEvent.id,
            item_type: 'maintenance',
            maintenance_item_id: mx.id,
            item_name: mx.item_name,
            item_description: `Due ${dueString}`,
          }));
          const { error: linesInsertErr } = await supabaseAdmin.from('aft_event_line_items').insert(lineItems);
          if (linesInsertErr) {
            console.error(`[cron/mx-reminders] line-item insert failed for ${aircraft.tail_number}, rolling back draft:`, linesInsertErr.message);
            await supabaseAdmin.from('aft_maintenance_events').delete().eq('id', draftEvent.id);
          } else {

          // Build the system message
          const itemList = lineItemDescriptions.map(({ mx, dueString }) => `• ${mx.item_name}: ${dueString}`).join('\n');
          await supabaseAdmin.from('aft_event_messages').insert({
            event_id: draftEvent.id,
            sender: 'system',
            message_type: 'status_update',
            message: `Draft created automatically with ${lineItemDescriptions.length} item${lineItemDescriptions.length > 1 ? 's' : ''} approaching:\n${itemList}`,
          } as any);

          // Email the PRIMARY CONTACT to review and send. If the email
          // fails we ROLL BACK the draft (line items + system message
          // + event row) so the next cron tick recreates and re-emails
          // it. The active-event filter at Phase 1 (mxIdsInActiveEvents)
          // would otherwise skip these items every subsequent run, so
          // a stuck-but-not-flagged draft is the same as silently
          // dropping the alert.
          //
          // mx_reminder mute: when the recipient muted this category
          // we skip the email channel BUT keep the draft + flag updates
          // — the user has the alert via the maintenance tab. Without
          // the flag-flip the cron would loop on this item forever.
          const mxRemindersMuted = isRecipientMuted(aircraft.main_contact_email, mutedMxRecipients);
          let emailOk = true;
          if (aircraft.main_contact_email && !mxRemindersMuted) {
            const safeTail = escapeHtml(aircraft.tail_number);
            const safeMainContact = escapeHtml(aircraft.main_contact || 'Operations');
            const safeMxContact = escapeHtml(aircraft.mx_contact || 'your mechanic');

            const itemListHtml = lineItemDescriptions.map(({ mx, dueString }) =>
              `<strong>${escapeHtml(mx.item_name)}</strong> — <span style="color:#091F3C;">due ${escapeHtml(dueString)}</span>`
            );

            try {
              await resend.emails.send({
                from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
                replyTo: aircraft.main_contact_email,
                to: [aircraft.main_contact_email],
                subject: `Action Required: Review & Send Work Package for ${safeTail}`,
                html: emailShell({
                  title: `Work Package Ready — ${safeTail}`,
                  preheader: `${lineItemDescriptions.length} item${lineItemDescriptions.length > 1 ? 's' : ''} coming due on ${safeTail}. Draft work package ready for review.`,
                  body: `
                    ${heading('Maintenance Coming Due', 'warning')}
                    ${paragraph(`Hello ${safeMainContact},`)}
                    ${paragraph(`The following maintenance item${lineItemDescriptions.length > 1 ? 's are' : ' is'} approaching for <strong>${safeTail}</strong>:`)}
                    ${callout(bulletList(itemListHtml), { variant: 'warning' })}
                    ${paragraph(`We've prepared a <strong>draft work package</strong> for you. Open the app to:`)}
                    ${bulletList([
                      'Add any open squawks you&apos;d like addressed',
                      'Request additional services (wash, fluid top-off, nav update, etc.)',
                      'Propose a preferred service date',
                      `Send the complete package to ${safeMxContact}`,
                    ])}
                    ${button(appUrl, 'Review & Send', { variant: 'info' })}
                  `,
                  preferencesUrl: `${appUrl}#settings`,
                }),
              });
            } catch (err: any) {
              emailOk = false;
              console.error(`[cron/mx-reminders] scheduling email failed for ${aircraft.tail_number}:`, err?.message || err);
            }
          }

          // Queue flag updates if (a) the email went through, (b) the
          // recipient muted mx_reminder (draft is their channel), or
          // (c) there's no recipient at all (same — draft only). The
          // teardown branch only fires for genuine email-send failures.
          if (emailOk) {
            for (const { mx } of lineItemDescriptions) {
              flagUpdates.push({ id: mx.id, flags: { mx_schedule_sent: true } });
            }
          } else {
            // Email failed and there IS a recipient — tear the draft
            // back down so the next cron tick recreates + re-emails.
            // Done in dependency order so the delete works whether or
            // not the schema has ON DELETE CASCADE wired up.
            await supabaseAdmin.from('aft_event_messages').delete().eq('event_id', draftEvent.id);
            await supabaseAdmin.from('aft_event_line_items').delete().eq('event_id', draftEvent.id);
            await supabaseAdmin.from('aft_maintenance_events').delete().eq('id', draftEvent.id);
          }
          } // close: else (line-items insert succeeded)
        }
      }

      // ─────────────────────────────────────────────────
      // PHASE 3: LOW-CONFIDENCE HEADS-UP
      // ─────────────────────────────────────────────────
      const headsUpItems = evaluated.filter(e => e.triggersHeadsUp);
      // Skip the heads-up entirely (no email + no flag flip) when the
      // recipient has muted mx_reminder. Without the flag flip, the
      // next cron tick re-evaluates from scratch — so if the user
      // un-mutes later, they'll get the heads-up that wave.
      const phase3Muted = isRecipientMuted(aircraft.main_contact_email, mutedMxRecipients);
      if (headsUpItems.length > 0 && aircraft.main_contact_email && !phase3Muted) {
        const safeTail = escapeHtml(aircraft.tail_number);
        const safeMainContact = escapeHtml(aircraft.main_contact || 'Operations');

        const itemListHtml = headsUpItems.map(e =>
          `<strong>${escapeHtml(e.mx.item_name)}</strong> — projected ~${Math.ceil(e.projectedDays)} days`
        );

        try {
          await resend.emails.send({
            from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
            replyTo: aircraft.main_contact_email,
            to: [aircraft.main_contact_email],
            subject: `Heads Up: ${safeTail} MX Approaching (Low Confidence)`,
            html: emailShell({
              title: `Heads Up — ${safeTail}`,
              preheader: `${headsUpItems.length} item${headsUpItems.length > 1 ? 's' : ''} may be coming due on ${safeTail}. No action yet.`,
              body: `
                ${heading('Predictive Maintenance Alert', 'note')}
                ${paragraph(`Hello ${safeMainContact},`)}
                ${paragraph(`Based on recent flight activity, we estimate the following item${headsUpItems.length > 1 ? 's' : ''} for <strong>${safeTail}</strong> may be coming due:`)}
                ${bulletList(itemListHtml)}
                ${paragraph(`However, flight logs have been irregular (System Confidence: <strong>${confidenceScore}%</strong>), so ${headsUpItems.length > 1 ? 'these estimates' : 'this estimate'} may shift significantly.`)}
                ${paragraph(`No action is needed yet. We'll create a draft work package automatically when ${headsUpItems.length > 1 ? 'items get' : 'the item gets'} closer to ${headsUpItems.length > 1 ? 'their thresholds' : 'its threshold'}. You can also schedule service proactively from the Maintenance tab at any time.`)}
                ${button(appUrl, 'Open Skyward')}
              `,
              preferencesUrl: `${appUrl}#settings`,
            }),
          });

          // Only mark heads-up as sent if the email actually went.
          for (const e of headsUpItems) {
            flagUpdates.push({ id: e.mx.id, flags: { primary_heads_up_sent: true } });
          }
        } catch (err: any) {
          console.error(`[cron/mx-reminders] heads-up email failed for ${aircraft.tail_number}:`, err?.message || err);
        }
      }

      // ─────────────────────────────────────────────────
      // PHASE 4: INTERNAL REMINDERS
      // ─────────────────────────────────────────────────
      for (const e of evaluated) {
        const mx = e.mx;
        const remaining = e.remaining;
        const projectedDays = e.projectedDays;

        let hitReminder3 = false, hitReminder2 = false, hitReminder1 = false;
        let internalTriggerTemplate: string | null = null;
        const flagToUpdate: Record<string, boolean> = {};

        if (mx.tracking_type === 'time') {
          hitReminder3 = remaining <= reminderHours3 || projectedDays <= reminder3;
          hitReminder2 = remaining <= reminderHours2 || projectedDays <= reminder2;
          hitReminder1 = remaining <= reminderHours1 || projectedDays <= reminder1;
        } else if (mx.tracking_type === 'date') {
          hitReminder3 = remaining <= reminder3;
          hitReminder2 = remaining <= reminder2;
          hitReminder1 = remaining <= reminder1;
        } else {
          // 'both' — fire if EITHER dimension crosses its reminder
          // threshold. Check hours directly (not via projected days)
          // so a burnRate=0 aircraft with hours-close items still
          // reminds. `remaining` here is already the nearer in days,
          // so the days-comparison picks up date-driven reminders
          // AND time-driven-via-projection reminders.
          hitReminder3 = e.hoursLeft <= reminderHours3 || remaining <= reminder3;
          hitReminder2 = e.hoursLeft <= reminderHours2 || remaining <= reminder2;
          hitReminder1 = e.hoursLeft <= reminderHours1 || remaining <= reminder1;
        }

        // New aircraft with no flights yet report projectedDays=Infinity
        // (no burn rate yet). Rendering "~Infinity DAYS" in a template
        // is nonsense — substitute a readable fallback so the email
        // still makes sense.
        const projectedDaysText = Number.isFinite(projectedDays) ? `~${Math.ceil(projectedDays)} DAYS` : 'PROJECTION UNAVAILABLE — NO RECENT FLIGHT DATA';
        // Frame the "due in" line to match what's actually tight. For
        // 'both' items, the whichever dimension triggered the reminder
        // drives the phrasing so the pilot sees "100 HRS" vs. "30 DAYS"
        // as appropriate, not a lossy conversion to a single unit.
        // Format helpers — when an item is past due (`remaining`/
        // `hoursLeft`/`daysLeft` is negative) we show "OVERDUE BY X"
        // instead of "DUE IN -X", which renders awkwardly in the
        // alert email and was already confusing the in-app rendering
        // until processMxItem learned the same trick.
        const fmtHrs = (h: number): string =>
          h < 0
            ? `OVERDUE BY ${Math.abs(h).toFixed(1)} HRS`
            : `DUE IN ${h.toFixed(1)} HRS (${projectedDaysText})`;
        const fmtDays = (d: number): string =>
          d < 0
            ? `OVERDUE BY ${Math.abs(Math.round(d))} DAYS`
            : `DUE IN ${Math.round(d)} DAYS`;
        const triggerTemplate = (): string => {
          if (mx.tracking_type === 'time') return fmtHrs(remaining);
          if (mx.tracking_type === 'date') return fmtDays(remaining);
          // 'both' — lead with whichever dimension is actually closer.
          const timeIsTight = Number.isFinite(e.hoursLeft) && e.hoursLeft <= reminderHours1;
          const dateIsTight = Number.isFinite(e.daysLeft) && e.daysLeft <= reminder1;
          if (timeIsTight && (!dateIsTight || e.daysLeft > Math.ceil(e.hoursLeft / Math.max(burnRate, 0.01)))) {
            return fmtHrs(e.hoursLeft);
          }
          return fmtDays(e.daysLeft);
        };
        if (hitReminder3 && !mx.reminder_5_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_5_sent = true; flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder2 && !mx.reminder_15_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_15_sent = true; flagToUpdate.reminder_30_sent = true;
        } else if (hitReminder1 && !mx.reminder_30_sent) {
          internalTriggerTemplate = triggerTemplate();
          flagToUpdate.reminder_30_sent = true;
        }

        // `reminderEmailOk` defaults to true so the "no template fired"
        // branch (nothing to send) skips the email block but still
        // doesn't block flags — except there are no flags queued in
        // that path either, so it's a no-op. The dangerous case is
        // "template fired, no main_contact_email": Phase 3's heads-up
        // gates the whole block on the email's presence; Phase 2 keeps
        // the draft as a fallback notification channel; Phase 4 has
        // no fallback, so a missing recipient must NOT mark the
        // reminder as sent — we'd silently retire the alert forever.
        //
        // mx_reminder mute: when the recipient has muted this category
        // we DO flip the flag (treated as "delivered" for cron-state
        // purposes) so the cron doesn't re-evaluate this reminder
        // stage on every tick. The user has the in-app due date /
        // hours indicator regardless of email; muting only suppresses
        // the email channel.
        const phase4Muted = isRecipientMuted(aircraft.main_contact_email, mutedMxRecipients);
        let reminderEmailOk = !(internalTriggerTemplate && !aircraft.main_contact_email);
        if (internalTriggerTemplate && aircraft.main_contact_email && !phase4Muted) {
          const safeTail = escapeHtml(aircraft.tail_number);
          const safeItemName = escapeHtml(mx.item_name);

          try {
            await resend.emails.send({
              from: `Skyward Alerts <${FROM_EMAIL}>`,
              to: [aircraft.main_contact_email],
              subject: `Maintenance Alert: ${safeTail} Due Soon`,
              html: emailShell({
                title: `Maintenance Alert — ${safeTail}`,
                preheader: `${safeItemName}: ${escapeHtml(internalTriggerTemplate)}`,
                body: `
                  ${heading('Maintenance Alert', 'warning')}
                  ${paragraph(`Required maintenance is coming due for <strong>${safeTail}</strong>.`)}
                  ${callout(
                    `<div style="margin-bottom:4px;"><strong>Item:</strong> ${safeItemName}</div><div><strong>Status:</strong> ${escapeHtml(internalTriggerTemplate)}</div>`,
                    { variant: 'warning' }
                  )}
                  ${button(appUrl, 'Open Skyward')}
                `,
                preferencesUrl: `${appUrl}#settings`,
              }),
            });
          } catch (err: any) {
            reminderEmailOk = false;
            console.error(`[cron/mx-reminders] internal reminder email failed for ${aircraft.tail_number} / ${mx.item_name}:`, err?.message || err);
          }
        }

        // Don't flip the "sent" flag if the email bounced — the next
        // cron tick will retry the same reminder stage.
        if (reminderEmailOk && Object.keys(flagToUpdate).length > 0) {
          flagUpdates.push({ id: mx.id, flags: flagToUpdate });
        }
      }
      } catch (acErr: any) {
        console.error(`[cron/mx-reminders] aircraft ${aircraft?.tail_number ?? aircraft?.id ?? '?'} failed:`, acErr?.message || acErr);
        logError('[cron/mx-reminders] aircraft failed', acErr, { route: 'cron/mx-reminders', extra: { tail: aircraft?.tail_number ?? '?', aircraftId: aircraft?.id ?? '?' } });
      }
    }

    // =====================================================
    // PHASE 5: READY_FOR_PICKUP STALE NUDGE
    // If the mechanic has marked an event ready but the owner
    // hasn't closed it out, the aircraft stays logically blocked
    // on the calendar. Ping the primary contact after N days,
    // and avoid spamming by checking for a marker message.
    // =====================================================
    {
      const appUrl = getAppUrl(req);
      const { data: pickupEvents, error: pickupErr } = await supabaseAdmin
        .from('aft_maintenance_events')
        .select('id, aircraft_id, primary_contact_email')
        .eq('status', 'ready_for_pickup')
        .is('deleted_at', null);
      if (pickupErr) throw pickupErr;

      if (pickupEvents && pickupEvents.length > 0) {
        const eventIds = pickupEvents.map((e: any) => e.id);
        const { data: pickupMessages, error: pickupMsgErr } = await supabaseAdmin
          .from('aft_event_messages')
          .select('event_id, sender, message_type, message, created_at')
          .in('event_id', eventIds)
          .order('created_at', { ascending: false });
        if (pickupMsgErr) throw pickupMsgErr;

        // service_update mute: the Phase 5 nudge is exactly the
        // "service event status changes" category the Settings UI
        // exposes. Skip the email AND skip writing the marker so that
        // an un-mute later in the week still surfaces the nudge on
        // the next cron tick.
        const mutedServiceUpdate = await loadMutedRecipients(
          supabaseAdmin,
          pickupEvents.map((e: any) => e.primary_contact_email),
          'service_update',
        );

        const now = Date.now();
        const nudgeWindowMs = READY_PICKUP_NUDGE_DAYS * 24 * 60 * 60 * 1000;

        for (const ev of pickupEvents as any[]) {
          if (!ev.primary_contact_email) continue;
          if (isRecipientMuted(ev.primary_contact_email, mutedServiceUpdate)) continue;

          const eventMessages = (pickupMessages || []).filter((m: any) => m.event_id === ev.id);
          // The mark_ready event is the FIRST mechanic status_update on
          // the event — any later mechanic message is a follow-up that
          // would slide the nudge timer forward. `pickupMessages` is
          // ordered desc, so the original mark-ready is the last entry
          // in this filtered list.
          const mechanicStatusUpdates = eventMessages.filter(
            (m: any) => m.sender === 'mechanic' && m.message_type === 'status_update'
          );
          const markReady = mechanicStatusUpdates[mechanicStatusUpdates.length - 1];
          if (!markReady) continue;

          const markReadyTime = new Date(markReady.created_at).getTime();
          if (now - markReadyTime < nudgeWindowMs) continue; // not stale yet

          // Has a nudge already been sent within the current window?
          const existingNudge = eventMessages.find(
            (m: any) =>
              m.sender === 'system' &&
              typeof m.message === 'string' &&
              m.message.includes(READY_PICKUP_NUDGE_MARKER)
          );
          if (existingNudge) {
            const lastNudgeTime = new Date(existingNudge.created_at).getTime();
            if (now - lastNudgeTime < nudgeWindowMs) continue; // recently reminded
          }

          const aircraft = (aircraftList as any[]).find((a: any) => a.id === ev.aircraft_id);
          if (!aircraft) continue;
          const safeTail = escapeHtml(aircraft.tail_number);

          try {
            await resend.emails.send({
              from: `Skyward Aircraft Manager <${FROM_EMAIL}>`,
              to: [ev.primary_contact_email],
              subject: `Reminder: ${safeTail} Awaiting Logbook Entry`,
              html: emailShell({
                title: `Awaiting Logbook Entry — ${safeTail}`,
                preheader: `${safeTail} has been ready for pickup for ${READY_PICKUP_NUDGE_DAYS}+ days. Logbook entry needed to close the event.`,
                body: `
                  ${heading('Service Event Still Open', 'warning')}
                  ${paragraph(`Your mechanic marked <strong>${safeTail}</strong> as ready for pickup more than ${READY_PICKUP_NUDGE_DAYS} days ago, but the service event hasn't been closed yet.`)}
                  ${paragraph(`Until you enter the logbook data, maintenance tracking won't reset and the aircraft may remain blocked on the calendar. Open the app to complete the event when you get a moment.`)}
                  ${button(appUrl, 'Enter Logbook Data')}
                `,
                preferencesUrl: `${appUrl}#settings`,
              }),
            });

            // Only insert the nudge marker if the email actually went
            // out — otherwise we'd suppress the retry on the next tick.
            // Log marker-insert failures so the duplicate-email storm
            // they cause is at least visible in the cron log instead of
            // looking like the dedup logic just stopped working.
            const { error: markerErr } = await supabaseAdmin
              .from('aft_event_messages')
              .insert({
                event_id: ev.id,
                sender: 'system',
                message_type: 'status_update',
                message: `${READY_PICKUP_NUDGE_MARKER} Reminder sent to primary contact — aircraft awaiting logbook entry.`,
              } as any);
            if (markerErr) {
              console.error(
                `[cron/mx-reminders] pickup nudge marker insert failed for event ${ev.id} — next tick will re-send the email:`,
                markerErr.message,
              );
            }
          } catch (err: any) {
            console.error(`[cron/mx-reminders] pickup nudge email failed for event ${ev.id}:`, err?.message || err);
          }
        }
      }
    }

    // =====================================================
    // BATCH ALL FLAG UPDATES
    // Group by identical flag combinations for fewer DB calls
    // =====================================================
    const updateGroups: Record<string, string[]> = {};
    for (const { id, flags } of flagUpdates) {
      const key = JSON.stringify(flags);
      if (!updateGroups[key]) updateGroups[key] = [];
      updateGroups[key].push(id);
    }

    for (const [flagsJson, ids] of Object.entries(updateGroups)) {
      const flags = JSON.parse(flagsJson);
      // Batch in groups of 100 to avoid query size limits. Log on
      // failure but don't throw — the email already went out, so the
      // worst case from an unflipped flag is one duplicate reminder
      // on the next tick, not a missed alert. Killing the cron here
      // would also forfeit any successfully-flipped earlier batches.
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { error: flagErr } = await supabaseAdmin
          .from('aft_maintenance_items')
          .update(flags)
          .in('id', batch);
        if (flagErr) {
          console.error(
            `[cron/mx-reminders] flag-flip failed (batch of ${batch.length}, flags=${flagsJson}):`,
            flagErr.message,
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
