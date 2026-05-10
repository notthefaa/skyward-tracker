import type { SupabaseClient } from '@supabase/supabase-js';
import { tavily } from '@tavily/core';
import OpenAI from 'openai';
import { computeAirworthinessStatus } from '@/lib/airworthiness';
import { syncAdsForAircraft } from '@/lib/drs';
import { logEvent } from '@/lib/requestId';
import { isIsoDate, isIsoDateTime, parseFiniteNumber } from '@/lib/validation';
import { getOilConsumptionStatus, hoursSinceLastOilAdd } from '@/lib/oilConsumption';
import { NETWORK_TIMEOUT_MS, HOWARD_TOOL_TIMEOUT_MS } from '@/lib/constants';
import { todayInZone } from '@/lib/pilotTime';
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
  const { data: aircraft } = await sb
    .from('aft_aircraft')
    .select('id, tail_number')
    .eq('tail_number', normalized)
    .is('deleted_at', null)
    .maybeSingle();
  // Same error message for "doesn't exist" and "exists but not yours"
  // — leaking the distinction lets one user enumerate which tails
  // belong to other users' fleets.
  if (!aircraft) {
    return { ok: false, error: `No aircraft ${normalized} in the user's fleet.` };
  }
  const allowed = await verifyAccess(sb, userId, aircraft.id);
  if (!allowed) {
    return { ok: false, error: `No aircraft ${normalized} in the user's fleet.` };
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
    let query = sb.from('aft_maintenance_items')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true })
      .limit(limit);
    if (params.tracking_type) query = query.eq('tracking_type', params.tracking_type);
    if (params.required_only) query = query.eq('is_required', true);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, items: data };
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
    return { count: (data || []).length, squawks: data };
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
    return { count: (data || []).length, notes: data };
  },

  get_reservations: async (params, sb, aircraftId) => {
    let query = sb.from('aft_reservations')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('start_time', { ascending: true });
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
      const embResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: params.query,
      });
      const queryEmbedding = embResponse.data[0].embedding;

      const { data: chunks, error } = await sb.rpc('match_document_chunks', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_aircraft_id: aircraftId,
        match_count: 5,
        match_threshold: 0.3,
      });

      if (error) return { error: error.message };
      if (!chunks || chunks.length === 0) return { message: 'No relevant document sections found. The aircraft may not have any documents uploaded yet.' };

      // Enrich with document metadata
      const docIds = Array.from(new Set(chunks.map((c: any) => c.document_id)));
      const { data: docs } = await sb.from('aft_documents')
        .select('id, filename, doc_type, file_url')
        .in('id', docIds);
      const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

      return {
        results: chunks.map((c: any) => ({
          document: docMap.get(c.document_id)?.filename || 'Unknown',
          doc_type: docMap.get(c.document_id)?.doc_type || 'Unknown',
          file_url: docMap.get(c.document_id)?.file_url || null,
          page_number: c.page_number || null,
          chunk_index: c.chunk_index,
          content: c.content,
          relevance: (c.similarity * 100).toFixed(0) + '%',
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
    return makeProposal(sb, ctx, 'note', { content: params.content.trim() });
  },

  propose_equipment_entry: async (params, sb, _aircraftId, ctx) => {
    if (!params.name || !params.category) {
      return { error: 'name and category are required.' };
    }
    if (typeof params.category !== 'string' || !EQUIPMENT_CATEGORIES.has(params.category)) {
      return { error: `category must be one of: ${Array.from(EQUIPMENT_CATEGORIES).join(', ')}.` };
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

  propose_onboarding_setup: async (params, sb, _aircraftId, ctx) => {
    const profile = params?.profile;
    const aircraft = params?.aircraft;
    if (!profile?.full_name || !profile?.initials) {
      return { error: 'profile.full_name and profile.initials are required.' };
    }
    if (!aircraft?.tail_number || !aircraft?.engine_type) {
      return { error: 'aircraft.tail_number and aircraft.engine_type are required.' };
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
        engine_type: aircraft.engine_type === 'Turbine' ? 'Turbine' : 'Piston',
        is_ifr_equipped: !!aircraft.is_ifr_equipped,
        home_airport: aircraft.home_airport ? String(aircraft.home_airport).toUpperCase().trim() : undefined,
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

    const clientId = process.env.FAA_NOTAM_CLIENT_ID;
    const clientSecret = process.env.FAA_NOTAM_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return {
        error: 'FAA NOTAM API credentials not configured on the server. NOTAMs cannot be pulled — tell the user to have the admin set FAA_NOTAM_CLIENT_ID and FAA_NOTAM_CLIENT_SECRET (from api.faa.gov) in the environment.',
      };
    }

    const airports = params.airports.map(normalizeIcao).filter(Boolean);
    const now = Date.now();
    const results: Record<string, any> = {};

    await Promise.all(airports.map(async (icao: string) => {
      try {
        const url = `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${encodeURIComponent(icao)}&pageSize=50&sortBy=effectiveStartDate&sortOrder=Desc`;
        const res = await fetch(url, {
          headers: {
            'client_id': clientId,
            'client_secret': clientSecret,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        });
        if (!res.ok) {
          results[icao] = { error: `FAA NOTAM API returned ${res.status}` };
          return;
        }
        let data: any;
        try {
          data = await res.json();
        } catch {
          logEvent('howard_notam_parse_failed', { icao, reason: 'json' });
          results[icao] = { error: 'FAA NOTAM API returned a non-JSON response.' };
          return;
        }

        // The FAA NOTAM API nests payload at data.items[].properties.coreNOTAMData.notam.
        // We've seen undocumented shape changes before — if the expected
        // path is missing, emit a telemetry breadcrumb so we can diagnose
        // rather than silently returning an empty list.
        if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
          logEvent('howard_notam_parse_failed', {
            icao,
            reason: 'shape',
            top_keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 10).join(',') : 'none',
          });
          results[icao] = { error: 'FAA NOTAM API response was not in the expected shape.' };
          return;
        }
        const rawItems: any[] = data.items;

        // Flatten and keep only currently-effective or imminent NOTAMs
        // (effectiveStart <= now+24h AND effectiveEnd >= now OR null).
        const items = rawItems
          .map(item => {
            const core = item?.properties?.coreNOTAMData?.notam ?? {};
            const translation = Array.isArray(item?.properties?.coreNOTAMData?.notamTranslation)
              ? item.properties.coreNOTAMData.notamTranslation
              : [];
            const formatted = translation.find((t: any) => t?.type === 'LOCAL_FORMAT')?.formattedText
              || translation[0]?.formattedText
              || core.text
              || '';
            return {
              number: typeof core.number === 'string' ? core.number : null,
              type: typeof core.type === 'string' ? core.type : null,
              classification: typeof core.classification === 'string' ? core.classification : null,
              issued: typeof core.issued === 'string' ? core.issued : null,
              effective_start: typeof core.effectiveStart === 'string' ? core.effectiveStart : null,
              effective_end: typeof core.effectiveEnd === 'string' ? core.effectiveEnd : null,
              icao: typeof core.icaoLocation === 'string' ? core.icaoLocation : null,
              text: typeof formatted === 'string' ? formatted.trim() : '',
            };
          })
          .filter(n => {
            const start = n.effective_start ? new Date(n.effective_start).getTime() : 0;
            const end = n.effective_end ? new Date(n.effective_end).getTime() : Infinity;
            return Number.isFinite(start) && start <= now + 24 * 3600 * 1000 && end >= now;
          })
          .slice(0, 30);

        results[icao] = { count: items.length, notams: items };
      } catch (err: any) {
        results[icao] = { error: err.message };
      }
    }));

    return {
      source: 'FAA NOTAM API (external-api.faa.gov/notamapi/v1) — official',
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
  for (let i = 0; i < 6 && serialized.length > MAX_TOOL_RESULT_CHARS; i++) {
    let largestKey: string | null = null;
    let largestLen = 0;
    for (const [k, v] of Object.entries(current)) {
      if (Array.isArray(v) && v.length > largestLen) {
        largestKey = k;
        largestLen = v.length;
      }
    }
    if (!largestKey || largestLen <= 3) break;
    const keep = Math.max(3, Math.floor(largestLen / 2));
    const prevTrunc = current._truncated || {};
    current = {
      ...current,
      [largestKey]: (current[largestKey] as any[]).slice(0, keep),
      _truncated: {
        ...prevTrunc,
        [largestKey]: { original_count: largestLen, returned_count: keep },
        note: 'Result was too large for context — trimmed. Ask for a tighter filter (limit, date range, status) if you need more.',
      },
    };
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
