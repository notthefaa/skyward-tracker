// =============================================================
// FAA AD sync (via Federal Register API)
// =============================================================
// Pulls Airworthiness Directives relevant to an aircraft's
// make/model/type-certificate/engine/propeller from the Federal
// Register public API and upserts them into
// aft_airworthiness_directives with source='drs_sync'.
//
// Matching pipeline (all cheap, no LLM at sync time):
//   1. Title/abstract substring match on make, model variants,
//      type certificate, engine make/model, prop make/model.
//   2. Regex-based serial-range extraction on candidates. If the
//      aircraft serial lands in (or out of) the stated range, the
//      row gets applicability_status = 'applies' / 'does_not_apply'.
//      If ambiguous, 'review_required' — user can drill in and
//      trigger a Haiku parse via /api/ads/check-applicability.
//
// Why Federal Register, not drs.faa.gov: drs.faa.gov/api/public
// returns 403 for unauthenticated requests. Federal Register has
// every FAA RULE document (which is where ADs are codified) as
// stable, structured JSON with no auth.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const FR_API_URL =
  process.env.FAA_DRS_FEED_URL ||
  'https://www.federalregister.gov/api/v1/documents.json';

/** Valid sync windows surfaced to the UI. null = entire FR history
 *  (back to ~1994 for FAA rules). */
export type SyncYears = 5 | 10 | 20 | null;

interface RawAd {
  ad_number: string;
  subject: string;
  applicability?: string;
  excerpts?: string;
  effective_date?: string;
  amendment?: string;
  source_url?: string;
  compliance_type?: 'one_time' | 'recurring';
  source_hash: string;
}

interface AircraftMatchInfo {
  id: string;
  make?: string | null;
  model?: string | null;
  aircraft_type?: string | null;
  engine_type?: string | null;
  serial_number?: string | null;
  type_certificate?: string | null;
}

interface EquipmentItem {
  category: string;
  make?: string | null;
  model?: string | null;
  serial?: string | null;
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

type ApplicabilityStatus = 'applies' | 'does_not_apply' | 'review_required';
interface ApplicabilityVerdict {
  status: ApplicabilityStatus;
  reason: string;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function extractAdNumber(excerpts: string | null): string | null {
  if (!excerpts) return null;
  const m = stripHtml(excerpts).match(
    /new\s+airworthiness\s+directive[^A-Za-z0-9]{0,100}(\d{4}-\d{2}-\d{2})/i,
  );
  return m ? m[1] : null;
}

function extractAmendment(excerpts: string | null): string | null {
  if (!excerpts) return null;
  const m = stripHtml(excerpts).match(/Amendment\s+(39-\d+)/i);
  return m ? m[1] : null;
}

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

/** Returns true if make or type_certificate or engine/prop make+model all
 *  appear as plausible substrings in the AD hay. */
function applies(raw: RawAd, ac: AircraftMatchInfo, equipment: EquipmentItem[]): boolean {
  const hay = [raw.subject, raw.applicability].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return false;

  // Airframe path: make + (model OR model-base).
  const make = ac.make?.toLowerCase().trim();
  const model = (ac.model || ac.aircraft_type)?.toLowerCase().trim();
  if (make && make.length >= 3 && hay.includes(make)) {
    if (!model) return true;
    const variants = modelVariants(model);
    if (variants.length === 0) return true;
    if (variants.some(v => hay.includes(v))) return true;
  }

  // Type-certificate path: TC number is distinctive enough on its own.
  const tc = ac.type_certificate?.toLowerCase().trim();
  if (tc && tc.length >= 3 && hay.includes(tc)) return true;

  // Engine path: equipment rows for installed engines.
  const engines = equipment.filter(e => e.category === 'engine' && !!e.make);
  for (const eng of engines) {
    const engMake = eng.make!.toLowerCase().trim();
    const engModel = eng.model?.toLowerCase().trim();
    if (engMake.length >= 3 && hay.includes(engMake)) {
      if (!engModel) return true;
      const variants = modelVariants(engModel);
      if (variants.some(v => hay.includes(v))) return true;
    }
  }

  // Propeller path.
  const props = equipment.filter(e => e.category === 'propeller' && !!e.make);
  for (const p of props) {
    const pMake = p.make!.toLowerCase().trim();
    const pModel = p.model?.toLowerCase().trim();
    if (pMake.length >= 3 && hay.includes(pMake)) {
      if (!pModel) return true;
      const variants = modelVariants(pModel);
      if (variants.some(v => hay.includes(v))) return true;
    }
  }

  return false;
}

// =============================================================
// Serial-range extraction — regex-only, no LLM
// =============================================================
// Common phrasings we try to catch (matches vary wildly in the wild):
//   "serial numbers 17280001 through 17282725"
//   "S/N 1001 to 1500"
//   "serial numbers 1001, 1002, and 1003"
//   "prior to serial number 1500"
//   "with serial number 1234 and subsequent"
// If none of these match, return null and caller falls back to
// 'review_required'. We never claim 'does_not_apply' from a miss.

interface SerialRange {
  start?: number;
  end?: number;
  /** True if the range is inclusive of its boundaries (default true). */
  inclusive?: boolean;
  /** "Serial 1234 and subsequent" → open-ended up. */
  openEnd?: boolean;
  /** "Prior to serial 1234" → open-ended down. */
  openStart?: boolean;
  /** Specific serials, for "serials X, Y, Z" phrasings. */
  list?: number[];
}

/** Pull the first "numeric core" out of a serial string. Handles
 *  "17280123", "172-81023", "1159-2015", "ABC1234". Returns null
 *  if no digit run of ≥3 chars. */
function serialNumericCore(serial: string): number | null {
  const m = serial.match(/\d{3,}/);
  return m ? parseInt(m[0], 10) : null;
}

function extractSerialRanges(text: string): SerialRange[] {
  const ranges: SerialRange[] = [];
  const lower = text.toLowerCase();

  // "serial numbers X through Y" / "X to Y" / "X-Y"
  const throughRe = /serial\s+(?:no\.?|number|numbers)\s+(\d{3,})\s*(?:through|thru|to|[–-])\s*(\d{3,})/gi;
  let m: RegExpExecArray | null;
  while ((m = throughRe.exec(lower)) !== null) {
    ranges.push({ start: parseInt(m[1], 10), end: parseInt(m[2], 10), inclusive: true });
  }

  // "S/N X through Y"
  const snThroughRe = /s\/n\s+(\d{3,})\s*(?:through|thru|to|[–-])\s*(\d{3,})/gi;
  while ((m = snThroughRe.exec(lower)) !== null) {
    ranges.push({ start: parseInt(m[1], 10), end: parseInt(m[2], 10), inclusive: true });
  }

  // "prior to serial number X" / "before serial X"
  const priorRe = /(?:prior\s+to|before)\s+(?:s\/n|serial\s+(?:no\.?|number))\s+(\d{3,})/gi;
  while ((m = priorRe.exec(lower)) !== null) {
    ranges.push({ end: parseInt(m[1], 10) - 1, inclusive: true, openStart: true });
  }

  // "serial number X and subsequent" / "X and on"
  const subsequentRe = /(?:s\/n|serial\s+(?:no\.?|number))\s+(\d{3,})\s+and\s+(?:subsequent|on|later|after)/gi;
  while ((m = subsequentRe.exec(lower)) !== null) {
    ranges.push({ start: parseInt(m[1], 10), inclusive: true, openEnd: true });
  }

  return ranges;
}

function rangeIncludes(range: SerialRange, serial: number): boolean {
  if (range.list && range.list.includes(serial)) return true;
  if (range.start != null && range.end != null) {
    return serial >= range.start && serial <= range.end;
  }
  if (range.openEnd && range.start != null) return serial >= range.start;
  if (range.openStart && range.end != null) return serial <= range.end;
  return false;
}

/** Decide applies / does_not_apply / review_required based on serial
 *  regex extraction. If we can't find any serial references in the AD
 *  text, we return 'review_required' — never 'does_not_apply'. */
function computeApplicability(raw: RawAd, ac: AircraftMatchInfo): ApplicabilityVerdict {
  const serialStr = ac.serial_number?.trim();
  if (!serialStr) {
    return { status: 'review_required', reason: 'Aircraft has no serial number on file.' };
  }
  const serialNum = serialNumericCore(serialStr);
  if (serialNum == null) {
    return { status: 'review_required', reason: `Serial "${serialStr}" couldn't be parsed numerically.` };
  }

  const hay = [raw.subject, raw.applicability, stripHtml(raw.excerpts || '')].filter(Boolean).join(' ');
  const ranges = extractSerialRanges(hay);

  if (ranges.length === 0) {
    return { status: 'review_required', reason: 'AD text does not cite a specific serial range.' };
  }

  const hit = ranges.find(r => rangeIncludes(r, serialNum));
  if (hit) {
    return { status: 'applies', reason: `Serial ${serialStr} is within a cited range.` };
  }
  return {
    status: 'does_not_apply',
    reason: `Serial ${serialStr} is outside all ${ranges.length} cited range(s).`,
  };
}

function hashRaw(raw: Omit<RawAd, 'source_hash'>): string {
  return createHash('sha1')
    .update(JSON.stringify({
      s: raw.subject,
      e: raw.effective_date,
      a: raw.amendment,
      u: raw.source_url,
      x: raw.excerpts?.slice(0, 500),
    }))
    .digest('hex')
    .slice(0, 16);
}

async function fetchFederalRegisterAds(years: SyncYears): Promise<RawAd[]> {
  const params = new URLSearchParams();
  params.append('conditions[agencies][]', 'federal-aviation-administration');
  params.append('conditions[type][]', 'RULE');
  params.append('conditions[term]', 'airworthiness directive');
  if (years != null) {
    const since = new Date();
    since.setFullYear(since.getFullYear() - years);
    params.append('conditions[publication_date][gte]', since.toISOString().slice(0, 10));
  }
  params.append('per_page', '1000');
  for (const f of ['title', 'abstract', 'document_number', 'publication_date', 'effective_on', 'pdf_url', 'html_url', 'excerpts']) {
    params.append('fields[]', f);
  }

  const out: RawAd[] = [];
  let page = 1;
  // 50 pages × 1000 per page = 50k hard ceiling. Realistically 5y≈700,
  // 10y≈1500, 20y≈3500.
  while (page <= 50) {
    params.set('page', String(page));
    const res = await fetch(`${FR_API_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Federal Register HTTP ${res.status}`);
    const body = await res.json();
    const docs: FrDoc[] = body.results || [];
    for (const d of docs) {
      const adNumber = extractAdNumber(d.excerpts);
      if (!adNumber) continue;
      const rawBase = {
        ad_number: adNumber,
        subject: d.title.replace(/^Airworthiness Directives?;\s*/i, '').trim() || d.title,
        applicability: d.abstract || undefined,
        excerpts: d.excerpts || undefined,
        effective_date: d.effective_on || d.publication_date,
        amendment: extractAmendment(d.excerpts) || undefined,
        source_url: d.pdf_url || d.html_url || undefined,
        compliance_type: 'one_time' as const,
      };
      out.push({ ...rawBase, source_hash: hashRaw(rawBase) });
    }
    const totalPages = body.total_pages || 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

export interface SyncOptions {
  years?: SyncYears;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  pruned: number;
  applies: number;
  doesNotApply: number;
  reviewRequired: number;
  error?: string;
}

export async function syncAdsForAircraft(
  sb: SupabaseClient,
  aircraft: AircraftMatchInfo,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const years = options.years ?? 5;

  let rawAds: RawAd[];
  try {
    rawAds = await fetchFederalRegisterAds(years);
  } catch (err: any) {
    return {
      inserted: 0, updated: 0, skipped: 0, pruned: 0,
      applies: 0, doesNotApply: 0, reviewRequired: 0,
      error: `Feed fetch failed: ${err.message}`,
    };
  }

  // Pull equipment once — used for engine/prop match needles.
  // Throw on read failure: a silent fallback to `equipment = []`
  // would make `applies()` miss every engine + prop AD on this
  // aircraft, leading to a "does_not_apply" verdict that could put
  // the aircraft out of 91.417(b) compliance.
  const { data: equipmentData, error: equipmentErr } = await sb
    .from('aft_aircraft_equipment')
    .select('category, make, model, serial')
    .eq('aircraft_id', aircraft.id)
    .is('deleted_at', null)
    .is('removed_at', null);
  if (equipmentErr) throw equipmentErr;
  const equipment = (equipmentData || []) as EquipmentItem[];

  const feedHealthy = rawAds.length >= 50;
  const applicable = rawAds.filter(r => applies(r, aircraft, equipment));
  const applicableNumbers = new Set(applicable.map(a => a.ad_number));

  const { data: existing } = await sb
    .from('aft_airworthiness_directives')
    .select('id, ad_number, sync_hash, source, last_complied_date, last_complied_time, next_due_date, next_due_time, applicability_status')
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
    applicability_status: 'applies' | 'does_not_apply' | 'review_required' | null;
  };
  const existingRows = (existing || []) as ExistingAd[];
  const existingByNumber = new Map<string, ExistingAd>();
  for (const e of existingRows) existingByNumber.set(e.ad_number, e);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let pruned = 0;
  let applies_ = 0;
  let doesNotApply = 0;
  let reviewRequired = 0;
  const now = new Date().toISOString();

  for (const raw of applicable) {
    const verdict = computeApplicability(raw, aircraft);
    if (verdict.status === 'applies') applies_ += 1;
    else if (verdict.status === 'does_not_apply') doesNotApply += 1;
    else reviewRequired += 1;

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
        sync_hash: raw.source_hash,
        applicability_status: verdict.status,
        applicability_reason: verdict.reason,
        applicability_checked_at: now,
      });
      if (!error) inserted += 1;
      else skipped += 1;
    } else if (current.sync_hash !== raw.source_hash) {
      if (current.source === 'drs_sync') {
        // Refresh AD content fields from the new feed payload. Do NOT
        // overwrite applicability when something more authoritative
        // than the regex has already set it: the /api/ads/check-applicability
        // route writes Haiku drill-down decisions that reason about
        // engine variants, prop serials, and equipment combinations
        // the regex can't see, and a pilot-flipped applicability is
        // a deliberate human call. Preserving those means an AD text
        // amendment doesn't silently revert a $50-of-Haiku-tokens
        // decision back to the regex's review_required output.
        //
        // Only re-run regex when current.applicability_status IS NULL
        // (e.g., legacy rows from before mig 038, or a row that's
        // never had any verdict). The regex result is captured in
        // `verdict` already; just gate the columns we write.
        const updateRow: Record<string, any> = {
          subject: raw.subject,
          amendment: raw.amendment,
          applicability: raw.applicability,
          source_url: raw.source_url,
          effective_date: raw.effective_date,
          synced_at: now,
          sync_hash: raw.source_hash,
        };
        if (current.applicability_status == null) {
          updateRow.applicability_status = verdict.status;
          updateRow.applicability_reason = verdict.reason;
          updateRow.applicability_checked_at = now;
        }
        const { error } = await sb
          .from('aft_airworthiness_directives')
          .update(updateRow)
          .eq('id', current.id);
        if (!error) updated += 1;
        else skipped += 1;
      } else {
        skipped += 1;
      }
    } else {
      // Same content hash. Backfill applicability if NULL (legacy
      // pre-mig-038 rows that never got a regex verdict); never
      // overwrite an existing value — see comment in the hash-changed
      // branch above. The pre-fix behavior re-ran the regex every
      // sync and clobbered Haiku drill-down + pilot decisions on the
      // tick after they were made.
      if (current.applicability_status == null) {
        const { error } = await sb
          .from('aft_airworthiness_directives')
          .update({
            applicability_status: verdict.status,
            applicability_reason: verdict.reason,
            applicability_checked_at: now,
          })
          .eq('id', current.id);
        if (!error) skipped += 1;
      } else {
        skipped += 1;
      }
    }
  }

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

  return {
    inserted, updated, skipped, pruned,
    applies: applies_, doesNotApply, reviewRequired,
  };
}
