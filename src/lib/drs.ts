// =============================================================
// FAA DRS (Dynamic Regulatory System) AD sync
// =============================================================
// Pulls Airworthiness Directives relevant to an aircraft's
// make/model/engine/prop from the FAA's public AD database and
// upserts them into aft_airworthiness_directives with source='drs_sync'.
//
// Runs nightly via /api/cron/ads-sync (Vercel cron).
// Also callable ad-hoc from the AD UI "Refresh" button.
//
// IMPORTANT — The FAA publishes AD data through multiple channels:
//   - drs.faa.gov (search UI, no stable JSON API)
//   - rgl.faa.gov (older, browseable)
//   - https://www.faa.gov/regulations_policies/airworthiness_directives/
//     (CSV/XML bulk exports)
//
// This module uses the FAA bulk-data JSON endpoint as the default
// source. If the FAA changes that endpoint, update DRS_BULK_URL
// and parseAdFeed accordingly. The rest of the pipeline (matching,
// upsert, change detection) is source-agnostic.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

/**
 * Public FAA AD feed. Returns JSON of all active ADs with structured
 * applicability fields we can match on. If this URL 404s or changes
 * shape, update here — the downstream pipeline stays the same.
 *
 * Note: the live DRS search at drs.faa.gov does NOT expose a stable
 * JSON API. Teams typically use either:
 *   1. This bulk feed (recommended for daily sync)
 *   2. The per-record XML export
 *
 * Set the FAA_DRS_FEED_URL env var to override at runtime.
 */
const DRS_BULK_URL =
  process.env.FAA_DRS_FEED_URL ||
  'https://drs.faa.gov/api/public/search/ads';

interface RawAd {
  ad_number: string;
  subject: string;
  applicability?: string;
  effective_date?: string;
  amendment?: string;
  source_url?: string;
  is_superseded?: boolean;
  superseded_by?: string;
  compliance_type?: 'one_time' | 'recurring';
  recurring_interval_hours?: number;
  recurring_interval_months?: number;
  make?: string;
  model?: string;
  engine?: string;
  prop?: string;
}

/** Aircraft identifiers used to match ADs. */
interface AircraftMatchInfo {
  id: string;
  make?: string | null;
  model?: string | null;
  aircraft_type?: string | null;
  engine_type?: string | null;
}

/**
 * Parse the raw DRS feed response into our RawAd shape.
 * Defensive against schema drift — missing fields become undefined.
 */
function parseAdFeed(raw: any): RawAd[] {
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : (raw.results ?? raw.data ?? []);
  if (!Array.isArray(rows)) return [];

  return rows.map((r: any) => ({
    ad_number: String(r.ad_number ?? r.number ?? r.docket ?? '').trim(),
    subject: String(r.subject ?? r.title ?? '').trim(),
    applicability: r.applicability ?? r.applies_to ?? null,
    effective_date: r.effective_date ?? r.effective ?? null,
    amendment: r.amendment ?? r.amendment_number ?? null,
    source_url: r.pdf_url ?? r.source_url ?? r.url ?? null,
    is_superseded: !!(r.is_superseded ?? r.superseded),
    superseded_by: r.superseded_by ?? null,
    compliance_type: (r.recurring ? 'recurring' : 'one_time') as 'one_time' | 'recurring',
    recurring_interval_hours: r.recurring_interval_hours ?? null,
    recurring_interval_months: r.recurring_interval_months ?? null,
    make: r.make ?? null,
    model: r.model ?? null,
    engine: r.engine ?? null,
    prop: r.prop ?? null,
  })).filter(a => a.ad_number && a.subject);
}

/** Best-effort case-insensitive substring match. */
function applies(raw: RawAd, ac: AircraftMatchInfo): boolean {
  const hay = [
    raw.applicability,
    raw.make,
    raw.model,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return false;

  const needles = [ac.make, ac.model, ac.aircraft_type, ac.engine_type]
    .filter((v): v is string => !!v)
    .map(v => v.toLowerCase());

  return needles.some(n => hay.includes(n));
}

function hashRaw(raw: RawAd): string {
  return createHash('sha1')
    .update(JSON.stringify({
      s: raw.subject,
      e: raw.effective_date,
      a: raw.amendment,
      sup: raw.is_superseded,
      supby: raw.superseded_by,
      u: raw.source_url,
    }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Fetch the DRS feed and match against a single aircraft. Upserts new
 * rows and updates existing ones whose hash changed. Returns counters.
 */
export async function syncAdsForAircraft(
  sb: SupabaseClient,
  aircraft: AircraftMatchInfo,
): Promise<{ inserted: number; updated: number; skipped: number; error?: string }> {
  let rawFeed: any;
  try {
    const res = await fetch(DRS_BULK_URL, {
      headers: { Accept: 'application/json' },
      // Vercel functions have a 10s default; most feeds respond inside that.
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { inserted: 0, updated: 0, skipped: 0, error: `DRS feed HTTP ${res.status}` };
    }
    rawFeed = await res.json();
  } catch (err: any) {
    return { inserted: 0, updated: 0, skipped: 0, error: `DRS fetch failed: ${err.message}` };
  }

  const rawAds = parseAdFeed(rawFeed);
  const applicable = rawAds.filter(r => applies(r, aircraft));

  // Pull current AD rows for this aircraft so we can detect changes.
  const { data: existing } = await sb
    .from('aft_airworthiness_directives')
    .select('id, ad_number, sync_hash, source')
    .eq('aircraft_id', aircraft.id)
    .is('deleted_at', null);

  const existingByNumber = new Map<string, { id: string; sync_hash: string | null; source: string }>();
  for (const e of existing || []) {
    existingByNumber.set(e.ad_number, e);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const raw of applicable) {
    const hash = hashRaw(raw);
    const current = existingByNumber.get(raw.ad_number);

    if (!current) {
      // New AD
      const { error } = await sb.from('aft_airworthiness_directives').insert({
        aircraft_id: aircraft.id,
        ad_number: raw.ad_number,
        subject: raw.subject,
        amendment: raw.amendment,
        applicability: raw.applicability,
        source_url: raw.source_url,
        source: 'drs_sync',
        effective_date: raw.effective_date,
        is_superseded: !!raw.is_superseded,
        superseded_by: raw.superseded_by,
        compliance_type: raw.compliance_type || 'one_time',
        recurring_interval_hours: raw.recurring_interval_hours,
        recurring_interval_months: raw.recurring_interval_months,
        synced_at: now,
        sync_hash: hash,
      });
      if (!error) inserted += 1;
      else skipped += 1;
    } else if (current.sync_hash !== hash) {
      // Existing DRS row changed upstream — refresh fields we own from DRS.
      // Never overwrite compliance bookkeeping (last_complied_*, next_due_*).
      if (current.source === 'drs_sync') {
        const { error } = await sb
          .from('aft_airworthiness_directives')
          .update({
            subject: raw.subject,
            amendment: raw.amendment,
            applicability: raw.applicability,
            source_url: raw.source_url,
            effective_date: raw.effective_date,
            is_superseded: !!raw.is_superseded,
            superseded_by: raw.superseded_by,
            synced_at: now,
            sync_hash: hash,
          })
          .eq('id', current.id);
        if (!error) updated += 1;
        else skipped += 1;
      } else {
        skipped += 1; // manual rows left alone
      }
    } else {
      skipped += 1;
    }
  }

  return { inserted, updated, skipped };
}
