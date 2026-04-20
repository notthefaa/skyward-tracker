// =============================================================
// FAA AD sync (via Federal Register API)
// =============================================================
// Pulls Airworthiness Directives relevant to an aircraft's
// make/model/engine from the Federal Register public API and
// upserts them into aft_airworthiness_directives with
// source='drs_sync'.
//
// Why Federal Register, not drs.faa.gov:
//   drs.faa.gov/api/public/search/ads 403s all unauthenticated
//   requests — it powers the DRS search UI, not a public API.
//   The Federal Register (federalregister.gov/api/v1) publishes
//   every FAA "Rule" document as structured JSON, including all
//   ADs, with stable IDs, PDF links, abstracts, and effective
//   dates. No auth required.
//
// Runs nightly via /api/cron/ads-sync (Vercel cron). Also
// callable ad-hoc from the AD UI "Sync from DRS" button and
// from Howard's sync_ads_from_drs tool.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const FR_API_URL =
  process.env.FAA_DRS_FEED_URL ||
  'https://www.federalregister.gov/api/v1/documents.json';

/** How many years of history to pull. ADs older than this are unlikely to
 *  match a modern GA aircraft that wasn't already caught in prior syncs. */
const HISTORY_YEARS = 5;

interface RawAd {
  ad_number: string;
  subject: string;
  applicability?: string;
  effective_date?: string;
  amendment?: string;
  source_url?: string;
  compliance_type?: 'one_time' | 'recurring';
}

interface AircraftMatchInfo {
  id: string;
  make?: string | null;
  model?: string | null;
  aircraft_type?: string | null;
  engine_type?: string | null;
}

interface FrDoc {
  title: string;
  abstract: string | null;
  document_number: string;
  publication_date: string;
  effective_on: string | null;
  pdf_url: string | null;
  html_url: string | null;
  excerpts: string | null;
}

/** Strip HTML tags so regex patterns apply to plain text. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** Pull the real AD number (YYYY-WW-NN) out of the excerpts blob.
 *  FR titles never contain it, but the excerpt always has
 *  "new airworthiness directive: 2024-17-09 <Manufacturer>:". */
function extractAdNumber(excerpts: string | null): string | null {
  if (!excerpts) return null;
  const plain = stripHtml(excerpts);
  const m = plain.match(
    /new\s+airworthiness\s+directive[^A-Za-z0-9]{0,100}(\d{4}-\d{2}-\d{2})/i,
  );
  return m ? m[1] : null;
}

/** Best-effort amendment extraction. "Amendment 39-22834". */
function extractAmendment(excerpts: string | null): string | null {
  if (!excerpts) return null;
  const m = stripHtml(excerpts).match(/Amendment\s+(39-\d+)/i);
  return m ? m[1] : null;
}

/** Return substring variants of a model string so we match both
 *  "PA-28-181" (full) and "PA-28" (series) / "172N" (full) and "172"
 *  (digit base). Variants under 3 chars are dropped — they'd flood
 *  the hay with false positives (e.g. plain "22" in any part number). */
function modelVariants(model: string): string[] {
  const m = model.toLowerCase().trim();
  const out = new Set<string>();
  if (m.length >= 3) out.add(m);
  const noTrailingLetters = m.replace(/[a-z]+$/i, '').trim();
  if (noTrailingLetters && noTrailingLetters !== m && noTrailingLetters.length >= 3) out.add(noTrailingLetters);
  const noTrailingSegment = m.replace(/[\s-]+\d+[a-z]?$/i, '').trim();
  if (noTrailingSegment && noTrailingSegment !== m && noTrailingSegment.length >= 3) out.add(noTrailingSegment);
  return Array.from(out);
}

/** Case-insensitive substring match against the FR title + abstract.
 *
 *  Requires a make match (ADs are type-certificate-specific and the
 *  TC holder is always named in the rule), then sharpens with model
 *  where possible. Separate engine path for engine-family ADs that
 *  don't name the airframe manufacturer.
 *
 *  Does NOT match on aircraft_type / generic words like "Airplane"
 *  or "Taildragger" — those appear in almost every AD abstract and
 *  generate runaway false positives. */
function applies(raw: RawAd, ac: AircraftMatchInfo): boolean {
  const hay = [raw.subject, raw.applicability].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return false;

  const make = ac.make?.toLowerCase().trim();
  const model = ac.model?.toLowerCase().trim();
  const engine = ac.engine_type?.toLowerCase().trim();

  // Airframe path: make must appear. If a model is recorded, at least
  // one model variant must also appear; otherwise the make alone suffices.
  if (make && make.length >= 3 && hay.includes(make)) {
    if (!model) return true;
    const variants = modelVariants(model);
    if (variants.length === 0) return true;
    if (variants.some(v => hay.includes(v))) return true;
  }

  // Engine path: engine string must be specific enough (contains a
  // digit, ≥5 chars) and appear verbatim. Covers cases where the
  // airframe maker isn't named (engine-only ADs).
  if (engine && engine.length >= 5 && /\d/.test(engine) && hay.includes(engine)) return true;

  return false;
}

function hashRaw(raw: RawAd): string {
  return createHash('sha1')
    .update(JSON.stringify({
      s: raw.subject,
      e: raw.effective_date,
      a: raw.amendment,
      u: raw.source_url,
    }))
    .digest('hex')
    .slice(0, 16);
}

/** Fetch recent FAA AD rules from the Federal Register API. Pages
 *  through results; FR caps per_page at 1000 and a 5-year window
 *  typically yields under 1000 FAA AD rules (700 for 2024+). */
async function fetchFederalRegisterAds(): Promise<RawAd[]> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - HISTORY_YEARS);
  const sinceStr = since.toISOString().slice(0, 10);

  const params = new URLSearchParams();
  params.append('conditions[agencies][]', 'federal-aviation-administration');
  params.append('conditions[type][]', 'RULE');
  params.append('conditions[term]', 'airworthiness directive');
  params.append('conditions[publication_date][gte]', sinceStr);
  params.append('per_page', '1000');
  for (const f of ['title', 'abstract', 'document_number', 'publication_date', 'effective_on', 'pdf_url', 'html_url', 'excerpts']) {
    params.append('fields[]', f);
  }

  const out: RawAd[] = [];
  let page = 1;
  // Hard cap at 20 pages (20k docs) as a safety valve; real-world
  // result count is ~700–1500.
  while (page <= 20) {
    params.set('page', String(page));
    const url = `${FR_API_URL}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Federal Register HTTP ${res.status}`);
    const body = await res.json();
    const docs: FrDoc[] = body.results || [];
    for (const d of docs) {
      const adNumber = extractAdNumber(d.excerpts);
      if (!adNumber) continue; // no parseable AD number — skip
      out.push({
        ad_number: adNumber,
        subject: d.title.replace(/^Airworthiness Directives?;\s*/i, '').trim() || d.title,
        applicability: d.abstract || undefined,
        effective_date: d.effective_on || d.publication_date,
        amendment: extractAmendment(d.excerpts) || undefined,
        source_url: d.pdf_url || d.html_url || undefined,
        compliance_type: 'one_time', // FR doesn't expose recurrence directly
      });
    }
    const totalPages = body.total_pages || 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

/** Fetch recent ADs and upsert the ones that apply to this aircraft.
 *  Never overwrites compliance bookkeeping on existing rows. */
export async function syncAdsForAircraft(
  sb: SupabaseClient,
  aircraft: AircraftMatchInfo,
): Promise<{ inserted: number; updated: number; skipped: number; pruned: number; error?: string }> {
  let rawAds: RawAd[];
  try {
    rawAds = await fetchFederalRegisterAds();
  } catch (err: any) {
    return { inserted: 0, updated: 0, skipped: 0, pruned: 0, error: `Feed fetch failed: ${err.message}` };
  }

  // Sanity guard: if the feed came back empty or tiny, don't prune — we
  // might have just hit a bad FR API response.
  const feedHealthy = rawAds.length >= 50;

  const applicable = rawAds.filter(r => applies(r, aircraft));
  const applicableNumbers = new Set(applicable.map(a => a.ad_number));

  const { data: existing } = await sb
    .from('aft_airworthiness_directives')
    .select('id, ad_number, sync_hash, source, last_complied_date, last_complied_time, next_due_date, next_due_time')
    .eq('aircraft_id', aircraft.id)
    .is('deleted_at', null);

  type ExistingAd = {
    id: string;
    ad_number: string;
    sync_hash: string | null;
    source: string;
    last_complied_date: string | null;
    last_complied_time: number | null;
    next_due_date: string | null;
    next_due_time: number | null;
  };
  const existingRows = (existing || []) as ExistingAd[];
  const existingByNumber = new Map<string, ExistingAd>();
  for (const e of existingRows) existingByNumber.set(e.ad_number, e);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let pruned = 0;
  const now = new Date().toISOString();

  for (const raw of applicable) {
    const hash = hashRaw(raw);
    const current = existingByNumber.get(raw.ad_number);

    if (!current) {
      const { error } = await sb.from('aft_airworthiness_directives').insert({
        aircraft_id: aircraft.id,
        ad_number: raw.ad_number,
        subject: raw.subject,
        amendment: raw.amendment,
        applicability: raw.applicability,
        source_url: raw.source_url,
        source: 'drs_sync',
        effective_date: raw.effective_date,
        is_superseded: false,
        compliance_type: raw.compliance_type || 'one_time',
        synced_at: now,
        sync_hash: hash,
      });
      if (!error) inserted += 1;
      else skipped += 1;
    } else if (current.sync_hash !== hash) {
      if (current.source === 'drs_sync') {
        const { error } = await sb
          .from('aft_airworthiness_directives')
          .update({
            subject: raw.subject,
            amendment: raw.amendment,
            applicability: raw.applicability,
            source_url: raw.source_url,
            effective_date: raw.effective_date,
            synced_at: now,
            sync_hash: hash,
          })
          .eq('id', current.id);
        if (!error) updated += 1;
        else skipped += 1;
      } else {
        skipped += 1;
      }
    } else {
      skipped += 1;
    }
  }

  // Prune: DRS-synced rows that no longer match AND have no compliance
  // data logged. Safe because (a) compliance-logged rows are preserved,
  // (b) we skip pruning if the feed looks unhealthy.
  if (feedHealthy) {
    for (const row of existingRows) {
      if (row.source !== 'drs_sync') continue;
      if (applicableNumbers.has(row.ad_number)) continue;
      const hasCompliance =
        row.last_complied_date != null ||
        row.last_complied_time != null ||
        row.next_due_date != null ||
        row.next_due_time != null;
      if (hasCompliance) continue;
      const { error } = await sb
        .from('aft_airworthiness_directives')
        .update({ deleted_at: now })
        .eq('id', row.id);
      if (!error) pruned += 1;
    }
  }

  return { inserted, updated, skipped, pruned };
}
