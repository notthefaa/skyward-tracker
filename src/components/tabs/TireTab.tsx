import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ModalPortal } from "@/components/ModalPortal";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, TireCheck } from "@/lib/types";
import useSWR from "swr";
import { X, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";

const whiteBg = { backgroundColor: '#ffffff' } as const;
const PAGE_SIZE = 10;

function TireRow({
  label, checked, onCheck, psi, onPsi,
}: {
  label: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  psi: string;
  onPsi: (v: string) => void;
}) {
  return (
    <div className={`flex items-center gap-3 rounded p-3 border transition-colors ${checked ? 'border-[#525659] bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      <label className="flex items-center gap-3 flex-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          className="h-4 w-4 accent-[#525659]"
        />
        <span className="text-sm font-bold uppercase tracking-widest text-navy">{label}</span>
      </label>
      {checked && (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={psi}
            onChange={e => onPsi(e.target.value)}
            placeholder="PSI"
            className="w-20 rounded p-2 text-sm border border-gray-300 focus:border-[#525659] outline-none"
            style={whiteBg}
            required
            autoFocus
          />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">psi</span>
        </div>
      )}
    </div>
  );
}

export default function TireTab({
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
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sticky idempotency key — see OilTab for the rationale.
  const submitIdemKeyRef = useRef<string | null>(null);
  useModalScrollLock(showModal);

  // Form fields. Each tire has a "was low" checkbox; the PSI input
  // only appears (and only matters) when the box is checked. Tires
  // not checked are stored as NULL — they weren't adjusted.
  const [noseLow, setNoseLow] = useState(false);
  const [leftLow, setLeftLow] = useState(false);
  const [rightLow, setRightLow] = useState(false);
  const [nosePsi, setNosePsi] = useState('');
  const [leftMainPsi, setLeftMainPsi] = useState('');
  const [rightMainPsi, setRightMainPsi] = useState('');
  const [initials, setInitials] = useState(userInitials);
  const [notes, setNotes] = useState('');
  const [allGood, setAllGood] = useState(false);

  const { data, mutate } = useSWR(
    aircraft ? swrKeys.tire(aircraft.id, page) : null,
    async () => {
      // Fetch one extra row instead of count:'exact' — see TimesTab
      // for the iOS PWA socket-wedge rationale.
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE; // inclusive → fetches PAGE_SIZE + 1 rows
      const { data: checks, error } = await supabase
        .from('aft_tire_checks')
        .select('*')
        .eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      const rows = (checks || []) as TireCheck[];
      const hasMore = rows.length > PAGE_SIZE;
      return { checks: hasMore ? rows.slice(0, PAGE_SIZE) : rows, hasMore };
    }
  );

  const tireChecks = data?.checks || [];
  const hasMore = data?.hasMore || false;

  const openForm = useCallback(() => {
    setNoseLow(false);
    setLeftLow(false);
    setRightLow(false);
    setNosePsi('');
    setLeftMainPsi('');
    setRightMainPsi('');
    setInitials(userInitials);
    setNotes('');
    setAllGood(false);
    submitIdemKeyRef.current = null;
    setShowModal(true);
  }, [userInitials]);

  useEffect(() => {
    if (openFormSignal && openFormSignal > 0) openForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFormSignal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aircraft || isSubmitting) return;
    if (!allGood && !noseLow && !leftLow && !rightLow) {
      showError('Pick the tires you adjusted, or check "All tires OK — no adjustment needed".'); return;
    }
    if (allGood && (noseLow || leftLow || rightLow)) {
      showError('Uncheck "All tires OK" if you adjusted any tires.'); return;
    }
    const checks: Array<[string, boolean, string]> = [
      ['Nose PSI', noseLow, nosePsi],
      ['Left Main PSI', leftLow, leftMainPsi],
      ['Right Main PSI', rightLow, rightMainPsi],
    ];
    for (const [label, isChecked, val] of checks) {
      if (!isChecked) continue;
      const n = Number(val);
      if (val === '' || Number.isNaN(n) || n < 0) {
        showError(`${label} must be a non-negative number.`); return;
      }
    }
    if (!initials.trim()) { showError('Initials are required.'); return; }

    setIsSubmitting(true);
    if (!submitIdemKeyRef.current) submitIdemKeyRef.current = newIdempotencyKey();
    try {
      const res = await authFetch('/api/tire-checks', {
        method: 'POST',
        headers: idempotencyHeader(submitIdemKeyRef.current),
        body: JSON.stringify({
          aircraftId: aircraft.id,
          logData: {
            nose_psi: noseLow ? Number(nosePsi) : null,
            left_main_psi: leftLow ? Number(leftMainPsi) : null,
            right_main_psi: rightLow ? Number(rightMainPsi) : null,
            initials: initials.trim(),
            notes: notes.trim() || null,
          },
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't save the tire check."); }
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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't delete the tire check."); }
      showSuccess('Tire check deleted.');
      mutate();
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  if (!aircraft) return null;

  return (
    <>
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
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(c.occurred_at ?? c.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                  <td className="py-3 pr-4 whitespace-nowrap font-bold">{c.initials}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.nose_psi ?? '—'}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.left_main_psi ?? '—'}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{c.right_main_psi ?? '—'}</td>
                  <td className="py-3 pr-4 max-w-[120px] truncate text-gray-500">{c.notes || '—'}</td>
                  {isAdmin && (
                    <td className="py-3 text-right">
                      {page === 1 && i === 0 && (
                        <button onClick={() => handleDelete(c)} className="text-gray-400 hover:text-danger transition-colors"><Trash2 size={14} /></button>
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
            <span className="text-[10px] font-bold uppercase text-gray-400">Page {page}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-navy disabled:opacity-30 disabled:cursor-not-allowed hover:text-[#525659] transition-colors">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setShowModal(false)}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm p-5 border-t-4 border-[#525659] animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Log Tire Check</h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-danger"><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer text-sm ${allGood ? 'bg-[#56B94A]/10 border-[#56B94A]/40 text-navy' : 'bg-white border-gray-200 text-navy hover:bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    checked={allGood}
                    onChange={e => {
                      const v = e.target.checked;
                      setAllGood(v);
                      if (v) {
                        // Shortcut: checking "all good" clears any tire
                        // adjustments the pilot may have partially toggled.
                        setNoseLow(false); setLeftLow(false); setRightLow(false);
                        setNosePsi(''); setLeftMainPsi(''); setRightMainPsi('');
                      }
                    }}
                    className="h-4 w-4"
                  />
                  <span>All tires OK — no adjustment needed</span>
                </label>
                {!allGood && (
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 block">Tires Adjusted</span>
                    <div className="flex flex-col gap-2">
                      <TireRow
                        label="Nose"
                        checked={noseLow}
                        onCheck={setNoseLow}
                        psi={nosePsi}
                        onPsi={setNosePsi}
                      />
                      <TireRow
                        label="Left Main"
                        checked={leftLow}
                        onCheck={setLeftLow}
                        psi={leftMainPsi}
                        onPsi={setLeftMainPsi}
                      />
                      <TireRow
                        label="Right Main"
                        checked={rightLow}
                        onCheck={setRightLow}
                        psi={rightMainPsi}
                        onPsi={setRightMainPsi}
                      />
                    </div>
                  </div>
                )}
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
      </ModalPortal>}
    </>
  );
}
