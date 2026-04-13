import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics, TireCheck } from "@/lib/types";
import useSWR from "swr";
import { Plus, X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";

const whiteBg = { backgroundColor: '#ffffff' } as const;
const PAGE_SIZE = 10;

export default function TireTab({
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
  const [nosePsi, setNosePsi] = useState('');
  const [leftMainPsi, setLeftMainPsi] = useState('');
  const [rightMainPsi, setRightMainPsi] = useState('');
  const [initials, setInitials] = useState(userInitials);
  const [notes, setNotes] = useState('');

  const { data, mutate } = useSWR(
    aircraft ? `tire-${aircraft.id}-${page}` : null,
    async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE;
      const { data: checks, count } = await supabase
        .from('aft_tire_checks')
        .select('*', { count: 'exact' })
        .eq('aircraft_id', aircraft!.id)
        .order('created_at', { ascending: false })
        .range(from, to);
      const total = count ?? 0;
      return { checks: (checks || []) as TireCheck[], hasMore: total > from + PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    }
  );

  const tireChecks = data?.checks || [];
  const hasMore = data?.hasMore || false;
  const latestCheck = page === 1 && tireChecks.length > 0 ? tireChecks[0] : null;

  const openForm = useCallback(() => {
    setNosePsi('');
    setLeftMainPsi('');
    setRightMainPsi('');
    setInitials(userInitials);
    setNotes('');
    setShowModal(true);
  }, [userInitials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aircraft || isSubmitting) return;
    const fields = [['Nose PSI', nosePsi], ['Left Main PSI', leftMainPsi], ['Right Main PSI', rightMainPsi]] as const;
    for (const [label, val] of fields) {
      const n = Number(val);
      if (Number.isNaN(n) || n < 0) { showError(`${label} must be a non-negative number.`); return; }
    }
    if (!initials.trim()) { showError('Initials are required.'); return; }

    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/tire-checks', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          logData: {
            nose_psi: Number(nosePsi),
            left_main_psi: Number(leftMainPsi),
            right_main_psi: Number(rightMainPsi),
            initials: initials.trim(),
            notes: notes.trim() || null,
          },
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save.'); }
      showSuccess('Tire check logged.');
      setShowModal(false);
      mutate();
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (check: TireCheck) => {
    if (!aircraft) return;
    const ok = await confirm({ title: 'Delete Tire Check?', message: 'Delete this tire pressure entry?', confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      const res = await authFetch('/api/tire-checks', { method: 'DELETE', body: JSON.stringify({ logId: check.id, aircraftId: aircraft.id }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to delete.'); }
      showSuccess('Tire check deleted.');
      mutate();
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={openForm}><Plus size={18} /> Log Tire Check</PrimaryButton>
      </div>

      {/* Last checked banner — outside the card */}
      <div className="rounded-sm border-2 border-gray-300 bg-gray-50 px-4 py-3 mb-3">
        {latestCheck ? (
          <>
            <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">
              Tire Pressures Checked Last By {latestCheck.initials}
            </span>
            <span className="block text-[10px] text-gray-500 mt-0.5">
              {new Date(latestCheck.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' — '}Nose: {latestCheck.nose_psi} PSI | L Main: {latestCheck.left_main_psi} PSI | R Main: {latestCheck.right_main_psi} PSI
            </span>
          </>
        ) : (
          <span className="font-oswald text-sm font-bold uppercase tracking-widest text-gray-400">No Tire Checks Logged</span>
        )}
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#525659] flex flex-col mb-6">
        {/* Header */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#525659] block mb-1">Pressure Log</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Tire Log</h2>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {['Date', 'PIC', 'Nose', 'L Main', 'R Main', 'Notes', ...(isAdmin ? [''] : [])].map(h => (
                  <th key={h} className="pb-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {tireChecks.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-8">No tire checks logged yet.</td></tr>
              )}
              {tireChecks.map((c, i) => (
                <tr key={c.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                  <td className="py-3 pr-4 whitespace-nowrap font-bold">{c.initials}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.nose_psi}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.left_main_psi}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.right_main_psi}</td>
                  <td className="py-3 pr-4 max-w-[120px] truncate text-gray-500">{c.notes || '—'}</td>
                  {isAdmin && (
                    <td className="py-3 text-right">
                      {page === 1 && i === 0 && (
                        <button onClick={() => handleDelete(c)} className="text-gray-400 hover:text-[#CE3732] transition-colors"><Trash2 size={14} /></button>
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
          <div className="flex justify-between items-center mt-4 border-t border-gray-200 pt-4">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#525659] transition-colors"><ChevronLeft size={14} /> Prev</button>
            <span className="text-[10px] font-bold uppercase text-gray-400">Page {page} / {data?.totalPages ?? 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#525659] transition-colors">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[10000] bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#525659] animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Log Tire Check</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Nose PSI</label>
                    <input type="number" step="0.1" min="0" value={nosePsi} onChange={e => setNosePsi(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#525659] outline-none" style={whiteBg} required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">L Main</label>
                    <input type="number" step="0.1" min="0" value={leftMainPsi} onChange={e => setLeftMainPsi(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#525659] outline-none" style={whiteBg} required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">R Main</label>
                    <input type="number" step="0.1" min="0" value={rightMainPsi} onChange={e => setRightMainPsi(e.target.value)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#525659] outline-none" style={whiteBg} required />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Pilot Initials</label>
                  <input value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#525659] outline-none uppercase" style={whiteBg} required />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Notes (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#525659] outline-none resize-none" style={whiteBg} />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-navy text-white font-oswald text-base font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Saving...' : 'Save Tire Check'}</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
