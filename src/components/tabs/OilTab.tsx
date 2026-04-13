import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics, OilLog } from "@/lib/types";
import useSWR from "swr";
import { Plus, X, Trash2 } from "lucide-react";

import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";

const whiteBg = { backgroundColor: '#ffffff' } as const;
const PAGE_SIZE = 10;

// ─── SVG Oil Consumption Chart ───

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

  const minHrs = Math.min(...entries.map(e => e.engine_hours));
  const maxHrs = Math.max(...entries.map(e => e.engine_hours));
  const minQty = Math.min(...entries.map(e => e.oil_qty));
  const maxQty = Math.max(...entries.map(e => e.oil_qty));
  const qtyRange = maxQty - minQty || 1;
  const hrsRange = maxHrs - minHrs || 1;

  const scaleX = (hrs: number) => PAD_L + ((hrs - minHrs) / hrsRange) * (W - PAD_L - PAD_R);
  const scaleY = (qty: number) => PAD_T + ((maxQty - qty) / qtyRange) * (H - PAD_T - PAD_B);

  const points = entries.map(e => ({ x: scaleX(e.engine_hours), y: scaleY(e.oil_qty), added: (e.oil_added ?? 0) > 0, qty: e.oil_qty, hrs: e.engine_hours }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Y-axis ticks (3-4 values)
  const yTicks: number[] = [];
  const yStep = qtyRange <= 2 ? 0.5 : qtyRange <= 5 ? 1 : Math.ceil(qtyRange / 4);
  for (let v = Math.floor(minQty); v <= Math.ceil(maxQty); v += yStep) {
    yTicks.push(v);
  }

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
      {points.filter((_, i) => i === 0 || i === points.length - 1 || points.length <= 5).map((p, i) => (
        <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill="#9CA3AF" fontSize="6.5" fontFamily="Roboto, sans-serif">{p.hrs.toFixed(0)}h</text>
      ))}

      {/* Line */}
      <path d={pathD} fill="none" stroke="#CE3732" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.added ? 3 : 2} fill={p.added ? '#56B94A' : '#CE3732'} />
          {p.added && (
            <text x={p.x} y={p.y - 5} textAnchor="middle" fill="#56B94A" fontSize="6" fontWeight="bold">+</text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ─── Main Component ───

export default function OilTab({
  aircraft, session, role, userInitials
}: {
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
  userInitials: string;
}) {
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();
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
    aircraft ? `oil-${aircraft.id}-${page}` : null,
    async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE;
      const { data: logs, count } = await supabase
        .from('aft_oil_logs')
        .select('*', { count: 'exact' })
        .eq('aircraft_id', aircraft!.id)
        .order('created_at', { ascending: false })
        .range(from, to);
      const total = count ?? 0;
      return { logs: (logs || []) as OilLog[], hasMore: total > from + PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    }
  );

  // Chart data — last 10 entries by engine hours ascending
  const { data: chartEntries } = useSWR(
    aircraft ? `oil-chart-${aircraft.id}` : null,
    async () => {
      const { data: logs } = await supabase
        .from('aft_oil_logs')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .order('engine_hours', { ascending: true })
        .limit(15);
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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save.'); }
      showSuccess('Oil log saved.');
      setShowModal(false);
      mutate();
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (log: OilLog) => {
    if (!aircraft) return;
    const ok = await confirm({ title: 'Delete Oil Log?', message: 'Delete this oil log entry?', confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      const res = await authFetch('/api/oil-logs', { method: 'DELETE', body: JSON.stringify({ logId: log.id, aircraftId: aircraft.id }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to delete.'); }
      showSuccess('Oil log deleted.');
      mutate();
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <button onClick={openForm} className="flex items-center gap-2 bg-navy text-white font-oswald text-sm font-bold uppercase tracking-widest px-4 py-2.5 rounded-lg shadow active:scale-95 transition-transform w-full justify-center">
          <Plus size={16} /> Log Oil Check
        </button>
      </div>

      <div className="bg-cream rounded-lg shadow border-t-4 border-[#CE3732] p-4 md:p-6">
        {/* Oil consumption chart */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Oil Consumption Trend</span>
          <div className="bg-white rounded-lg border border-gray-200 p-2">
            <OilChart entries={chartEntries || []} />
          </div>
          <div className="flex items-center gap-4 mt-1.5 justify-center">
            <span className="flex items-center gap-1 text-[9px] text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-[#CE3732]"></span> Oil Level</span>
            <span className="flex items-center gap-1 text-[9px] text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-[#56B94A]"></span> Oil Added</span>
          </div>
        </div>

        {/* Header */}
        <div className="mb-3">
          <h2 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Oil Log</h2>
        </div>

        {/* Table */}
        <div className="overflow-x-auto -mx-4 md:-mx-6 px-4 md:px-6">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-gray-300">
                {['Date', 'PIC', 'Qty', 'Added', 'Eng Hrs', 'Notes', ...(isAdmin ? [''] : [])].map(h => (
                  <th key={h} className="text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-2 pr-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {oilLogs.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-8">No oil logs yet.</td></tr>
              )}
              {oilLogs.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{new Date(l.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap font-bold">{l.initials}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{l.oil_qty} qt</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{l.oil_added ? <span className="text-[#56B94A] font-bold">+{l.oil_added} qt</span> : '—'}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{l.engine_hours.toFixed(1)}</td>
                  <td className="py-2.5 pr-3 max-w-[120px] truncate text-gray-500">{l.notes || '—'}</td>
                  {isAdmin && (
                    <td className="py-2.5 whitespace-nowrap">
                      {page === 1 && i === 0 && (
                        <button onClick={() => handleDelete(l)} className="text-gray-400 hover:text-[#CE3732] transition-colors"><Trash2 size={14} /></button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(page > 1 || hasMore) && (
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-200">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30">Prev</button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Page {page} / {data?.totalPages ?? 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30">Next</button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[10000] bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#CE3732] animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Log Oil Check</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Oil Level (qt)</label>
                    <input type="number" step="0.1" min="0" value={oilQty} onChange={e => setOilQty(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#CE3732] outline-none" style={whiteBg} required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Oil Added (qt)</label>
                    <input type="number" step="0.1" min="0" value={oilAdded} onChange={e => setOilAdded(e.target.value)} placeholder="Optional" className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#CE3732] outline-none" style={whiteBg} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Engine Hours</label>
                  <input type="number" step="0.1" min="0" value={engineHours} onChange={e => setEngineHours(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#CE3732] outline-none" style={whiteBg} required />
                  <span className="text-[9px] text-gray-400 mt-0.5 block">Current: {aircraft?.total_engine_time?.toFixed(1) || '—'} hrs</span>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Pilot Initials</label>
                  <input value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#CE3732] outline-none uppercase" style={whiteBg} required />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Notes (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#CE3732] outline-none resize-none" style={whiteBg} />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-navy text-white font-oswald text-base font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Saving...' : 'Save Oil Log'}</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
