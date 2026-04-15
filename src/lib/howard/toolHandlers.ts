import type { SupabaseClient } from '@supabase/supabase-js';
import { tavily } from '@tavily/core';
import OpenAI from 'openai';
import { computeAirworthinessStatus } from '@/lib/airworthiness';
import { syncAdsForAircraft } from '@/lib/drs';
import { proposeAction, type ActionType } from './proposedActions';

export interface ToolContext {
  userId: string;
  threadId: string;
  aircraftId: string;
  aircraftTail: string;
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

/**
 * Per-tool-call aircraft access verification. Belt-and-suspenders against
 * prompt-injection — the request-level check already ran, but we want the
 * window between that check and each tool call to be narrow.
 */
async function verifyAccess(sb: SupabaseClient, userId: string, aircraftId: string): Promise<boolean> {
  // Global admins bypass
  const { data: role } = await sb
    .from('aft_user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();
  if (role?.role === 'admin') return true;

  const { data: access } = await sb
    .from('aft_user_aircraft_access')
    .select('aircraft_role')
    .eq('user_id', userId)
    .eq('aircraft_id', aircraftId)
    .maybeSingle();
  return !!access;
}

const handlers: Record<string, ToolHandler> = {
  get_flight_logs: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    let query = sb.from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.date_from) query = query.gte('created_at', params.date_from);
    if (params.date_to) query = query.lte('created_at', params.date_to);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, logs: data };
  },

  get_maintenance_items: async (params, sb, aircraftId) => {
    let query = sb.from('aft_maintenance_items')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true });
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

    const { data: ev } = await sb
      .from('aft_maintenance_events')
      .select('id, aircraft_id, deleted_at')
      .eq('id', params.event_id)
      .maybeSingle();
    if (!ev || ev.aircraft_id !== aircraftId || ev.deleted_at) {
      return { error: 'Event not found for this aircraft.' };
    }

    const { data, error } = await sb.from('aft_event_line_items')
      .select('*')
      .eq('event_id', params.event_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) return { error: error.message };
    return { count: (data || []).length, line_items: data };
  },

  get_squawks: async (params, sb, aircraftId) => {
    let query = sb.from('aft_squawks')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
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
      result.oil_logs = data;
      result.oil_count = (data || []).length;
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
        .select('id, filename, doc_type')
        .in('id', docIds);
      const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

      return {
        results: chunks.map((c: any) => ({
          document: docMap.get(c.document_id)?.filename || 'Unknown',
          doc_type: docMap.get(c.document_id)?.doc_type || 'Unknown',
          chunk_index: c.chunk_index,
          content: c.content,
          relevance: (c.similarity * 100).toFixed(0) + '%',
        })),
      };
    } catch (err: any) {
      return { error: `Document search failed: ${err.message}` };
    }
  },

  web_search: async (params) => {
    if (!params.query || typeof params.query !== 'string') return { error: 'Search query is required.' };
    try {
      const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
      const response = await client.search(params.query, {
        maxResults: 5,
        searchDepth: 'basic',
        includeAnswer: true,
      });
      return {
        answer: response.answer || null,
        results: (response.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content?.slice(0, 500),
        })),
      };
    } catch (err: any) {
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
      const [metarRes, tafRes] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=2`),
        fetch(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`),
      ]);
      const metars = metarRes.ok ? await metarRes.json() : [];
      const tafs = tafRes.ok ? await tafRes.json() : [];
      return {
        source: 'aviationweather.gov (NOAA AWC)',
        metars: Array.isArray(metars) ? metars : [],
        tafs: Array.isArray(tafs) ? tafs : [],
        airports_queried: normalized,
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
      .select('total_engine_time')
      .eq('id', aircraftId)
      .maybeSingle();
    const et = (ac as any)?.total_engine_time || 0;
    const today = new Date(new Date().setHours(0, 0, 0, 0));

    const annotated = (ads || []).map((a: any) => {
      const timeOverdue = a.next_due_time != null && et >= a.next_due_time;
      const dateOverdue = a.next_due_date != null &&
        new Date(a.next_due_date + 'T00:00:00') < today;
      const overdue = timeOverdue || dateOverdue;
      const daysOut = a.next_due_date
        ? Math.ceil((new Date(a.next_due_date + 'T00:00:00').getTime() - today.getTime()) / 86400000)
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
    let query = sb.from('aft_aircraft_equipment')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('category', { ascending: true });
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

    if (!acRes.data) return { error: 'Aircraft not found.' };

    const verdict = computeAirworthinessStatus({
      aircraft: acRes.data as any,
      equipment: (eqRes.data || []) as any,
      mxItems: mxRes.data || [],
      squawks: (sqRes.data || []) as any,
      ads: (adRes.data || []) as any,
    });
    return verdict;
  },

  // ─── Write tools (propose-confirm) ─────────────────────────

  propose_reservation: async (params, sb, _aircraftId, ctx) => {
    if (!params.start_time || !params.end_time || !params.pilot_initials) {
      return { error: 'start_time, end_time, and pilot_initials are required.' };
    }
    return makeProposal(sb, ctx, 'reservation', params);
  },

  propose_mx_schedule: async (params, sb, aircraftId, ctx) => {
    // Validate mx_item_ids / squawk_ids belong to this aircraft.
    if (Array.isArray(params.mx_item_ids) && params.mx_item_ids.length > 0) {
      const { data } = await sb.from('aft_maintenance_items')
        .select('id, aircraft_id')
        .in('id', params.mx_item_ids);
      const bad = (data || []).find((r: any) => r.aircraft_id !== aircraftId);
      if (bad || (data || []).length !== params.mx_item_ids.length) {
        return { error: 'One or more MX items do not belong to this aircraft.' };
      }
    }
    if (Array.isArray(params.squawk_ids) && params.squawk_ids.length > 0) {
      const { data } = await sb.from('aft_squawks')
        .select('id, aircraft_id')
        .in('id', params.squawk_ids);
      const bad = (data || []).find((r: any) => r.aircraft_id !== aircraftId);
      if (bad || (data || []).length !== params.squawk_ids.length) {
        return { error: 'One or more squawks do not belong to this aircraft.' };
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
    return makeProposal(sb, ctx, 'equipment', params);
  },

  get_aviation_hazards: async (params) => {
    if (!params.airports || !Array.isArray(params.airports) || params.airports.length === 0) {
      return { error: 'At least one airport ICAO code is required.' };
    }
    const normalized = params.airports.map(normalizeIcao);
    const ids = normalized.join(',');
    try {
      const [pirepRes, sigmetRes] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/pirep?id=${ids}&format=json&age=2`),
        fetch(`https://aviationweather.gov/api/data/airsigmet?format=json`),
      ]);
      const pireps = pirepRes.ok ? await pirepRes.json() : [];
      const sigmets = sigmetRes.ok ? await sigmetRes.json() : [];
      return {
        source: 'aviationweather.gov (NOAA AWC)',
        pireps: Array.isArray(pireps) ? pireps.slice(0, 20) : [],
        sigmets_airmets: Array.isArray(sigmets) ? sigmets.slice(0, 15) : [],
        airports_queried: normalized,
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
        const url = `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${icao}&pageSize=50&sortBy=effectiveStartDate&sortOrder=Desc`;
        const res = await fetch(url, {
          headers: {
            'client_id': clientId,
            'client_secret': clientSecret,
            'Accept': 'application/json',
          },
        });
        if (!res.ok) {
          results[icao] = { error: `FAA NOTAM API returned ${res.status}` };
          return;
        }
        const data = await res.json();
        const rawItems: any[] = Array.isArray(data?.items) ? data.items : [];

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
              number: core.number,
              type: core.type,
              classification: core.classification,
              issued: core.issued,
              effective_start: core.effectiveStart,
              effective_end: core.effectiveEnd,
              icao: core.icaoLocation,
              text: typeof formatted === 'string' ? formatted.trim() : '',
            };
          })
          .filter(n => {
            const start = n.effective_start ? new Date(n.effective_start).getTime() : 0;
            const end = n.effective_end ? new Date(n.effective_end).getTime() : Infinity;
            return start <= now + 24 * 3600 * 1000 && end >= now;
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

export async function executeTool(
  name: string,
  params: any,
  ctx: ToolContext,
  supabaseAdmin: SupabaseClient,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });

  if (!GLOBAL_TOOLS.has(name)) {
    const allowed = await verifyAccess(supabaseAdmin, ctx.userId, ctx.aircraftId);
    if (!allowed) {
      return JSON.stringify({ error: 'Access denied to this aircraft.' });
    }
  }

  const result = await handler(params, supabaseAdmin, ctx.aircraftId, ctx);
  return JSON.stringify(result);
}
