import type { SupabaseClient } from '@supabase/supabase-js';
import { tavily } from '@tavily/core';

type ToolHandler = (params: any, sb: SupabaseClient, aircraftId: string) => Promise<any>;

function clampLimit(limit: any, defaultVal = 10, max = 50): number {
  const n = Number(limit) || defaultVal;
  return Math.min(Math.max(1, n), max);
}

const handlers: Record<string, ToolHandler> = {
  get_flight_logs: async (params, sb, aircraftId) => {
    const limit = clampLimit(params.limit);
    let query = sb.from('aft_flight_logs')
      .select('*')
      .eq('aircraft_id', aircraftId)
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
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.status) query = query.eq('status', params.status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { count: (data || []).length, events: data };
  },

  get_event_line_items: async (params, sb) => {
    if (!params.event_id) return { error: 'event_id is required' };
    const { data, error } = await sb.from('aft_event_line_items')
      .select('*')
      .eq('event_id', params.event_id)
      .order('created_at', { ascending: true });
    if (error) return { error: error.message };
    return { count: (data || []).length, line_items: data };
  },

  get_squawks: async (params, sb, aircraftId) => {
    let query = sb.from('aft_squawks')
      .select('*')
      .eq('aircraft_id', aircraftId)
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
    const ids = params.airports.map((a: string) => a.toUpperCase().trim()).join(',');
    try {
      const [metarRes, tafRes] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=2`),
        fetch(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`),
      ]);
      const metars = metarRes.ok ? await metarRes.json() : [];
      const tafs = tafRes.ok ? await tafRes.json() : [];
      return {
        metars: Array.isArray(metars) ? metars : [],
        tafs: Array.isArray(tafs) ? tafs : [],
        airports_queried: params.airports,
      };
    } catch (err: any) {
      return { error: `Weather fetch failed: ${err.message}` };
    }
  },

  get_aviation_hazards: async (params) => {
    if (!params.airports || !Array.isArray(params.airports) || params.airports.length === 0) {
      return { error: 'At least one airport ICAO code is required.' };
    }
    const ids = params.airports.map((a: string) => a.toUpperCase().trim()).join(',');
    try {
      const [pirepRes, sigmetRes] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/pirep?id=${ids}&format=json&age=2`),
        fetch(`https://aviationweather.gov/api/data/airsigmet?format=json`),
      ]);
      const pireps = pirepRes.ok ? await pirepRes.json() : [];
      const sigmets = sigmetRes.ok ? await sigmetRes.json() : [];
      return {
        pireps: Array.isArray(pireps) ? pireps.slice(0, 20) : [],
        sigmets_airmets: Array.isArray(sigmets) ? sigmets.slice(0, 15) : [],
        airports_queried: params.airports,
      };
    } catch (err: any) {
      return { error: `Hazard fetch failed: ${err.message}` };
    }
  },
};

export async function executeTool(
  name: string,
  params: any,
  supabaseAdmin: SupabaseClient,
  aircraftId: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const result = await handler(params, supabaseAdmin, aircraftId);
  return JSON.stringify(result);
}
