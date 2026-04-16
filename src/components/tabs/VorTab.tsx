import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, VorCheck, VorCheckType } from "@/lib/types";
import useSWR from "swr";
import { Plus, X, Trash2, Check, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";

const whiteBg = { backgroundColor: '#ffffff' } as const;
const PAGE_SIZE = 10;

const VOR_CHECK_TYPES: { value: VorCheckType; label: string; tolerance: number }[] = [
  { value: 'VOT', label: 'VOT (Test Signal)', tolerance: 4 },
  { value: 'Ground Checkpoint', label: 'Ground Checkpoint', tolerance: 4 },
  { value: 'Airborne Checkpoint', label: 'Airborne Checkpoint', tolerance: 6 },
  { value: 'Dual VOR', label: 'Dual VOR Cross-Check', tolerance: 4 },
];

function getDueStatus(latestCheck: VorCheck | null): { label: string; days: number; color: string; bgColor: string } {
  if (!latestCheck) return { label: 'NO VOR CHECK ON FILE', days: -1, color: 'text-[#CE3732]', bgColor: 'bg-red-50 border-[#CE3732]' };
  const checkDate = new Date(latestCheck.created_at);
  const dueDate = new Date(checkDate);
  dueDate.setDate(dueDate.getDate() + 30);
  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 0) return { label: 'VOR CHECK EXPIRED', days, color: 'text-[#CE3732]', bgColor: 'bg-red-50 border-[#CE3732]' };
  if (days <= 7) return { label: `VOR CHECK DUE IN ${days} DAY${days === 1 ? '' : 'S'}`, days, color: 'text-[#F08B46]', bgColor: 'bg-orange-50 border-[#F08B46]' };
  return { label: `VOR CHECK DUE IN ${days} DAYS`, days, color: 'text-[#56B94A]', bgColor: 'bg-green-50 border-[#56B94A]' };
}

export default function VorTab({
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
  const [checkType, setCheckType] = useState<VorCheckType>('VOT');
  const [station, setStation] = useState('');
  const [bearingError, setBearingError] = useState('');
  const [initials, setInitials] = useState(userInitials);

  const { data, mutate } = useSWR(
    aircraft ? swrKeys.vor(aircraft.id, page) : null,
    async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE;
      const { data: checks, count } = await supabase
        .from('aft_vor_checks')
        .select('*', { count: 'exact' })
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, to);
      const total = count ?? 0;
      return { checks: (checks || []) as VorCheck[], hasMore: total > from + PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    }
  );

  // Fetch latest check for due status (always page 1, limit 1)
  const { data: latestData } = useSWR(
    aircraft ? swrKeys.vorLatest(aircraft.id) : null,
    async () => {
      const { data: checks } = await supabase
        .from('aft_vor_checks')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      return (checks && checks.length > 0) ? checks[0] as VorCheck : null;
    }
  );

  const vorChecks = data?.checks || [];
  const hasMore = data?.hasMore || false;
  const latestCheck = latestData ?? null;
  const due = getDueStatus(latestCheck);

  const openForm = useCallback(() => {
    setCheckType('VOT');
    setStation('');
    setBearingError('');
    setInitials(userInitials);
    setShowModal(true);
  }, [userInitials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aircraft || isSubmitting) return;
    const error = Number(bearingError);
    if (Number.isNaN(error)) { showError('Bearing error must be a number.'); return; }
    if (!station.trim()) { showError('Station/place is required.'); return; }
    if (!initials.trim()) { showError('Initials are required.'); return; }

    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/vor-checks', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          logData: { check_type: checkType, station: station.trim(), bearing_error: error, initials: initials.trim() },
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save.'); }
      showSuccess('VOR check logged.');
      setShowModal(false);
      mutate();
      // Also revalidate the latest check
      await supabase.from('aft_vor_checks').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false }).limit(1);
    } catch (err: any) { showError(err.message); }
    finally { setIsSubmitting(false); }
  };

  const handleDelete = async (check: VorCheck) => {
    if (!aircraft) return;
    const ok = await confirm({ title: 'Delete VOR Check?', message: `Delete the ${check.check_type} check at ${check.station}?`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      const res = await authFetch('/api/vor-checks', { method: 'DELETE', body: JSON.stringify({ logId: check.id, aircraftId: aircraft.id }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to delete.'); }
      showSuccess('VOR check deleted.');
      mutate();
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  const selectedTolerance = VOR_CHECK_TYPES.find(t => t.value === checkType)?.tolerance || 4;
  const previewError = Number(bearingError);
  const previewPassed = !Number.isNaN(previewError) ? Math.abs(previewError) <= selectedTolerance : null;

  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={openForm}><Plus size={18} /> Log VOR Check</PrimaryButton>
      </div>

      {/* Due status banner — outside the card */}
      <div className={`rounded-sm border-2 ${due.bgColor} px-4 py-3 mb-3 flex items-center justify-between`}>
        <div>
          <span className={`font-oswald text-sm font-bold uppercase tracking-widest ${due.color}`}>{due.label}</span>
          {latestCheck && (
            <span className="block text-[10px] text-gray-500 mt-0.5">
              Last: {new Date(latestCheck.created_at).toLocaleDateString()} — {latestCheck.check_type} at {latestCheck.station}
            </span>
          )}
        </div>
        {due.days <= 0 ? <AlertTriangle size={20} className="text-[#CE3732]" /> : null}
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#F08B46] flex flex-col mb-6">
        {/* Header */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] block mb-1">FAR 91.171</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">VOR Check Log</h2>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {['Date', 'Type', 'Place', 'Error', 'Result', 'PIC', ...(isAdmin ? [''] : [])].map(h => (
                  <th key={h} className="pb-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {vorChecks.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-8">No VOR checks logged yet.</td></tr>
              )}
              {vorChecks.map((c, i) => (
                <tr key={c.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider">{c.check_type}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.station}</td>
                  <td className="py-3 pr-4 whitespace-nowrap font-bold">{c.bearing_error > 0 ? '+' : ''}{c.bearing_error}°</td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {c.passed
                      ? <span className="inline-flex items-center gap-1 text-[#56B94A] font-bold"><Check size={14} /> Pass</span>
                      : <span className="inline-flex items-center gap-1 text-[#CE3732] font-bold"><AlertTriangle size={14} /> Fail</span>
                    }
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap font-bold">{c.initials}</td>
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
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F08B46] transition-colors"><ChevronLeft size={14} /> Prev</button>
            <span className="text-[10px] font-bold uppercase text-gray-400">Page {page} / {data?.totalPages ?? 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#F08B46] transition-colors">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[10000] bg-black/60 animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#F08B46] animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Log VOR Check</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Check Type</label>
                  <select value={checkType} onChange={e => setCheckType(e.target.value as VorCheckType)} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#F08B46] outline-none" style={whiteBg}>
                    {VOR_CHECK_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label} (±{t.tolerance}°)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Station / Place</label>
                  <input value={station} onChange={e => setStation(e.target.value)} placeholder="e.g. LAX VOT, V23 checkpoint" className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#F08B46] outline-none" style={whiteBg} required />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Bearing Error (degrees)</label>
                  <input type="number" step="0.1" value={bearingError} onChange={e => setBearingError(e.target.value)} placeholder="e.g. 2, -3, 0" className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#F08B46] outline-none" style={whiteBg} required />
                  {previewPassed !== null && bearingError !== '' && (
                    <span className={`text-[10px] font-bold uppercase tracking-widest mt-1 block ${previewPassed ? 'text-[#56B94A]' : 'text-[#CE3732]'}`}>
                      {Math.abs(previewError)}° — {previewPassed ? `Within ±${selectedTolerance}° tolerance` : `Exceeds ±${selectedTolerance}° tolerance`}
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Pilot Initials</label>
                  <input value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#F08B46] outline-none uppercase" style={whiteBg} required />
                </div>
                <button type="submit" disabled={isSubmitting} className="w-full bg-navy text-white font-oswald text-base font-bold uppercase tracking-widest py-3 rounded-lg shadow active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Saving...' : 'Save VOR Check'}</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
