import { NextResponse } from 'next/server';
import { requireAuth, requireAircraftAccess, handleApiError } from '@/lib/auth';

// GET — 91.417(b) AD compliance report as CSV
// Query: ?aircraftId=xxx&format=csv
// Includes: all ADs (including superseded + complied) with full audit trail.
export async function GET(req: Request) {
  try {
    const { user, supabaseAdmin } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const aircraftId = searchParams.get('aircraftId');
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    if (!aircraftId) return NextResponse.json({ error: 'Aircraft ID required.' }, { status: 400 });
    await requireAircraftAccess(supabaseAdmin, user.id, aircraftId);

    const { data: aircraft, error: acErr } = await supabaseAdmin
      .from('aft_aircraft')
      .select('tail_number, aircraft_type, serial_number, make, model')
      .eq('id', aircraftId)
      .maybeSingle();
    if (acErr) throw acErr;
    if (!aircraft) return NextResponse.json({ error: 'Aircraft not found.' }, { status: 404 });

    // 91.417(b) compliance reports MUST throw on read failure — silent
    // fallthrough to `ads || []` would print an "all clean" report to a
    // pilot whose actual AD list is just temporarily unreachable.
    const { data: ads, error: adsErr } = await supabaseAdmin
      .from('aft_airworthiness_directives')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .is('deleted_at', null)
      .order('ad_number', { ascending: true });
    if (adsErr) throw adsErr;

    if (format === 'json') {
      return NextResponse.json({ aircraft, ads: ads || [] });
    }

    // CSV export — 91.417(b) format
    const header = [
      'AD Number', 'Subject', 'Effective Date', 'Applicability',
      'Compliance Type', 'Method of Compliance',
      'Last Complied Date', 'Last Complied Hours', 'Last Complied By',
      'Recurring Interval (hrs)', 'Recurring Interval (months)',
      'Next Due Date', 'Next Due Hours',
      'Superseded?', 'Superseded By', 'Source URL', 'Notes',
    ];

    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    const rows = [header.join(',')];
    rows.push(`# ${aircraft.tail_number} ${aircraft.make || ''} ${aircraft.model || aircraft.aircraft_type} S/N ${aircraft.serial_number || 'N/A'}`);
    rows.push(`# Report generated ${new Date().toISOString()} per 14 CFR 91.417(b)`);
    rows.push('');

    for (const ad of ads || []) {
      rows.push([
        ad.ad_number, ad.subject, ad.effective_date, ad.applicability,
        ad.compliance_type, ad.compliance_method,
        ad.last_complied_date, ad.last_complied_time, ad.last_complied_by,
        ad.recurring_interval_hours, ad.recurring_interval_months,
        ad.next_due_date, ad.next_due_time,
        ad.is_superseded ? 'Yes' : 'No', ad.superseded_by,
        ad.source_url, ad.notes,
      ].map(escape).join(','));
    }

    return new Response(rows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${aircraft.tail_number}_AD_Compliance_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) { return handleApiError(error); }
}
