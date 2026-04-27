import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { ModalPortal } from "@/components/ModalPortal";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, OilLog } from "@/lib/types";
import useSWR, { useSWRConfig } from "swr";
import { X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";

const whiteBg = { backgroundColor: '#ffffff' } as const;
const PAGE_SIZE = 10;

// ─── SVG Oil Consumption Chart ───
//
// Each entry is logged with the PRE-add dipstick reading (`oil_qty`)
// + optional `oil_added`. The post-add level is `oil_qty + oil_added`
// — what the sump held after service. To honestly represent the
// consumption curve, we draw a service-jump segment on every add
// day: down to pre-add, vertical up to post-add, then back to the
// next entry's pre-add. A line that skipped the jump would understate
// real consumption between adds.

function OilChart({ entries }: { entries: OilLog[] }) {
  if (entries.length < 2) return (
    <div className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 py-6">
      Need 2+ entries to show consumption trend
    </div>
  );

  const W = 300;
  const H = 120;
  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 20;

  // Expand each entry into 1 or 2 points so the chart can connect
  // pre-add → post-add as a vertical "service jump" on add days.
  const expanded = entries.flatMap(e => {
    const pre = { hrs: e.engine_hours, qty: e.oil_qty, kind: 'pre' as const, added: e.oil_added ?? 0 };
    if ((e.oil_added ?? 0) > 0) {
      return [pre, { hrs: e.engine_hours, qty: e.oil_qty + (e.oil_added as number), kind: 'post' as const, added: e.oil_added ?? 0 }];
    }
    return [pre];
  });

  const allQtys = expanded.map(p => p.qty);
  const minHrs = Math.min(...entries.map(e => e.engine_hours));
  const maxHrs = Math.max(...entries.map(e => e.engine_hours));
  const minQty = Math.min(...allQtys);
  const maxQty = Math.max(...allQtys);
  const qtyRange = maxQty - minQty || 1;
  const hrsRange = maxHrs - minHrs || 1;

  const scaleX = (hrs: number) => PAD_L + ((hrs - minHrs) / hrsRange) * (W - PAD_L - PAD_R);
  const scaleY = (qty: number) => PAD_T + ((maxQty - qty) / qtyRange) * (H - PAD_T - PAD_B);

  const points = expanded.map(p => ({ ...p, x: scaleX(p.hrs), y: scaleY(p.qty) }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Y-axis ticks (3-4 values)
  const yTicks: number[] = [];
  const yStep = qtyRange <= 2 ? 0.5 : qtyRange <= 5 ? 1 : Math.ceil(qtyRange / 4);
  for (let v = Math.floor(minQty); v <= Math.ceil(maxQty); v += yStep) {
    yTicks.push(v);
  }

  // X-axis labels: first + last entry (use entries, not expanded, so
  // we don't label duplicates at the same engine-hour for add days).
  const xLabelPoints = entries
    .filter((_, i) => i === 0 || i === entries.length - 1 || entries.length <= 5)
    .map(e => ({ x: scaleX(e.engine_hours), hrs: e.engine_hours }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PAD_L} y1={scaleY(v)} x2={W - PAD_R} y2={scaleY(v)} stroke="#e5e7eb" strokeWidth="0.5" />
          <text x={PAD_L - 4} y={scaleY(v) + 1.5} textAnchor="end" fill="#9CA3AF" fontSize="7" fontFamily="Roboto, sans-serif">{v}qt</text>
        </g>
      ))}

      {/* X-axis labels */}
      {xLabelPoints.map((p, i) => (
        <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill="#9CA3AF" fontSize="6.5" fontFamily="Roboto, sans-serif">{p.hrs.toFixed(0)}h</text>
      ))}

      {/* Consumption line — walks pre → post on add days so the
       * vertical jump is visible, then continues to next entry. */}
      <path d={pathD} fill="none" stroke="#CE3732" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points — red dot for pre-add / level reading, green dot
       * + "+Xqt" label for post-add. */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.kind === 'post' ? 3 : 2} fill={p.kind === 'post' ? '#56B94A' : '#CE3732'} />
          {p.kind === 'post' && (
            <text x={p.x} y={p.y - 5} textAnchor="middle" fill="#56B94A" fontSize="6" fontWeight="bold">+{p.added}qt</text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ─── Main Component ───

export default function OilTab({
  aircraft, session, role, userInitials, openFormSignal
}: {
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
  userInitials: string;
  /** Optional external open trigger — incremented by a parent (ChecksTab)
   * to signal "open the log-entry modal now." Ignored when undefined. */
  openFormSignal?: number;
}) {
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();
  const { mutate: globalMutate } = useSWRConfig();
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useModalScrollLock(showModal);

  // Form fields
  const [oilQty, setOilQty] = useState('');
  const [oilAdded, setOilAdded] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [initials, setInitials] = useState(userInitials);
  const [notes, setNotes] = useState('');

  // Paginated table data
  const { data, mutate } = useSWR(
    aircraft ? swrKeys.oil(aircraft.id, page) : null,
    async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE;
      // Sort by occurred_at (when the reading was physically taken)
      // rather than created_at (when the server wrote the row). With
      // the offline-queue companion app, these diverge — an entry
      // dated 14:00 may not reach the DB until 16:30 if the phone was
      // out of signal. created_at kicks in as a tiebreaker for entries
      // with identical occurred_at.
      const { data: logs, count, error } = await supabase
        .from('aft_oil_logs')
        .select('*', { count: 'exact' })
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      const total = count ?? 0;
      return { logs: (logs || []) as OilLog[], hasMore: total > from + PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    }
  );

  // Chart data — last 10 entries by engine hours ascending
  const { data: chartEntries } = useSWR(
    aircraft ? swrKeys.oilChart(aircraft.id) : null,
    async () => {
      const { data: logs, error } = await supabase
        .from('aft_oil_logs')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .order('engine_hours', { ascending: true })
        .limit(15);
      if (error) throw error;
      return (logs || []) as OilLog[];
    }
  );

  const oilLogs = data?.logs || [];
  const hasMore = data?.hasMore || false;

  const openForm = useCallback(() => {
    setOilQty('');
    setOilAdded('');
    setEngineHours(aircraft?.total_engine_time?.toFixed(1) || '');
    setInitials(userInitials);
    setNotes('');
    setShowModal(true);
  }, [userInitials, aircraft]);

  useEffect(() => {
    if (openFormSignal && openFormSignal > 0) openForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFormSignal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aircraft || isSubmitting) return;
    const qty = Number(oilQty);
    const hrs = Number(engineHours);
    if (Number.isNaN(qty) || qty < 0) { showError('Oil quantity must be non-negative.'); return; }
    if (Number.isNaN(hrs) || hrs < 0) { showError('Engine hours must be non-negative.'); return; }
    if (oilAdded && (Number.isNaN(Number(oilAdded)) || Number(oilAdded) < 0)) { showError('Oil added must be non-negative.'); return; }
    if (!initials.trim()) { showError('Initials are required.'); return; }

    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/oil-logs', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          logData: {
            oil_qty: qty,
            oil_added: oilAdded ? Number(oilAdded) : null,
            engine_hours: hrs,
            initials: initials.trim(),
            notes: notes.trim() || null,
          },
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't save the oil log."); }
      showSuccess('Oil log saved.');
      setShowModal(false);
      mutate();
      // Keep the chart + the ChecksTab oil dial in sync. The
      // paginated page-key mutate() above only refreshes this tab's
      // own table view.
      globalMutate(swrKeys.oilChart(aircraft.id));
      globalMutate(swrKeys.oilLastAdded(aircraft.id));
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (log: OilLog) => {
    if (!aircraft) return;
    const ok = await confirm({ title: 'Delete Oil Log?', message: 'Delete this oil log entry?', confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      const res = await authFetch('/api/oil-logs', { method: 'DELETE', body: JSON.stringify({ logId: log.id, aircraftId: aircraft.id }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't delete the oil log."); }
      showSuccess('Oil log deleted.');
      mutate();
      globalMutate(swrKeys.oilChart(aircraft.id));
      globalMutate(swrKeys.oilLastAdded(aircraft.id));
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  if (!aircraft) return null;

  return (
    <>
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-danger flex flex-col mb-6">
        {/* Oil consumption chart */}
        <div className="mb-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-danger block mb-1">Oil Consumption Trend</span>
          <div className="bg-white rounded-sm border border-gray-200 p-2">
            <OilChart entries={chartEntries || []} />
          </div>
          <div className="flex items-center gap-4 mt-1.5 justify-center">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-danger"></span> Before Add</span>
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-[#56B94A]"></span> After Add</span>
          </div>
        </div>

        {/* Header */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-danger block mb-1">Consumption Log</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Oil Log</h2>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {['Date', 'PIC', 'Before', 'Added', 'After', 'Eng Hrs', 'Notes', ...(isAdmin ? [''] : [])].map(h => (
                  <th key={h} className="pb-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {oilLogs.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-8">No oil logs yet.</td></tr>
              )}
              {oilLogs.map((l, i) => {
                const hasAdd = (l.oil_added ?? 0) > 0;
                const after = hasAdd ? l.oil_qty + (l.oil_added as number) : null;
                return (
                  <tr key={l.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                    <td className="py-3 pr-4 whitespace-nowrap">{new Date(l.occurred_at ?? l.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                    <td className="py-3 pr-4 whitespace-nowrap font-bold">{l.initials}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{l.oil_qty} qt</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{hasAdd ? <span className="text-[#56B94A] font-bold">+{l.oil_added} qt</span> : '—'}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{after != null ? <span className="font-bold">{after.toFixed(1)} qt</span> : '—'}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">{l.engine_hours.toFixed(1)}</td>
                    <td className="py-3 pr-4 max-w-[120px] truncate text-gray-500">{l.notes || '—'}</td>
                    {isAdmin && (
                      <td className="py-3 text-right">
                        {page === 1 && i === 0 && (
                          <button onClick={() => handleDelete(l)} className="text-gray-400 hover:text-danger transition-colors"><Trash2 size={14} /></button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(page > 1 || hasMore) && (
          <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-danger transition-colors"><ChevronLeft size={14} /> Prev</button>
            <span className="text-[10px] font-bold uppercase text-gray-400">Page {page} / {data?.totalPages ?? 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-danger transition-colors">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-5 border-t-4 border-danger animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Log Oil</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-danger"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Oil Before Add (qt)</label>
                    <input type="number" step="0.5" min="0" value={oilQty} onChange={e => setOilQty(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-danger outline-none" style={whiteBg} required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Oil Added (qt)</label>
                    <input type="number" step="0.5" min="0" value={oilAdded} onChange={e => setOilAdded(e.target.value)} placeholder="Leave blank for level check" className="w-full rounded p-3 text-sm border border-gray-300 focus:border-danger outline-none" style={whiteBg} />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 leading-snug -mt-2">
                  Log the dipstick reading before pouring anything in. Leave &ldquo;Oil Added&rdquo; blank for a routine level check — we&rsquo;ll compute the end-state automatically when you top her off.
                  {oilQty && oilAdded && Number(oilQty) >= 0 && Number(oilAdded) > 0 && (
                    <span className="block mt-1 text-navy">
                      End state after service: <span className="font-bold">{(Number(oilQty) + Number(oilAdded)).toFixed(1)} qt</span>
                    </span>
                  )}
                </p>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Engine Hours</label>
                  <input type="number" step="0.1" min="0" value={engineHours} onChange={e => setEngineHours(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-danger outline-none" style={whiteBg} required />
                  <span className="text-[9px] text-gray-400 mt-0.5 block">Current: {aircraft?.total_engine_time?.toFixed(1) || '—'} hrs</span>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Pilot Initials</label>
                  <input value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-danger outline-none uppercase" style={whiteBg} required />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Notes (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-danger outline-none resize-none" style={whiteBg} />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-navy text-white font-oswald text-base font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Saving...' : 'Save Oil Log'}</button>
              </form>
            </div>
          </div>
        </div>
      </ModalPortal>}
    </>
  );
}
