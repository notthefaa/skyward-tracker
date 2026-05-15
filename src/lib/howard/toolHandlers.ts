import type { SupabaseClient } from '@supabase/supabase-js';
import { tavily } from '@tavily/core';
import OpenAI from 'openai';
import { computeAirworthinessStatus } from '@/lib/airworthiness';
import { computeMetrics, processMxItem } from '@/lib/math';
import { syncAdsForAircraft } from '@/lib/drs';
import { logEvent } from '@/lib/requestId';
import { isIsoDate, isIsoDateTime, parseFiniteNumber } from '@/lib/validation';
import { getOilConsumptionStatus, hoursSinceLastOilAdd } from '@/lib/oilConsumption';
import { NETWORK_TIMEOUT_MS, HOWARD_TOOL_TIMEOUT_MS } from '@/lib/constants';
import { todayInZone } from '@/lib/pilotTime';
import { getNmsBaseUrl, getNmsToken, hasNmsCredentials, invalidateNmsToken } from '@/lib/nms/auth';
import { proposeAction, type ActionType } from './proposedActions';

// Allow-list for aft_aircraft_equipment.category. Must match the
// UI-level selector + airworthiness `has('elt')` checks. If Claude
// hallucinates "battery" or "GPS_Primary", the DB accepts the string
// but downstream filters never find it again — silent data loss.
const EQUIPMENT_CATEGORIES = new Set([
  'engine', 'propeller', 'avionics', 'transponder', 'altimeter',
  'pitot_static', 'elt', 'adsb', 'autopilot', 'gps', 'radio',
  'intercom', 'instrument', 'landing_gear', 'lighting', 'accessory', 'other',
]);

export interface ToolContext {
  userId: string;
  threadId: string;
  /** Filled in by executeTool after resolving params.tail. Empty for global tools. */
  aircraftId: string;
  /** Filled in by executeTool after resolving params.tail. Empty for global tools. */
  aircraftTail: string;
  /** Optional hint: aircraft currently selected in the UI. */
  currentTail?: string | null;
  /** IANA timezone reported by the pilot's browser. Forwarded into
   * propose_onboarding_setup so the new aircraft's time_zone is set
   * accurately on first save — saves the pilot from fighting Zulu
   * briefings until they think to edit the aircraft profile. */
  timeZone?: string;
}

type ToolHandler = (params: any, sb: SupabaseClient, aircraftId: string, ctx: ToolContext) => Promise<any>;

function clampLimit(limit: any, defaultVal = 10, max = 50): number {
  const n = Number(limit) || defaultVal;
  return Math.min(Math.max(1, n), max);
}

/**
 * Normalize an airport identifier to ICAO form where we can. Most
 * continental-US airports have ICAO = "K" + FAA 3-letter code (CMA → KCMA).
 * Hawaii / Alaska / international prefixes (PH, PA, CY, etc.) don't follow
 * this rule, so we only prepend K for 3-letter US-style codes. 4+ chars
 * pass through as-is. Non-alpha input is passed through too — let Howard
 * catch and correct it conversationally if it matters.
 */
function normalizeIcao(raw: string): string {
  const s = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return `K${s}`;
  return s;
}

// ─── Tavily web_search per-user daily cap ────────────────────────
// SQL-backed counter (migration 048) so the cap holds across
// regional serverless instances. The RPC does check + increment
// atomically behind SELECT FOR UPDATE so concurrent calls from
// the same user serialize and can't both squeak past the cap.
// On RPC failure we fall back to "denied" — Tavily is paid-per-
// call, same cost-protection logic as the rate limiter.
const WEB_SEARCH_DAILY_CAP = 20;

async function checkAndRecordWebSearch(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('howard_web_search_check', {
    p_user_id: userId,
    p_max: WEB_SEARCH_DAILY_CAP,
  });
  if (error || !data || data.length === 0) {
    if (error) console.warn('[web_search] cap RPC failed, denying:', error.message);
    return false;
  }
  return !!(data[0] as { allowed: boolean }).allowed;
}

/**
 * Per-tool-call aircraft access verification. Belt-and-suspenders against
 * prompt-injection — the request-level check already ran, but we want the
 * window between that check and each tool call to be narrow.
 */
async function verifyAccess(sb: SupabaseClient, userId: string, aircraftId: string): Promise<boolean> {
  // Global admins bypass. Throw on read errors instead of silently
  // treating a transient blip as "no role" → false → tool returns
  // "no aircraft in fleet". Same shape as the SWR-fetcher fix.
  const { data: role, error: roleErr } = await sb
    .from('aft_user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (roleErr) throw roleErr;
  if (role?.role === 'admin') return true;

  const { data: access, error: accessErr } = await sb
    .from('aft_user_aircraft_access')
    .select('aircraft_role')
    .eq('user_id', userId)
    .eq('aircraft_id', aircraftId)
    .maybeSingle();
  if (accessErr) throw accessErr;
  return !!access;
}

/**
 * Resolve a user-supplied tail number to an aircraft_id the caller has
 * access to. Returns a clear error message Howard can surface to the
 * user if the aircraft doesn't exist, is deleted, or isn't accessible.
 */
async function resolveAircraftFromTail(
  sb: SupabaseClient,
  userId: string,
  tail: unknown,
): Promise<{ ok: true; aircraftId: string; tail: string } | { ok: false; error: string }> {
  if (!tail || typeof tail !== 'string') {
    return { ok: false, error: 'Aircraft tail number is required. Ask the user which aircraft they mean.' };
  }
  const normalized = tail.toUpperCase().trim();
  const { data: aircraft, error: lookupErr } = await sb
    .from('aft_aircraft')
    .select('id, tail_number')
    .eq('tail_number', normalized)
    .is('deleted_at', null)
    .maybeSingle();
  // Throw on supabase read error — swallowing turned "transient DB
  // blip" into "no aircraft N123 in the user's hangar," and Howard
  // confidently told the pilot their aircraft didn't exist. Same
  // pattern as the SWR-fetcher-error-swallow feedback memory.
  if (lookupErr) throw lookupErr;
  // Same error message for "doesn't exist" and "exists but not yours"
  // — leaking the distinction lets one user enumerate which tails
  // belong to other users' fleets.
  if (!aircraft) {
    return { ok: false, error: `No aircraft ${normalized} in the user's hangar.` };
  }
  const allowed = await verifyAccess(sb, userId, aircraft.id);
  if (!allowed) {
    return { ok: false, error: `No aircraft ${normalized} in the user's hangar.` };
  }
  return { ok: true, aircraftId: aircraft.id, tail: aircraft.tail_number };
}

const handlers: Record<string, ToolHandler> = {
  get_flight_logs: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    let query = sb.from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.date_from) query = query.gte('occurred_at', params.date_from);
    if (params.date_to) query = query.lte('occurred_at', params.date_to);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, logs: data };
  },

  get_maintenance_items: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit, 25, 100);
    let itemsQ = sb.from('aft_maintenance_items')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true })
      .limit(limit);
    if (params.tracking_type) itemsQ = itemsQ.eq('tracking_type', params.tracking_type);
    if (params.required_only) itemsQ = itemsQ.eq('is_required', true);

    // Enrich each row with the same burnRate-derived projection the
    // MaintenanceTab UI shows, so Howard doesn't quote raw "due in 50
    // hours" while the screen reads "due in 50 hrs (~71 days)". Without
    // this Howard improvises a days-estimate (or omits one), and
    // pilots get inconsistent urgency framing across surfaces. Logs
    // sorted ascending by occurred_at (computeMetrics contract).
    const [itemsRes, acRes, logsRes] = await Promise.all([
      itemsQ,
      sb.from('aft_aircraft')
        .select('total_engine_time, engine_type, time_zone')
        .eq('id', aircraftId).maybeSingle(),
      sb.from('aft_flight_logs')
        .select('aircraft_id, ftt, tach, created_at, occurred_at')
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: true })
        .limit(500),
    ]);

    if (itemsRes.error) return { error: itemsRes.error.message };
    const rows = itemsRes.data || [];
    const aircraft = acRes.data;
    const logs = (logsRes.data || []) as any[];

    let enriched = rows;
    if (aircraft) {
      const { burnRate, burnRateLow, burnRateHigh } = computeMetrics(aircraft, logs);
      enriched = rows.map((row: any) => {
        const p = processMxItem(
          row,
          aircraft.total_engine_time ?? 0,
          burnRate,
          burnRateLow,
          burnRateHigh,
          aircraft.time_zone ?? null,
        );
        return {
          ...row,
          due_text: p.dueText,
          is_expired: p.isExpired,
          hours_remaining: p.remaining,
          projected_days: Number.isFinite(p.projectedDays) ? p.projectedDays : null,
        };
      });
    }

    return { count: enriched.length, items: enriched };
  },

  get_service_events: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    let query = sb.from('aft_maintenance_events')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.status) query = query.eq('status', params.status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, events: data };
  },

  get_event_line_items: async (params, sb, aircraftId) => {
    if (!params.event_id) return { error: 'event_id is required' };

    const { data: ev, error: evErr } = await sb
      .from('aft_maintenance_events')
      .select('id, aircraft_id, deleted_at')
      .eq('id', params.event_id)
      .maybeSingle();
    if (evErr) return { error: evErr.message };
    if (!ev || ev.aircraft_id !== aircraftId || ev.deleted_at) {
      return { error: 'Event not found for this aircraft.' };
    }

    const limit = clampLimit(params.limit, 50, 100);
    const { data, error } = await sb.from('aft_event_line_items')
      .select('*')
      .eq('event_id', params.event_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return { error: error.message };
    return { count: (data || []).length, line_items: data };
  },

  get_event_messages: async (params, sb, aircraftId) => {
    if (!params.event_id) return { error: 'event_id is required' };

    const { data: ev, error: evErr } = await sb
      .from('aft_maintenance_events')
      .select('id, aircraft_id, deleted_at')
      .eq('id', params.event_id)
      .maybeSingle();
    if (evErr) return { error: evErr.message };
    if (!ev || ev.aircraft_id !== aircraftId || ev.deleted_at) {
      return { error: 'Event not found for this aircraft.' };
    }

    const limit = clampLimit(params.limit, 30, 100);
    const { data, error } = await sb.from('aft_event_messages')
      .select('id, sender, message_type, message, proposed_date, attachments, created_at')
      .eq('event_id', params.event_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return { error: error.message };
    return { count: (data || []).length, messages: data };
  },

  get_fuel_state: async (_params, sb, aircraftId) => {
    const { data: ac, error: acErr } = await sb.from('aft_aircraft')
      .select('tail_number, current_fuel_gallons, fuel_last_updated')
      .eq('id', aircraftId)
      .maybeSingle();
    if (acErr) return { error: acErr.message };
    if (!ac) return { error: 'Aircraft not found.' };

    const { data: recentLogs } = await sb.from('aft_flight_logs')
      .select('occurred_at, created_at, pod, poa, initials, fuel_gallons, hobbs, tach')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5);

    const lastUpdated = (ac as any).fuel_last_updated;
    // Floor at 0 — a future timestamp (clock skew, manual edit) would
    // otherwise surface as "-3 days stale" which misleads the pilot.
    const staleDays = lastUpdated
      ? Math.max(0, Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 86400000))
      : null;

    return {
      tail_number: (ac as any).tail_number,
      current_fuel_gallons: (ac as any).current_fuel_gallons,
      fuel_last_updated: lastUpdated,
      stale_days: staleDays,
      note: 'Fuel is manually tracked. If stale_days is high, the current reading may not reflect the aircraft\'s actual state.',
      recent_flight_fuel: recentLogs || [],
    };
  },

  list_documents: async (params, sb, aircraftId) => {
    let query = sb.from('aft_documents')
      .select('id, filename, doc_type, status, page_count, created_at')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('doc_type', { ascending: true })
      .order('created_at', { ascending: false });
    if (params.doc_type) query = query.eq('doc_type', params.doc_type);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, documents: data };
  },

  get_squawks: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    let query = sb.from('aft_squawks')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.status && params.status !== 'all') query = query.eq('status', params.status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    // Strip pictures arrays — they hold /storage/v1/object/public/ URLs
    // for a now-private bucket. Claude would render them as markdown
    // links and the user click would 400 + ORB. Surface a count instead
    // so Howard can still say "3 photos attached" without leaking dead
    // links into the chat.
    const sanitized = (data || []).map((sq: any) => {
      const picCount = Array.isArray(sq.pictures) ? sq.pictures.length : 0;
      const { pictures: _drop, ...rest } = sq;
      return picCount > 0 ? { ...rest, picture_count: picCount } : rest;
    });
    return { count: sanitized.length, squawks: sanitized };
  },

  get_notes: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    const { data, error } = await sb.from('aft_notes')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    // Same private-bucket strip as get_squawks above.
    const sanitized = (data || []).map((n: any) => {
      const picCount = Array.isArray(n.pictures) ? n.pictures.length : 0;
      const { pictures: _drop, ...rest } = n;
      return picCount > 0 ? { ...rest, picture_count: picCount } : rest;
    });
    return { count: sanitized.length, notes: sanitized };
  },

  get_reservations: async (params, sb, aircraftId) => {
    // aft_reservations has no deleted_at column — soft-delete is via
    // status='cancelled'. The prior .is('deleted_at', null) filter sent
    // every reservation tool call into a PostgREST 400, returning
    // { error: 'column ... does not exist' } and blocking every
    // reservation-aware Howard reply.
    const limit = clampLimit(params.limit, 25, 100);
    let query = sb.from('aft_reservations')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .order('start_time', { ascending: true })
      .limit(limit);
    if (params.status) query = query.eq('status', params.status);
    else query = query.eq('status', 'confirmed');
    if (params.date_from) query = query.gte('start_time', params.date_from);
    if (params.date_to) query = query.lte('start_time', params.date_to);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, reservations: data };
  },

  get_vor_checks: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    const { data, error } = await sb.from('aft_vor_checks')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    return { count: (data || []).length, vor_checks: data };
  },

  get_tire_and_oil_logs: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    const type = params.type || 'both';
    const result: any = {};

    if (type === 'tire' || type === 'both') {
      const { data, error } = await sb.from('aft_tire_checks')
        .select('*')
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return { error: error.message };
      result.tire_checks = data;
      result.tire_count = (data || []).length;
    }

    if (type === 'oil' || type === 'both') {
      const { data, error } = await sb.from('aft_oil_logs')
        .select('*')
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return { error: error.message };

      // Each log stores the pre-add dipstick reading in `oil_qty` plus
      // the amount added (null for level checks). Derive the post-add
      // state here so Howard doesn't have to do the arithmetic in his
      // head — he surfaces the end-state cleanly when the pilot asks.
      result.oil_logs = (data || []).map((l: any) => ({
        ...l,
        level_before_add: l.oil_qty,
        level_after_add: (l.oil_qty ?? 0) + (l.oil_added ?? 0),
      }));
      result.oil_count = (data || []).length;

      // Consumption status — the same "hours since last add" signal the
      // Ops Checks dial uses. Howard MUST flag orange/red in his reply
      // (see system prelude "Oil consumption" rule). Engine type drives
      // the threshold band (turbine and piston have different normals).
      const { data: ac } = await sb.from('aft_aircraft')
        .select('total_engine_time, engine_type')
        .eq('id', aircraftId)
        .maybeSingle();
      const currentHrs = (ac as any)?.total_engine_time ?? null;
      const engineType = (ac as any)?.engine_type === 'Turbine' ? 'Turbine' : 'Piston';
      // Need a full count of add events (rows with oil_added > 0), not
      // just whether one exists — the helper holds back red/orange until
      // there are at least 2 adds on file. The fetched `data` slice is
      // already capped at `limit`; query the count directly so we don't
      // miss older adds beyond the recent-N window.
      const { count: addEventCount } = await sb.from('aft_oil_logs')
        .select('id', { count: 'exact', head: true })
        .eq('aircraft_id', aircraftId)
        .is('deleted_at', null)
        .gt('oil_added', 0);
      const lastAdd = (data || []).find((l: any) => (l.oil_added ?? 0) > 0) || null;
      const hrsSince = hoursSinceLastOilAdd(lastAdd?.engine_hours ?? null, currentHrs);
      result.consumption_status = getOilConsumptionStatus(hrsSince, engineType, addEventCount ?? 0);
    }

    return result;
  },

  get_system_settings: async (_params, sb) => {
    const { data, error } = await sb.from('aft_system_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) return { error: error.message };
    return { settings: data };
  },

  search_documents: async (params, sb, aircraftId) => {
    if (!params.query || typeof params.query !== 'string') return { error: 'Search query is required.' };
    try {
      const openai = new OpenAI();
      // AbortSignal bound on the embeddings call. The OpenAI SDK
      // doesn't honor the outer withToolTimeout — without this a
      // hung embeddings request keeps running on the next tick and
      // bills the token quota.
      const embResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: params.query,
      }, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
      const queryEmbedding = embResponse.data[0].embedding;

      const { data: chunks, error } = await sb.rpc('match_document_chunks', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_aircraft_id: aircraftId,
        match_count: 5,
        match_threshold: 0.3,
      });

      if (error) return { error: error.message };
      if (!chunks || chunks.length === 0) return { message: 'No relevant document sections found. The aircraft may not have any documents uploaded yet.' };

      // Enrich with document metadata. The stored `file_url` (a
      // `getPublicUrl()` value) 400s + ORBs on direct fetch because the
      // bucket is private — so we synthesize a stable, never-expiring
      // viewer URL: `/api/documents/<id>/view?page=N`. That route
      // auth-checks, signs, and 302s to the real signed URL with a
      // `#page=N` fragment so the PDF viewer opens to the cited page.
      // Claude can render this as a markdown link directly.
      const docIds = Array.from(new Set(chunks.map((c: any) => c.document_id)));
      const { data: docs } = await sb.from('aft_documents')
        .select('id, filename, doc_type')
        .in('id', docIds);
      const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

      return {
        results: chunks.map((c: any) => ({
          document: docMap.get(c.document_id)?.filename || 'Unknown',
          doc_type: docMap.get(c.document_id)?.doc_type || 'Unknown',
          document_id: c.document_id,
          page_number: c.page_number || null,
          chunk_index: c.chunk_index,
          content: c.content,
          relevance: (c.similarity * 100).toFixed(0) + '%',
          file_url: c.page_number
            ? `/api/documents/${c.document_id}/view?page=${c.page_number}`
            : `/api/documents/${c.document_id}/view`,
        })),
      };
    } catch (err: any) {
      return { error: `Document search failed: ${err.message}` };
    }
  },

  web_search: async (params, sb, _aircraftId, ctx) => {
    if (!params.query || typeof params.query !== 'string') return { error: 'Search query is required.' };
    // Per-user daily Tavily cap, enforced cross-instance via the
    // howard_web_search_check RPC (migration 048). Tavily is paid-
    // per-call; without a cap a runaway prompt loop can rack up
    // real money in seconds.
    if (!(await checkAndRecordWebSearch(sb, ctx.userId))) {
      logEvent('howard_web_search_capped', { user_id: ctx.userId });
      return { error: 'Daily web-search limit reached. Try again tomorrow or rephrase without needing a fresh search.' };
    }
    try {
      const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
      // `advanced` depth pulls richer page content and ranks more
      // aggressively than `basic`. Destination queries ("fly-in
      // breakfast within 200mi of KVNY") were returning too few + too
      // shallow results on basic — Howard would latch onto whatever
      // listicle ranked first, missing closer and more popular spots.
      // Tavily's SDK doesn't expose an AbortSignal, so we race the
      // search against a hard deadline — a hung upstream otherwise
      // holds the Howard round open until Vercel's maxDuration kills
      // the whole response.
      const response = await Promise.race([
        client.search(params.query, {
          maxResults: 10,
          searchDepth: 'advanced',
          includeAnswer: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('web_search_timeout')), NETWORK_TIMEOUT_MS),
        ),
      ]) as any;
      return {
        answer: response.answer || null,
        results: (response.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content?.slice(0, 800),
        })),
      };
    } catch (err: any) {
      if (err?.message === 'web_search_timeout') {
        logEvent('howard_web_search_timeout', { query_len: params.query.length });
        return { error: `Web search timed out after ${Math.round(NETWORK_TIMEOUT_MS / 1000)}s. Try a narrower query or tell the user search is slow right now.` };
      }
      return { error: `Web search failed: ${err.message}` };
    }
  },

  get_weather_briefing: async (params) => {
    if (!params.airports || !Array.isArray(params.airports) || params.airports.length === 0) {
      return { error: 'At least one airport ICAO code is required.' };
    }
    const normalized = params.airports.map(normalizeIcao);
    const ids = normalized.join(',');
    try {
      // allSettled so a hung TAF pull doesn't drop METARs (or vice
      // versa). NETWORK_TIMEOUT_MS still bounds each leg.
      const [metarSettled, tafSettled] = await Promise.allSettled([
        fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=2`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }),
        fetch(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }),
      ]);
      const metars = metarSettled.status === 'fulfilled' && metarSettled.value.ok
        ? await metarSettled.value.json().catch(() => [])
        : [];
      const tafs = tafSettled.status === 'fulfilled' && tafSettled.value.ok
        ? await tafSettled.value.json().catch(() => [])
        : [];
      const partial: string[] = [];
      if (metarSettled.status !== 'fulfilled' || !metarSettled.value.ok) partial.push('metars');
      if (tafSettled.status !== 'fulfilled' || !tafSettled.value.ok) partial.push('tafs');
      return {
        source: 'aviationweather.gov (NOAA AWC)',
        metars: Array.isArray(metars) ? metars : [],
        tafs: Array.isArray(tafs) ? tafs : [],
        airports_queried: normalized,
        ...(partial.length > 0 ? { partial_failure: partial } : {}),
      };
    } catch (err: any) {
      return { error: `Weather fetch failed: ${err.message}` };
    }
  },

  search_ads: async (params, sb, aircraftId) => {
    const includeSuperseded = !!params.include_superseded;
    let query = sb.from('aft_airworthiness_directives')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('next_due_date', { ascending: true, nullsFirst: false });
    if (!includeSuperseded) query = query.eq('is_superseded', false);

    const { data: ads, error } = await query;
    if (error) return { error: error.message };

    const { data: ac } = await sb.from('aft_aircraft')
      .select('total_engine_time, time_zone')
      .eq('id', aircraftId)
      .maybeSingle();
    const et = (ac as any)?.total_engine_time || 0;
    // "Today" in the aircraft's local zone, not the Vercel UTC clock —
    // a pilot in PDT at 23:00 local would otherwise see ADs due
    // tomorrow flagged as overdue (UTC has already rolled over).
    // todayInZone returns YYYY-MM-DD; parse as UTC midnight so the
    // diffing math against next_due_date (also a YYYY-MM-DD string
    // parsed as UTC midnight below) is consistent.
    const todayYmd = todayInZone((ac as any)?.time_zone);
    const today = new Date(todayYmd + 'T00:00:00Z');

    const annotated = (ads || []).map((a: any) => {
      const timeOverdue = a.next_due_time != null && et >= a.next_due_time;
      const dateOverdue = a.next_due_date != null &&
        new Date(a.next_due_date + 'T00:00:00Z') < today;
      const overdue = timeOverdue || dateOverdue;
      const daysOut = a.next_due_date
        ? Math.round((new Date(a.next_due_date + 'T00:00:00Z').getTime() - today.getTime()) / 86400000)
        : null;
      const hrsOut = a.next_due_time != null ? a.next_due_time - et : null;
      let status: 'overdue' | 'due_soon' | 'compliant' = 'compliant';
      if (overdue) status = 'overdue';
      else if ((daysOut != null && daysOut <= 30) || (hrsOut != null && hrsOut <= 10)) status = 'due_soon';
      return { ...a, _status: status, _days_out: daysOut, _hours_out: hrsOut };
    });

    const filterBy = params.status && params.status !== 'all' ? params.status : null;
    const filtered = filterBy ? annotated.filter(a => a._status === filterBy) : annotated;
    return { count: filtered.length, ads: filtered };
  },

  refresh_ads_drs: async (_params, sb, aircraftId) => {
    const { data: ac } = await sb.from('aft_aircraft')
      .select('id, make, model, aircraft_type, engine_type')
      .eq('id', aircraftId)
      .maybeSingle();
    if (!ac) return { error: 'Aircraft not found.' };
    const result = await syncAdsForAircraft(sb, ac as any);
    return result;
  },

  get_equipment: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit, 50, 100);
    let query = sb.from('aft_aircraft_equipment')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('category', { ascending: true })
      .limit(limit);
    if (params.category) query = query.eq('category', params.category);
    if (!params.include_removed) query = query.is('removed_at', null);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, equipment: data };
  },

  check_airworthiness: async (_params, sb, aircraftId) => {
    const [acRes, eqRes, mxRes, sqRes, adRes] = await Promise.all([
      sb.from('aft_aircraft')
        .select('id, tail_number, total_engine_time, is_ifr_equipped, is_for_hire')
        .eq('id', aircraftId).maybeSingle(),
      sb.from('aft_aircraft_equipment').select('*')
        .eq('aircraft_id', aircraftId).is('deleted_at', null).is('removed_at', null),
      sb.from('aft_maintenance_items').select('*')
        .eq('aircraft_id', aircraftId).is('deleted_at', null),
      sb.from('aft_squawks').select('affects_airworthiness, location, status')
        .eq('aircraft_id', aircraftId).is('deleted_at', null).eq('status', 'open'),
      sb.from('aft_airworthiness_directives').select('*')
        .eq('aircraft_id', aircraftId).is('deleted_at', null).eq('is_superseded', false),
    ]);

    // Surface read errors instead of degrading silently. A swallowed
    // error here makes Howard report an aircraft as airworthy with the
    // missing-data input absent — pilots rely on this verdict for go/
    // no-go decisions.
    const readErr = acRes.error || eqRes.error || mxRes.error || sqRes.error || adRes.error;
    if (readErr) return { error: `Couldn't load airworthiness inputs: ${readErr.message}` };

    if (!acRes.data) return { error: 'Aircraft not found.' };

    const equipment = (eqRes.data || []) as any[];
    const mxItems = mxRes.data || [];
    const squawks = (sqRes.data || []) as any[];
    const ads = (adRes.data || []) as any[];
    const isIfr = (acRes.data as any).is_ifr_equipped === true;

    const verdict = computeAirworthinessStatus({
      aircraft: acRes.data as any,
      equipment: equipment as any,
      mxItems,
      squawks,
      ads: ads as any,
    });

    // Data-completeness flags. A "airworthy" verdict can be misleading
    // when the database simply doesn't have the data to flag anything —
    // e.g., equipment list is empty so 91.207/91.411/91.413 checks have
    // nothing to evaluate. Surface what's tracked so Howard can caveat
    // the verdict honestly instead of claiming airworthy on thin data.
    const has = (cat: string) => equipment.some((e: any) => e.category === cat || (cat === 'elt' && e.is_elt));
    const missing_critical_equipment: string[] = [];
    if (!has('elt')) missing_critical_equipment.push('ELT (91.207)');
    if (!has('transponder')) missing_critical_equipment.push('Transponder (91.413)');
    if (isIfr) {
      if (!has('altimeter')) missing_critical_equipment.push('Altimeter (91.411, IFR)');
      if (!has('pitot_static')) missing_critical_equipment.push('Pitot-static (91.411, IFR)');
    }

    const data_completeness = {
      equipment_count: equipment.length,
      mx_item_count: mxItems.length,
      ad_count: ads.length,
      open_squawk_count: squawks.length,
      equipment_tracked: equipment.length > 0,
      mx_tracked: mxItems.length > 0,
      ads_tracked: ads.length > 0,
      missing_critical_equipment,
      is_ifr: isIfr,
      // Combined signal Howard should key on: a "thin" record means
      // an "airworthy" verdict reflects absence-of-data, not
      // confirmed-compliance. Howard MUST caveat when this is true.
      thin_record:
        equipment.length === 0 ||
        mxItems.length === 0 ||
        missing_critical_equipment.length > 0,
    };

    return { ...verdict, data_completeness };
  },

  // ─── Client-side UI action ─────────────────────────────────

  switch_active_aircraft: async (params, sb, _aircraftId, ctx) => {
    if (!params.tail || typeof params.tail !== 'string') {
      return { error: 'tail is required.' };
    }
    // Re-use the same access-checked resolver every aircraft-scoped
    // tool uses — without this a pilot could "switch" to an aircraft
    // they don't have access to and the next tool call would just
    // 403, leaving Howard confused mid-turn.
    const resolved = await resolveAircraftFromTail(sb, ctx.userId, params.tail);
    if (!resolved.ok) return { error: resolved.error };
    // Claude sees a clean success payload. The route's stream layer
    // looks for tool.name === 'switch_active_aircraft' + parses this
    // result to emit the client_action SSE event (see claude.ts).
    return {
      success: true,
      tail: resolved.tail,
      aircraft_id: resolved.aircraftId,
      message: `Switched the app to ${resolved.tail}. Subsequent tool calls in this turn should use this tail.`,
    };
  },

  // Handoff tools — Howard recognizes an intent the chat can't
  // directly fulfill (file/photo upload) and asks the app to open
  // the right form. claude.ts inspects the result + emits a
  // client_action SSE event; AppShell navigates + sessionStorage'd
  // pre-fill is consumed by the destination tab on mount.

  open_documents_uploader: async (params, sb, aircraftId, ctx) => {
    if (!aircraftId) {
      return { error: 'tail is required.' };
    }
    const DOC_TYPES = ['POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Registration', 'Airworthiness Certificate', 'Weight and Balance', 'Other'];
    if (params.doc_type && !DOC_TYPES.includes(params.doc_type)) {
      return { error: `doc_type must be one of: ${DOC_TYPES.join(', ')}` };
    }
    return {
      success: true,
      tail: ctx.aircraftTail,
      aircraft_id: aircraftId,
      doc_type: params.doc_type || 'POH',
      message: `Opening Documents on ${ctx.aircraftTail} so the pilot can pick a file.`,
    };
  },

  open_logbook_scan: async (_params, _sb, aircraftId, ctx) => {
    if (!aircraftId) {
      return { error: 'tail is required.' };
    }
    return {
      success: true,
      tail: ctx.aircraftTail,
      aircraft_id: aircraftId,
      message: `Opening the Track New Item modal on ${ctx.aircraftTail} so the pilot can scan a logbook entry.`,
    };
  },

  open_squawk_form: async (params, sb, aircraftId, ctx) => {
    if (!aircraftId) {
      return { error: 'tail is required.' };
    }
    // Length-cap pre-fill strings — Claude can hand back giant
    // narratives that won't fit the form's character cap.
    const description = typeof params.description === 'string'
      ? params.description.trim().slice(0, 2000)
      : '';
    const location = typeof params.location === 'string'
      ? params.location.trim().slice(0, 100)
      : '';
    return {
      success: true,
      tail: ctx.aircraftTail,
      aircraft_id: aircraftId,
      description,
      location,
      affects_airworthiness: !!params.affects_airworthiness,
      message: `Opening the new-squawk form on ${ctx.aircraftTail} so the pilot can attach a photo and submit.`,
    };
  },

  // ─── Write tools (propose-confirm) ─────────────────────────

  propose_reservation: async (params, sb, _aircraftId, ctx) => {
    if (!params.start_time || !params.end_time || !params.pilot_initials) {
      return { error: 'start_time, end_time, and pilot_initials are required.' };
    }
    // Datetimes, not bare dates — reservations live in `timestamptz`.
    // Claude sometimes returns a partial string like "2025-04-19 14:30".
    if (!isIsoDateTime(params.start_time) || !isIsoDateTime(params.end_time)) {
      return { error: 'start_time and end_time must be full ISO datetimes with a timezone (e.g. "2025-04-19T14:30:00Z" or "2025-04-19T07:30:00-07:00").' };
    }
    if (Date.parse(params.end_time) <= Date.parse(params.start_time)) {
      return { error: 'end_time must be after start_time.' };
    }
    return makeProposal(sb, ctx, 'reservation', params);
  },

  propose_mx_schedule: async (params, sb, aircraftId, ctx) => {
    // Validate mx_item_ids / squawk_ids belong to this aircraft AND
    // aren't soft-deleted. The executor filters deleted_at at run-time
    // and silently drops missing rows; failing fast here means Howard
    // surfaces the stale id back to the user instead of building a
    // proposal whose contents quietly shrink on Confirm.
    if (Array.isArray(params.mx_item_ids) && params.mx_item_ids.length > 0) {
      // Throw on read errors so a transient supabase blip doesn't
      // surface "MX items do not belong to this aircraft" to a pilot
      // who supplied perfectly valid IDs — the validator's "length
      // mismatch" trip would otherwise look indistinguishable from a
      // legitimate stale-id case.
      const { data, error } = await sb.from('aft_maintenance_items')
        .select('id, aircraft_id')
        .in('id', params.mx_item_ids)
        .is('deleted_at', null);
      if (error) throw error;
      const bad = (data || []).find((r: any) => r.aircraft_id !== aircraftId);
      if (bad || (data || []).length !== params.mx_item_ids.length) {
        return { error: 'One or more MX items do not belong to this aircraft or have been deleted.' };
      }
    }
    if (Array.isArray(params.squawk_ids) && params.squawk_ids.length > 0) {
      const { data, error } = await sb.from('aft_squawks')
        .select('id, aircraft_id')
        .in('id', params.squawk_ids)
        .is('deleted_at', null);
      if (error) throw error;
      const bad = (data || []).find((r: any) => r.aircraft_id !== aircraftId);
      if (bad || (data || []).length !== params.squawk_ids.length) {
        return { error: 'One or more squawks do not belong to this aircraft or have been deleted.' };
      }
    }
    return makeProposal(sb, ctx, 'mx_schedule', params);
  },

  propose_squawk_resolve: async (params, sb, aircraftId, ctx) => {
    if (!params.squawk_id || !params.resolution_note) {
      return { error: 'squawk_id and resolution_note are required.' };
    }
    // Trim + cap the resolution note. Claude can produce 10k+ char
    // descriptions; the underlying column likely has a length check
    // and the confirm-time INSERT would fail with a generic
    // "Execution failed." 2000 chars is enough for a real resolution
    // narrative without blowing column constraints.
    if (typeof params.resolution_note === 'string') {
      params.resolution_note = params.resolution_note.trim().slice(0, 2000);
    }
    const { data: sq } = await sb.from('aft_squawks')
      .select('id, aircraft_id, deleted_at, status')
      .eq('id', params.squawk_id).maybeSingle();
    if (!sq || sq.aircraft_id !== aircraftId || sq.deleted_at) {
      return { error: 'Squawk not found for this aircraft.' };
    }
    if (sq.status === 'resolved') {
      return { error: 'Squawk is already resolved.' };
    }
    return makeProposal(sb, ctx, 'squawk_resolve', params);
  },

  propose_note: async (params, sb, _aircraftId, ctx) => {
    if (!params.content || typeof params.content !== 'string' || !params.content.trim()) {
      return { error: 'Note content is required.' };
    }
    // Cap content length at 4000 chars — same rationale as squawk
    // resolve. Longer than squawk because notes legitimately carry
    // pre/post-flight narratives.
    return makeProposal(sb, ctx, 'note', { content: params.content.trim().slice(0, 4000) });
  },

  propose_equipment_entry: async (params, sb, _aircraftId, ctx) => {
    if (!params.name || !params.category) {
      return { error: 'name and category are required.' };
    }
    if (typeof params.category !== 'string' || !EQUIPMENT_CATEGORIES.has(params.category)) {
      return { error: `category must be one of: ${Array.from(EQUIPMENT_CATEGORIES).join(', ')}.` };
    }
    // Trim + length-cap user-visible string fields. Claude can
    // hallucinate arbitrarily long values; pre-fix the proposer
    // succeeded but the confirm-time INSERT failed against the
    // table's column-length constraint, giving the user a generic
    // "Execution failed."
    const STRING_FIELDS = ['name', 'make', 'model', 'serial', 'notes'] as const;
    for (const f of STRING_FIELDS) {
      if (typeof params[f] === 'string') {
        params[f] = params[f].trim().slice(0, 200);
      }
    }
    // Optional date fields — reject malformed strings early so a
    // garbage "2025-13-45" doesn't land in the DB as a text-cast mess
    // that `transponder_due_date` checks then misread as overdue.
    const dateFields = [
      'installed_at', 'transponder_due_date', 'altimeter_due_date',
      'pitot_static_due_date', 'elt_battery_expires',
    ] as const;
    for (const f of dateFields) {
      if (params[f] != null && params[f] !== '' && !isIsoDate(params[f])) {
        return { error: `${f} must be an ISO calendar date (YYYY-MM-DD) if provided.` };
      }
    }
    return makeProposal(sb, ctx, 'equipment', params);
  },

  // ─── Phase 1: chat-native logging ──────────────────────────

  propose_flight_log: async (params, sb, _aircraftId, ctx) => {
    if (!params.initials || typeof params.initials !== 'string') {
      return { error: 'initials is required.' };
    }
    // Require at least one engine-time reading so the executor's
    // log_flight_atomic call has something to anchor against. Tach +
    // FTT are the canonical engine-time readings (piston vs turbine);
    // either covers both engine-type paths.
    const hasMeter = ['tach', 'ftt', 'hobbs', 'aftt'].some(k => {
      const v = params[k];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0;
    });
    if (!hasMeter) {
      return { error: 'At least one engine-time reading (tach, ftt, hobbs, or aftt) is required.' };
    }
    // Sanity-bound the numerics — Claude can hallucinate 9999.99 from
    // an OCR'd hobbs value. submitFlightLog's validateFlightLogInput
    // rejects non-finite/negative but does not cap upper bound; cap
    // here so an absurd reading doesn't poison the aircraft totals
    // (10000 hrs is more than any GA airframe will ever see).
    const NUM_FIELDS = ['tach', 'ftt', 'hobbs', 'aftt', 'landings', 'engine_cycles', 'fuel_gallons'] as const;
    for (const f of NUM_FIELDS) {
      const v = params[f];
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          return { error: `${f} must be a non-negative finite number.` };
        }
        if (f === 'tach' || f === 'ftt' || f === 'hobbs' || f === 'aftt') {
          if (n > 100000) return { error: `${f} is implausibly large.` };
        }
        params[f] = n;
      }
    }
    if (params.occurred_at && !isIsoDateTime(params.occurred_at)) {
      return { error: 'occurred_at must be a full ISO datetime with timezone if provided.' };
    }
    params.initials = String(params.initials).trim().toUpperCase().slice(0, 3);
    if (typeof params.pod === 'string') params.pod = params.pod.trim().toUpperCase().slice(0, 8);
    if (typeof params.poa === 'string') params.poa = params.poa.trim().toUpperCase().slice(0, 8);
    if (typeof params.trip_reason === 'string') params.trip_reason = params.trip_reason.trim().slice(0, 100);
    if (typeof params.pax_info === 'string') params.pax_info = params.pax_info.trim().slice(0, 500);
    return makeProposal(sb, ctx, 'flight_log', params);
  },

  propose_maintenance_item: async (params, sb, _aircraftId, ctx) => {
    if (!params.item_name || typeof params.item_name !== 'string' || !params.item_name.trim()) {
      return { error: 'item_name is required.' };
    }
    if (params.tracking_type !== 'time' && params.tracking_type !== 'date' && params.tracking_type !== 'both') {
      return { error: 'tracking_type must be "time", "date", or "both".' };
    }
    if (params.tracking_type === 'time' || params.tracking_type === 'both') {
      const n = parseFiniteNumber(params.time_interval, { min: 0 });
      if (n === undefined || n === null || n <= 0) {
        return { error: 'time_interval (hours) must be a positive number for time-based or both-based tracking.' };
      }
      params.time_interval = n;
      if (params.last_completed_time !== undefined && params.last_completed_time !== null) {
        const lct = parseFiniteNumber(params.last_completed_time, { min: 0 });
        if (lct === undefined) return { error: 'last_completed_time must be a non-negative number if provided.' };
        params.last_completed_time = lct;
      }
    }
    if (params.tracking_type === 'date' || params.tracking_type === 'both') {
      const n = parseFiniteNumber(params.date_interval_days, { min: 0 });
      if (n === undefined || n === null || n <= 0) {
        return { error: 'date_interval_days must be a positive number for date-based or both-based tracking.' };
      }
      params.date_interval_days = Math.trunc(n);
      if (params.last_completed_date != null && params.last_completed_date !== '') {
        if (!isIsoDate(params.last_completed_date)) {
          return { error: 'last_completed_date must be a YYYY-MM-DD date if provided.' };
        }
      }
    }
    params.item_name = params.item_name.trim().slice(0, 200);
    if (typeof params.far_reference === 'string') params.far_reference = params.far_reference.trim().slice(0, 50);
    if (typeof params.notes === 'string') params.notes = params.notes.trim().slice(0, 1000);
    return makeProposal(sb, ctx, 'mx_item', params);
  },

  propose_squawk: async (params, sb, _aircraftId, ctx) => {
    if (!params.description || typeof params.description !== 'string' || !params.description.trim()) {
      return { error: 'description is required.' };
    }
    if (!params.initials || typeof params.initials !== 'string') {
      return { error: 'initials is required.' };
    }
    if (params.occurred_at && !isIsoDateTime(params.occurred_at)) {
      return { error: 'occurred_at must be a full ISO datetime with timezone if provided.' };
    }
    params.description = params.description.trim().slice(0, 2000);
    if (typeof params.location === 'string') params.location = params.location.trim().slice(0, 100);
    params.initials = String(params.initials).trim().toUpperCase().slice(0, 3);
    params.affects_airworthiness = !!params.affects_airworthiness;
    return makeProposal(sb, ctx, 'squawk', params);
  },

  propose_vor_check: async (params, sb, _aircraftId, ctx) => {
    const VOR_TYPES = new Set(['VOT', 'Ground Checkpoint', 'Airborne Checkpoint', 'Dual VOR']);
    if (!params.check_type || !VOR_TYPES.has(params.check_type)) {
      return { error: `check_type must be one of: ${Array.from(VOR_TYPES).join(', ')}.` };
    }
    if (!params.station || typeof params.station !== 'string' || !params.station.trim()) {
      return { error: 'station is required.' };
    }
    const err = parseFiniteNumber(params.bearing_error);
    if (err === undefined || err === null) {
      return { error: 'bearing_error must be a finite number (degrees, signed).' };
    }
    if (Math.abs(err) > 30) {
      return { error: 'bearing_error is implausibly large (more than 30°). Re-confirm with the pilot.' };
    }
    params.bearing_error = err;
    if (!params.initials || typeof params.initials !== 'string') {
      return { error: 'initials is required.' };
    }
    params.station = params.station.trim().slice(0, 50);
    params.initials = String(params.initials).trim().toUpperCase().slice(0, 3);
    if (params.occurred_at && !isIsoDateTime(params.occurred_at)) {
      return { error: 'occurred_at must be a full ISO datetime with timezone if provided.' };
    }
    return makeProposal(sb, ctx, 'vor_check', params);
  },

  propose_oil_log: async (params, sb, _aircraftId, ctx) => {
    const qty = parseFiniteNumber(params.oil_qty, { min: 0 });
    if (qty === undefined || qty === null) {
      return { error: 'oil_qty (pre-add dipstick reading in quarts) is required.' };
    }
    const hrs = parseFiniteNumber(params.engine_hours, { min: 0 });
    if (hrs === undefined || hrs === null) {
      return { error: 'engine_hours is required.' };
    }
    if (!params.initials || typeof params.initials !== 'string') {
      return { error: 'initials is required.' };
    }
    if (qty > 20) return { error: 'oil_qty looks implausibly high (more than 20 qt). Re-confirm with the pilot.' };
    params.oil_qty = qty;
    params.engine_hours = hrs;
    if (params.oil_added !== undefined && params.oil_added !== null && params.oil_added !== '') {
      const added = parseFiniteNumber(params.oil_added, { min: 0 });
      if (added === undefined) return { error: 'oil_added must be a non-negative number if provided.' };
      params.oil_added = added;
    }
    params.initials = String(params.initials).trim().toUpperCase().slice(0, 3);
    if (typeof params.notes === 'string') params.notes = params.notes.trim().slice(0, 500);
    if (params.occurred_at && !isIsoDateTime(params.occurred_at)) {
      return { error: 'occurred_at must be a full ISO datetime with timezone if provided.' };
    }
    return makeProposal(sb, ctx, 'oil_log', params);
  },

  propose_tire_check: async (params, sb, _aircraftId, ctx) => {
    if (!params.initials || typeof params.initials !== 'string') {
      return { error: 'initials is required.' };
    }
    const fields = ['nose_psi', 'left_main_psi', 'right_main_psi'] as const;
    let any = false;
    for (const f of fields) {
      if (params[f] === undefined || params[f] === null || params[f] === '') continue;
      const n = parseFiniteNumber(params[f], { min: 0 });
      if (n === undefined) return { error: `${f} must be a non-negative number if provided.` };
      if (n !== null && n > 200) return { error: `${f} is implausibly high (more than 200 PSI).` };
      params[f] = n;
      any = true;
    }
    if (!any) {
      return { error: 'At least one of nose_psi / left_main_psi / right_main_psi must be provided.' };
    }
    params.initials = String(params.initials).trim().toUpperCase().slice(0, 3);
    if (typeof params.notes === 'string') params.notes = params.notes.trim().slice(0, 500);
    if (params.occurred_at && !isIsoDateTime(params.occurred_at)) {
      return { error: 'occurred_at must be a full ISO datetime with timezone if provided.' };
    }
    return makeProposal(sb, ctx, 'tire_check', params);
  },

  // ─── Phase 2: admin / coordination ─────────────────────────

  propose_reservation_cancel: async (params, sb, aircraftId, ctx) => {
    if (!params.reservation_id || typeof params.reservation_id !== 'string') {
      return { error: 'reservation_id is required (UUID from get_reservations).' };
    }
    // Re-verify ownership/admin before proposing. Same gate the
    // executor applies, surfaced earlier so the pilot doesn't get a
    // misleading "I prepared that for you" message followed by an
    // execute-time permission denial.
    const { data: reservation, error: resErr } = await sb
      .from('aft_reservations')
      .select('id, aircraft_id, user_id, status, deleted_at')
      .eq('id', params.reservation_id)
      .maybeSingle();
    if (resErr) throw resErr;
    if (!reservation || reservation.aircraft_id !== aircraftId) {
      return { error: 'Reservation not found on this aircraft.' };
    }
    if (reservation.status === 'cancelled') {
      return { error: 'Reservation is already cancelled.' };
    }
    if (reservation.user_id !== ctx.userId) {
      // Caller isn't the booker — need aircraft-admin or global admin.
      const { data: role } = await sb.from('aft_user_roles').select('role').eq('user_id', ctx.userId).maybeSingle();
      const isGlobalAdmin = role?.role === 'admin';
      if (!isGlobalAdmin) {
        const { data: access } = await sb
          .from('aft_user_aircraft_access')
          .select('aircraft_role')
          .eq('user_id', ctx.userId)
          .eq('aircraft_id', aircraftId)
          .maybeSingle();
        if (!access || access.aircraft_role !== 'admin') {
          return { error: 'You can only cancel your own reservations. Ask an aircraft admin to cancel this one.' };
        }
      }
    }
    if (typeof params.reason === 'string') params.reason = params.reason.trim().slice(0, 500);
    return makeProposal(sb, ctx, 'reservation_cancel', params);
  },

  propose_squawk_defer: async (params, sb, aircraftId, ctx) => {
    if (!params.squawk_id || typeof params.squawk_id !== 'string') {
      return { error: 'squawk_id is required (UUID from get_squawks).' };
    }
    const VALID_CATS = ['MEL', 'CDL', 'NEF', 'MDL'];
    if (!VALID_CATS.includes(params.deferral_category)) {
      return { error: `deferral_category must be one of: ${VALID_CATS.join(', ')}.` };
    }
    if (params.deferral_procedures_completed !== true) {
      return { error: 'deferral_procedures_completed must be true — the PIC confirms §91.213 procedures are complete before deferring.' };
    }
    // Validate squawk belongs to aircraft + isn't already deferred/closed.
    const { data: sq, error: sqErr } = await sb
      .from('aft_squawks')
      .select('id, aircraft_id, deleted_at, status, is_deferred')
      .eq('id', params.squawk_id)
      .maybeSingle();
    if (sqErr) throw sqErr;
    if (!sq || sq.aircraft_id !== aircraftId || sq.deleted_at) {
      return { error: 'Squawk not found on this aircraft.' };
    }
    if (sq.status === 'resolved') {
      return { error: 'Squawk is already resolved — can\'t defer a closed issue.' };
    }
    if (sq.is_deferred) {
      return { error: 'Squawk is already deferred. Edit it from the Squawks tab if details need updating.' };
    }
    // Sanitize string fields.
    const STR_FIELDS = ['mel_number', 'cdl_number', 'nef_number', 'mdl_number', 'mel_control_number', 'full_name', 'certificate_number'] as const;
    for (const f of STR_FIELDS) {
      if (typeof params[f] === 'string') params[f] = params[f].trim().slice(0, 100);
    }
    // Require the matching number for the chosen category.
    const numField = `${params.deferral_category.toLowerCase()}_number`;
    if (!params[numField] || typeof params[numField] !== 'string' || !params[numField].trim()) {
      return { error: `${numField} is required when deferral_category is ${params.deferral_category}.` };
    }
    return makeProposal(sb, ctx, 'squawk_defer', params);
  },

  propose_pilot_invite: async (params, sb, _aircraftId, ctx) => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!params.email || typeof params.email !== 'string' || !EMAIL_RE.test(params.email.trim())) {
      return { error: 'Valid email address is required.' };
    }
    if (params.aircraft_role !== 'pilot' && params.aircraft_role !== 'admin') {
      return { error: 'aircraft_role must be "pilot" or "admin".' };
    }
    params.email = params.email.trim().toLowerCase().slice(0, 200);
    return makeProposal(sb, ctx, 'pilot_invite', params);
  },

  propose_aircraft_update: async (params, sb, _aircraftId, ctx) => {
    // Drop the routing `tail` field — it's resolved into aircraftId
    // by the executeTool wrapper and isn't part of the payload.
    const { tail: _tail, ...rest } = params;
    // Allowlist drop unknown fields before they reach the executor —
    // even though the executor destructure stops them, this also makes
    // the proposed-action card show only legitimate changes.
    const ALLOWED = new Set([
      'home_airport', 'time_zone', 'is_ifr_equipped',
      'main_contact', 'main_contact_phone', 'main_contact_email',
      'mx_contact', 'mx_contact_phone', 'mx_contact_email',
    ]);
    const filtered: Record<string, any> = {};
    let changed = 0;
    for (const k of Object.keys(rest)) {
      if (!ALLOWED.has(k)) continue;
      const v = (rest as Record<string, any>)[k];
      if (v === undefined) continue;
      filtered[k] = v;
      changed++;
    }
    if (changed === 0) {
      return { error: 'At least one updatable field must be provided. Allowed: ' + Array.from(ALLOWED).join(', ') };
    }
    // Validate emails if present — noValidate-style autofill drift is
    // not a risk here, but Claude can fabricate "alex@" or "@example".
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const f of ['main_contact_email', 'mx_contact_email']) {
      if (typeof filtered[f] === 'string' && filtered[f].trim() && !EMAIL_RE.test(filtered[f].trim())) {
        return { error: `${f} doesn't look like a valid email.` };
      }
    }
    // Length-cap user-visible strings to avoid surprises at the DB.
    const STR_FIELDS = ['home_airport', 'time_zone', 'main_contact', 'main_contact_phone', 'main_contact_email', 'mx_contact', 'mx_contact_phone', 'mx_contact_email'] as const;
    for (const f of STR_FIELDS) {
      if (typeof filtered[f] === 'string') filtered[f] = filtered[f].trim().slice(0, 200);
    }
    return makeProposal(sb, ctx, 'aircraft_update', filtered);
  },

  propose_onboarding_setup: async (params, sb, _aircraftId, ctx) => {
    const profile = params?.profile;
    const aircraft = params?.aircraft;
    if (!profile?.full_name || !profile?.initials) {
      return { error: 'profile.full_name and profile.initials are required.' };
    }
    if (!aircraft?.tail_number || !aircraft?.engine_type) {
      return { error: 'aircraft.tail_number and aircraft.engine_type are required.' };
    }
    // Normalize + validate tail format. Claude can hallucinate
    // arbitrarily long values (N12345 with spaces / sentences); the
    // downstream insert against aft_aircraft.tail_number then fails
    // at the column constraint with a generic execution error. FAA
    // N-numbers are N + 1-5 alphanumeric chars. Accept other-country
    // tails (C-, G-, JA, etc.) loosely — just bound the length and
    // strip whitespace.
    const normalizedTail = String(aircraft.tail_number).toUpperCase().replace(/\s+/g, '').trim();
    if (!/^[A-Z0-9-]{2,10}$/.test(normalizedTail)) {
      return { error: 'aircraft.tail_number must be 2-10 alphanumeric characters (e.g. "N123AB").' };
    }
    aircraft.tail_number = normalizedTail;
    // Strict engine_type check — Claude can pass synonyms ("Turboprop",
    // "Jet", "Rotax") that the old `=== 'Turbine' ? : 'Piston'` coerce
    // silently misclassified. The DB CHECK constraint
    // (aft_aircraft_engine_type_check) only allows 'Piston' or 'Turbine',
    // so anything else needs to be bounced here with a clear message
    // rather than a generic 500 at INSERT time.
    if (aircraft.engine_type !== 'Piston' && aircraft.engine_type !== 'Turbine') {
      return { error: 'aircraft.engine_type must be exactly "Piston" or "Turbine" (turboprops count as Turbine).' };
    }
    if (typeof aircraft.is_ifr_equipped !== 'boolean') {
      return { error: 'aircraft.is_ifr_equipped must be true or false — ask if unknown.' };
    }
    // Setup meters go straight into aft_aircraft.total_airframe_time /
    // total_engine_time. NaN or Infinity here poisons every downstream
    // hours-based calc (AD compliance, MX interval projection, fuel
    // burn), so reject non-finite input loudly up front.
    const meterOpts = { min: 0, max: 100000 };
    const setupAftt = parseFiniteNumber(aircraft.setup_aftt, meterOpts);
    const setupFtt = parseFiniteNumber(aircraft.setup_ftt, meterOpts);
    const setupHobbs = parseFiniteNumber(aircraft.setup_hobbs, meterOpts);
    const setupTach = parseFiniteNumber(aircraft.setup_tach, meterOpts);
    if (setupAftt === undefined || setupFtt === undefined || setupHobbs === undefined || setupTach === undefined) {
      return { error: 'setup_aftt, setup_ftt, setup_hobbs, and setup_tach must each be a finite number ≥ 0 if provided.' };
    }
    // Cross-check meters against engine_type. The executor seeds
    // total_airframe_time / total_engine_time from whichever meters
    // arrived; if Claude passes setup_aftt (a turbine field) on a
    // piston aircraft, total_airframe_time gets seeded from the wrong
    // reading and the pilot's first flight log appears to jump 1000+
    // hours when the real hobbs lands. Reject the mismatch with a
    // clear message so Claude re-asks instead of saving garbage.
    if (aircraft.engine_type === 'Turbine') {
      if (setupHobbs !== null || setupTach !== null) {
        return { error: 'Turbine aircraft use setup_aftt and setup_ftt — drop setup_hobbs / setup_tach.' };
      }
    } else {
      if (setupAftt !== null || setupFtt !== null) {
        return { error: 'Piston aircraft use setup_hobbs and setup_tach — drop setup_aftt / setup_ftt.' };
      }
    }
    // Normalize into the payload shape the executor expects.
    const payload = {
      profile: {
        full_name: String(profile.full_name).trim(),
        initials: String(profile.initials).toUpperCase().trim().slice(0, 3),
        faa_ratings: Array.isArray(profile.faa_ratings)
          ? profile.faa_ratings.filter((r: any) => typeof r === 'string')
          : [],
      },
      aircraft: {
        tail_number: String(aircraft.tail_number).toUpperCase().trim(),
        make: aircraft.make ? String(aircraft.make).trim() : undefined,
        model: aircraft.model ? String(aircraft.model).trim() : undefined,
        engine_type: aircraft.engine_type,
        is_ifr_equipped: !!aircraft.is_ifr_equipped,
        home_airport: aircraft.home_airport ? String(aircraft.home_airport).toUpperCase().trim() : undefined,
        // Browser-reported IANA zone passed in via ctx — saves a
        // round-trip with the pilot and avoids leaving every Howard-
        // onboarded aircraft on the column default ('UTC'), which
        // shows Zulu times in Howard briefings until the pilot finds
        // and edits the time-zone picker.
        time_zone: typeof ctx.timeZone === 'string' && ctx.timeZone ? ctx.timeZone : undefined,
        setup_aftt: setupAftt ?? undefined,
        setup_ftt: setupFtt ?? undefined,
        setup_hobbs: setupHobbs ?? undefined,
        setup_tach: setupTach ?? undefined,
      },
    };

    // Onboarding runs before any aircraft exists — makeProposal wants an
    // aircraftId for the standard tools. Inline the proposeAction call
    // here with aircraftId=null and the new aircraft's tail as the
    // summary label.
    const proposal = await proposeAction(sb, {
      threadId: ctx.threadId,
      userId: ctx.userId,
      aircraftId: null,
      aircraftTail: payload.aircraft.tail_number,
      actionType: 'onboarding_setup',
      payload,
    });
    return {
      proposed_action_id: proposal.id,
      summary: proposal.summary,
      requires_confirmation: true,
      note: "Setup card ready. User needs to tap Confirm to finalize their profile and register the aircraft.",
    };
  },

  get_aviation_hazards: async (params) => {
    if (!params.airports || !Array.isArray(params.airports) || params.airports.length === 0) {
      return { error: 'At least one airport ICAO code is required.' };
    }
    const normalized = params.airports.map(normalizeIcao);
    const ids = normalized.join(',');
    try {
      const [pirepSettled, sigmetSettled] = await Promise.allSettled([
        fetch(`https://aviationweather.gov/api/data/pirep?id=${ids}&format=json&age=2`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }),
        fetch(`https://aviationweather.gov/api/data/airsigmet?format=json`, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }),
      ]);
      const pireps = pirepSettled.status === 'fulfilled' && pirepSettled.value.ok
        ? await pirepSettled.value.json().catch(() => [])
        : [];
      const sigmets = sigmetSettled.status === 'fulfilled' && sigmetSettled.value.ok
        ? await sigmetSettled.value.json().catch(() => [])
        : [];
      const partial: string[] = [];
      if (pirepSettled.status !== 'fulfilled' || !pirepSettled.value.ok) partial.push('pireps');
      if (sigmetSettled.status !== 'fulfilled' || !sigmetSettled.value.ok) partial.push('sigmets_airmets');
      return {
        source: 'aviationweather.gov (NOAA AWC)',
        pireps: Array.isArray(pireps) ? pireps.slice(0, 20) : [],
        sigmets_airmets: Array.isArray(sigmets) ? sigmets.slice(0, 15) : [],
        airports_queried: normalized,
        ...(partial.length > 0 ? { partial_failure: partial } : {}),
      };
    } catch (err: any) {
      return { error: `Hazard fetch failed: ${err.message}` };
    }
  },

  get_notams: async (params) => {
    if (!params.airports || !Array.isArray(params.airports) || params.airports.length === 0) {
      return { error: 'At least one airport ICAO code is required.' };
    }

    if (!hasNmsCredentials()) {
      return {
        error: 'FAA NMS API credentials not configured on the server. NOTAMs cannot be pulled — tell the user to have the admin set FAA_NMS_CLIENT_ID and FAA_NMS_CLIENT_SECRET (from the NMS onboarding email) in the environment.',
      };
    }

    let token: string;
    try {
      token = await getNmsToken();
    } catch (err: any) {
      logEvent('howard_notam_auth_failed', { message: err?.message ?? 'unknown' });
      return { error: `FAA NMS authentication failed: ${err?.message ?? 'unknown error'}` };
    }

    const baseUrl = getNmsBaseUrl();
    const airports = params.airports.map(normalizeIcao).filter(Boolean);
    const now = Date.now();
    const results: Record<string, any> = {};

    const fetchNotams = (icao: string, bearer: string) => fetch(
      `${baseUrl}/nmsapi/v1/notams?location=${encodeURIComponent(icao)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          nmsResponseFormat: 'GEOJSON',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      },
    );

    await Promise.all(airports.map(async (icao: string) => {
      try {
        let res = await fetchNotams(icao, token);

        // 401 = our cached token went stale (revoked / rotated
        // server-side). Force a refresh and retry once. After that,
        // give up and surface the error rather than looping forever.
        if (res.status === 401) {
          invalidateNmsToken();
          try {
            token = await getNmsToken();
          } catch (authErr: any) {
            logEvent('howard_notam_auth_failed', { icao, message: authErr?.message ?? 'unknown' });
            results[icao] = { error: `FAA NMS auth retry failed: ${authErr?.message ?? 'unknown error'}` };
            return;
          }
          res = await fetchNotams(icao, token);
        }

        // FAA correlation ID — NAIMES asks for this when reporting
        // issues to 7-AWA-NAIMES@faa.gov. Capture it for every
        // response (success or failure) so failures are traceable.
        const faaRequestId = res.headers.get('x-request-id') || 'none';

        if (!res.ok) {
          logEvent('howard_notam_request_failed', { icao, status: res.status, faa_request_id: faaRequestId });
          results[icao] = { error: `FAA NMS API returned ${res.status} (faa_request_id: ${faaRequestId})` };
          return;
        }

        let data: any;
        try {
          data = await res.json();
        } catch {
          logEvent('howard_notam_parse_failed', { icao, reason: 'json', faa_request_id: faaRequestId });
          results[icao] = { error: `FAA NMS API returned a non-JSON response. (faa_request_id: ${faaRequestId})` };
          return;
        }

        // NMS GEOJSON shape: { status: "Success", data: { geojson: Feature[] } }.
        // Each Feature carries `properties.coreNOTAMData.notam` with the
        // core fields and `properties.coreNOTAMData.notamTranslation`
        // with localized text variants. Emit a telemetry breadcrumb
        // when the path is missing so undocumented shape drift is
        // diagnosable rather than silently empty.
        const features: any[] = Array.isArray(data?.data?.geojson) ? data.data.geojson : [];
        if (!Array.isArray(data?.data?.geojson)) {
          logEvent('howard_notam_parse_failed', {
            icao,
            reason: 'shape',
            faa_request_id: faaRequestId,
            top_keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 10).join(',') : 'none',
          });
          results[icao] = { error: `FAA NMS API response was not in the expected shape. (faa_request_id: ${faaRequestId})` };
          return;
        }

        const items = features
          .map(feature => {
            const core = feature?.properties?.coreNOTAMData?.notam ?? {};
            const translation = Array.isArray(feature?.properties?.coreNOTAMData?.notamTranslation)
              ? feature.properties.coreNOTAMData.notamTranslation
              : [];
            // NMS keys: LOCAL_FORMAT carries `domestic_message`, ICAO
            // carries `icao_message`. Prefer the pilot-readable
            // domestic message; fall back to ICAO format; fall back
            // to the raw `text` field on the notam itself.
            const local = translation.find((t: any) => t?.type === 'LOCAL_FORMAT');
            const icaoTranslation = translation.find((t: any) => t?.type === 'ICAO');
            const formatted =
              (typeof local?.domestic_message === 'string' ? local.domestic_message : '') ||
              (typeof local?.formattedText === 'string' ? local.formattedText : '') ||
              (typeof icaoTranslation?.icao_message === 'string' ? icaoTranslation.icao_message : '') ||
              (typeof core.text === 'string' ? core.text : '') ||
              '';
            return {
              number: typeof core.number === 'string' ? core.number : null,
              type: typeof core.type === 'string' ? core.type : null,
              classification: typeof core.classification === 'string' ? core.classification : null,
              issued: typeof core.issued === 'string' ? core.issued : null,
              effective_start: typeof core.effectiveStart === 'string' ? core.effectiveStart : null,
              effective_end: typeof core.effectiveEnd === 'string' ? core.effectiveEnd : null,
              icao: typeof core.icaoLocation === 'string' ? core.icaoLocation : null,
              text: formatted.trim(),
            };
          })
          .filter(n => {
            const rawStart = n.effective_start ? new Date(n.effective_start).getTime() : 0;
            const rawEnd = n.effective_end ? new Date(n.effective_end).getTime() : Infinity;
            // 'PERM' and other non-date end values parse to NaN.
            // Treat NaN start as currently-effective and NaN end as
            // never-expiring so legitimately active NOTAMs aren't
            // filtered out.
            const start = Number.isFinite(rawStart) ? rawStart : 0;
            const end = Number.isFinite(rawEnd) ? rawEnd : Infinity;
            return start <= now + 24 * 3600 * 1000 && end >= now;
          })
          .slice(0, 30);

        results[icao] = { count: items.length, notams: items };
      } catch (err: any) {
        results[icao] = { error: err.message };
      }
    }));

    return {
      source: 'FAA NMS API (NOTAM Management Service) — official',
      airports,
      results,
    };
  },
};

// Tools that don't touch per-aircraft data — skip the access re-check to
// avoid pointless DB round-trips.
const GLOBAL_TOOLS = new Set([
  'web_search',
  'get_weather_briefing',
  'get_aviation_hazards',
  'get_notams',
  'get_system_settings',
  // propose_onboarding_setup creates a NEW aircraft — the tail lives
  // inside the action payload, not as a top-level arg, so the standard
  // resolveAircraftFromTail path can't apply. Pre-fix, every onboarding
  // attempt died with "Aircraft tail number is required" before reaching
  // the handler. Coverage gap: the proposedActions unit tests bypass
  // executeTool entirely.
  'propose_onboarding_setup',
  // switch_active_aircraft resolves the tail INSIDE its handler so it
  // can return a structured error to Howard if the pilot doesn't have
  // access. If the dispatcher pre-resolved it we'd surface a generic
  // "tail not found" instead of "you don't have access to that one".
  'switch_active_aircraft',
]);

/** Upper bound on the JSON size of a single tool result sent back to
 * Claude. Aircraft with hundreds of logs, squawks, or ADs can otherwise
 * blow the context window and run up per-request cost. ~40 KB is
 * comfortably larger than any normal reply but still leaves room for
 * the rest of the conversation. */
const MAX_TOOL_RESULT_CHARS = 40000;

/** If a tool result serializes larger than MAX_TOOL_RESULT_CHARS, find
 * the largest array inside and halve it until we fit. Adds a
 * `_truncated` marker so Howard can tell the user to narrow the
 * filter instead of silently showing partial data. */
export function capResultSize(result: any, toolName?: string): any {
  if (!result || typeof result !== 'object') return result;
  let current: any = result;
  let serialized = JSON.stringify(current);
  const originalSize = serialized.length;
  // Bounded loop in case a result has many same-size arrays that each
  // need trimming. 6 iterations is enough to shave an order of
  // magnitude off even a huge response.
  // Walk one level deep when no top-level array dominates. Some tools
  // (get_notams returns { results: { KDAL: { notams: [...] }, ... } })
  // have NO top-level arrays at all; pre-fix the loop bailed without
  // trimming anything and Claude got the full 50k+ char response. The
  // nested traversal finds the heaviest array at any depth up to 2.
  function findHeaviestArrayPath(obj: any, depth: number): { path: (string | number)[]; len: number } | null {
    if (!obj || typeof obj !== 'object' || depth > 2) return null;
    let best: { path: (string | number)[]; len: number } | null = null;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '_truncated') continue;
      if (Array.isArray(v)) {
        if (!best || v.length > best.len) best = { path: [k], len: v.length };
      } else if (v && typeof v === 'object') {
        const nested = findHeaviestArrayPath(v, depth + 1);
        if (nested && (!best || nested.len > best.len)) {
          best = { path: [k, ...nested.path], len: nested.len };
        }
      }
    }
    return best;
  }

  for (let i = 0; i < 6 && serialized.length > MAX_TOOL_RESULT_CHARS; i++) {
    const target = findHeaviestArrayPath(current, 0);
    if (!target || target.len <= 3) break;
    const keep = Math.max(3, Math.floor(target.len / 2));
    // Deep-clone the path so we don't mutate the caller's data.
    const next = JSON.parse(JSON.stringify(current));
    let cursor: any = next;
    for (let p = 0; p < target.path.length - 1; p++) cursor = cursor[target.path[p]];
    const leaf = target.path[target.path.length - 1] as string;
    cursor[leaf] = (cursor[leaf] as any[]).slice(0, keep);
    const prevTrunc = next._truncated || {};
    next._truncated = {
      ...prevTrunc,
      [target.path.join('.')]: { original_count: target.len, returned_count: keep },
      note: 'Result was too large for context — trimmed. Ask for a tighter filter (limit, date range, status) if you need more.',
    };
    current = next;
    serialized = JSON.stringify(current);
  }
  // Emit a breadcrumb only when trimming actually fired, so the signal
  // in telemetry reflects real truncation events.
  if (current !== result) {
    logEvent('howard_tool_truncated', {
      tool: toolName || 'unknown',
      original_size: originalSize,
      trimmed_size: serialized.length,
    });
  }
  return current;
}

async function makeProposal(
  sb: SupabaseClient,
  ctx: ToolContext,
  actionType: ActionType,
  payload: any,
): Promise<any> {
  const proposal = await proposeAction(sb, {
    threadId: ctx.threadId,
    userId: ctx.userId,
    aircraftId: ctx.aircraftId,
    aircraftTail: ctx.aircraftTail,
    actionType,
    payload,
  });
  return {
    proposed_action_id: proposal.id,
    summary: proposal.summary,
    requires_confirmation: true,
    note: 'I\'ve prepared this action. The user needs to tap Confirm on the card to apply it.',
  };
}

// Sentinel used by the per-tool-call timeout race below; thrown on
// expiry so executeTool can distinguish a hung handler from a normal
// handler error and tell Howard to retry / move on.
const TOOL_TIMEOUT_SENTINEL = '__howard_tool_timeout__';

function withToolTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TOOL_TIMEOUT_SENTINEL)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function executeTool(
  name: string,
  params: any,
  ctx: ToolContext,
  supabaseAdmin: SupabaseClient,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });

  let result: any;
  try {
    if (GLOBAL_TOOLS.has(name)) {
      result = await withToolTimeout(handler(params, supabaseAdmin, '', ctx), HOWARD_TOOL_TIMEOUT_MS);
    } else {
      // Aircraft-scoped tool: resolve `tail` to an aircraft_id the user
      // can read, then run the handler with that. The tail-resolver
      // shares the per-tool budget so a stuck Supabase lookup can't
      // bypass the timeout.
      const resolved = await withToolTimeout(
        resolveAircraftFromTail(supabaseAdmin, ctx.userId, params?.tail),
        HOWARD_TOOL_TIMEOUT_MS,
      );
      if (!resolved.ok) return JSON.stringify({ error: resolved.error });

      const enrichedCtx: ToolContext = {
        ...ctx,
        aircraftId: resolved.aircraftId,
        aircraftTail: resolved.tail,
      };
      result = await withToolTimeout(
        handler(params, supabaseAdmin, resolved.aircraftId, enrichedCtx),
        HOWARD_TOOL_TIMEOUT_MS,
      );
    }
  } catch (e: any) {
    if (e?.message === TOOL_TIMEOUT_SENTINEL) {
      logEvent('howard_tool_timeout', { tool: name, timeout_ms: HOWARD_TOOL_TIMEOUT_MS });
      return JSON.stringify({
        error: `Tool '${name}' timed out after ${Math.round(HOWARD_TOOL_TIMEOUT_MS / 1000)}s. Try a narrower query or move on without this data.`,
      });
    }
    // A handler that throws (vs. returning { error }) is unexpected — the
    // pattern is to catch DB errors and return them as a string. Log with
    // the tool name so this shows up in monitoring instead of crashing
    // the whole stream as a generic 500.
    logEvent('howard_tool_threw', { tool: name, message: e?.message ?? String(e) });
    return JSON.stringify({ error: 'Tool failed unexpectedly. Try again or rephrase the request.' });
  }

  // Tool returned a normal value but signaled an error via `{ error }`.
  // Emit a breadcrumb so DB outages aren't masked as "empty result" in
  // Howard's reply — the tool name is what makes the alert actionable.
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    logEvent('howard_tool_error_returned', {
      tool: name,
      message: typeof result.error === 'string' ? result.error : 'unknown',
    });
  }

  return JSON.stringify(capResultSize(result, name));
}
