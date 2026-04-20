"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { authFetch } from "@/lib/authFetch";
import { CheckCircle, X, Loader2, Sparkles, Calendar, FileText, Wrench, Plane, AlertTriangle, RefreshCw, UserPlus } from "lucide-react";
import type { ProposedAction } from "@/lib/howard/proposedActions";
import { matchesAircraft } from "@/lib/swrKeys";

interface Props {
  action: ProposedAction;
  onChange: () => void;
}

function actionIcon(type: string) {
  if (type === 'reservation') return Calendar;
  if (type === 'note') return FileText;
  if (type === 'mx_schedule') return Wrench;
  if (type === 'squawk_resolve') return AlertTriangle;
  if (type === 'equipment') return Plane;
  if (type === 'onboarding_setup') return UserPlus;
  return Sparkles;
}

function describePayload(action: ProposedAction): React.ReactNode {
  const p = action.payload || {};
  switch (action.action_type) {
    case 'reservation':
      return (
        <div className="text-xs text-gray-600 space-y-0.5">
          <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">When: </span>{new Date(p.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} → {new Date(p.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div>
          <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Pilot: </span>{p.pilot_initials}</div>
          {(p.pod || p.poa) && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Route: </span>{p.pod || '?'} → {p.poa || '?'}</div>}
          {p.notes && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Notes: </span>{p.notes}</div>}
        </div>
      );
    case 'note':
      return (
        <div className="text-xs text-gray-700 italic whitespace-pre-wrap border-l-2 border-gray-300 pl-2">
          {p.content}
        </div>
      );
    case 'squawk_resolve':
      return (
        <div className="text-xs text-gray-600">
          <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Resolution: </span>{p.resolution_note}</div>
        </div>
      );
    case 'equipment':
      return (
        <div className="text-xs text-gray-600 space-y-0.5">
          <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Category: </span>{p.category} — {p.name}</div>
          {(p.make || p.model || p.serial) && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">ID: </span>{[p.make, p.model, p.serial && `S/N ${p.serial}`].filter(Boolean).join(' · ')}</div>}
          {p.installed_at && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Installed: </span>{p.installed_at}{p.installed_by ? ` by ${p.installed_by}` : ''}</div>}
          {(p.ifr_capable || p.adsb_out || p.is_elt) && (
            <div className="flex flex-wrap gap-1 pt-1">
              {p.ifr_capable && <span className="text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#3AB0FF]/10 text-[#3AB0FF] border border-[#3AB0FF]/20">IFR</span>}
              {p.adsb_out && <span className="text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#56B94A]/10 text-[#56B94A] border border-[#56B94A]/20">ADS-B Out</span>}
              {p.is_elt && <span className="text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-mxOrange/10 text-mxOrange border border-mxOrange/20">ELT</span>}
            </div>
          )}
        </div>
      );
    case 'mx_schedule':
      return (
        <div className="text-xs text-gray-600 space-y-0.5">
          {p.proposed_date && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Proposed: </span>{p.proposed_date}</div>}
          <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Items: </span>{(p.mx_item_ids?.length || 0)} MX · {(p.squawk_ids?.length || 0)} squawks</div>
          {p.addon_services?.length > 0 && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Add-ons: </span>{p.addon_services.join(', ')}</div>}
          {p.notes && <div><span className="font-bold uppercase tracking-widest text-[9px] text-gray-500">Notes: </span>{p.notes}</div>}
        </div>
      );
    case 'onboarding_setup': {
      const profile = p.profile || {};
      const ac = p.aircraft || {};
      const ratings: string[] = Array.isArray(profile.faa_ratings) ? profile.faa_ratings : [];
      const meterPairs: [string, any][] = [
        ['AFTT', ac.setup_aftt],
        ['FTT', ac.setup_ftt],
        ['Hobbs', ac.setup_hobbs],
        ['Tach', ac.setup_tach],
      ];
      const meters = meterPairs.filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ');
      return (
        <div className="text-xs text-gray-700 space-y-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mb-0.5">Your profile</div>
            <div>{profile.full_name} <span className="text-gray-500">({profile.initials})</span></div>
            {ratings.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {ratings.map((r: string) => (
                  <span key={r} className="text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-brandOrange/10 text-[#c35617] border border-brandOrange/20">{r}</span>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mb-0.5">Your first aircraft</div>
            <div>
              <span className="font-mono font-bold">{ac.tail_number}</span>
              {(ac.make || ac.model) && <span className="text-gray-600"> — {[ac.make, ac.model].filter(Boolean).join(' ')}</span>}
            </div>
            <div className="text-gray-600">
              {ac.engine_type}{ac.is_ifr_equipped ? ' · IFR-equipped' : ' · VFR-only'}
              {ac.home_airport ? ` · home ${ac.home_airport}` : ''}
            </div>
            {meters && <div className="text-gray-500">{meters}</div>}
          </div>
          <p className="text-[10px] italic text-gray-500 pt-1 border-t border-gray-200">
            On confirm: saves your profile, registers the aircraft, makes you admin on it, and marks onboarding complete.
          </p>
        </div>
      );
    }
  }
}

export default function ProposedActionCard({ action, onChange }: Props) {
  const [isPending, setIsPending] = useState<'confirm' | 'cancel' | 'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picConfirming, setPicConfirming] = useState(false);
  const { mutate: globalMutate } = useSWRConfig();

  const Icon = actionIcon(action.action_type);

  // Actions that touch airworthiness state or permanent records warrant
  // an explicit "as PIC I take responsibility for this" re-click so the
  // pilot doesn't tap Confirm on autopilot after 30 Howard messages.
  // Squawk resolution can un-ground the plane; MX schedule sends an
  // email to the mechanic — both deserve the gate. Reservations, notes,
  // equipment adds, and onboarding skip it.
  const requiresPicAck = action.action_type === 'squawk_resolve' || action.action_type === 'mx_schedule';

  // When Howard's action lands (reservation, note, squawk_resolve,
  // mx_schedule, equipment), the side-effects touch tabs scoped to
  // action.aircraft_id. Without this, a user who confirmed "resolve
  // squawk" via Howard would still see the squawk open on the
  // Squawks tab / grounded banner until SWR's background revalidation
  // caught up. Invalidate every aircraft-scoped key so the affected
  // tab refreshes immediately on confirm.
  const invalidateAircraftCache = () => {
    // Onboarding proposals carry no aircraft_id (aircraft is created by
    // the executor). Fleet-wide revalidation is handled by AppShell's
    // post-onboarding refetch; skip the per-aircraft flush here.
    if (!action.aircraft_id) return;
    globalMutate(matchesAircraft(action.aircraft_id), undefined, { revalidate: true });
    // Poke AppShell to re-check the grounded banner. useGroundedStatus
    // runs direct queries (not SWR), so the matchesAircraft invalidation
    // above doesn't trigger it — the event bridges the gap. The
    // aircraftId in detail scopes the refresh so a write on one plane
    // can't re-check a different plane if the pilot just switched.
    window.dispatchEvent(new CustomEvent('aft:refresh-grounded', { detail: action.aircraft_id }));
  };

  const handleConfirm = async (mode: 'confirm' | 'retry' = 'confirm') => {
    setIsPending(mode); setError(null);
    try {
      const res = await authFetch(`/api/howard/actions/${action.id}`, { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || (mode === 'retry' ? "Retry didn't work" : "Couldn't confirm"));
      }
      invalidateAircraftCache();
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPending(null);
    }
  };

  const handleCancel = async () => {
    setIsPending('cancel'); setError(null);
    try {
      const res = await authFetch(`/api/howard/actions/${action.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't cancel");
      }
      // Cancel has no side-effect on aircraft data, but flushing here
      // is cheap and keeps behavior symmetric if this ever grows to
      // touch aircraft state (e.g., future "propose_delete").
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPending(null);
    }
  };

  // Status-specific styling
  const base = "bg-white border rounded-lg p-3 text-navy";
  let statusClasses = "border-[#0EA5E9]/40 shadow-sm";
  if (action.status === 'executed') statusClasses = "border-[#56B94A]/40 bg-green-50/50";
  if (action.status === 'cancelled') statusClasses = "border-gray-300 bg-gray-50 opacity-70";
  if (action.status === 'failed') statusClasses = "border-[#CE3732]/40 bg-red-50";

  return (
    <div className={`${base} ${statusClasses}`}>
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-full shrink-0 ${action.status === 'executed' ? 'bg-[#56B94A]/10 text-[#56B94A]' : action.status === 'cancelled' ? 'bg-gray-200 text-gray-500' : action.status === 'failed' ? 'bg-[#CE3732]/10 text-[#CE3732]' : 'bg-[#0EA5E9]/10 text-[#0EA5E9]'}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Howard proposed</span>
            {action.status === 'pending' && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#0EA5E9]/10 text-[#0EA5E9]">Pending</span>}
            {action.status === 'executed' && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#56B94A]/10 text-[#56B94A]">Confirmed</span>}
            {action.status === 'cancelled' && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">Cancelled</span>}
            {action.status === 'failed' && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#CE3732]/10 text-[#CE3732]">Failed</span>}
          </div>
          <p className="text-sm font-oswald font-bold uppercase text-navy mt-1 leading-tight">{action.summary}</p>
          <div className="mt-2">{describePayload(action)}</div>

          {action.status === 'failed' && action.error_message && (
            <p className="text-[10px] text-[#CE3732] mt-2 italic">Error: {action.error_message}</p>
          )}
          {error && <p className="text-[10px] text-[#CE3732] mt-2 italic">{error}</p>}

          {action.status === 'pending' && !picConfirming && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => {
                  if (requiresPicAck) setPicConfirming(true);
                  else handleConfirm('confirm');
                }}
                disabled={isPending !== null}
                className="flex-1 bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest text-[10px] py-2 rounded active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isPending === 'confirm' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Confirm
              </button>
              <button
                onClick={handleCancel}
                disabled={isPending !== null}
                className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest text-[10px] py-2 rounded active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isPending === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                Cancel
              </button>
            </div>
          )}

          {action.status === 'pending' && picConfirming && (
            <div className="mt-3 bg-[#CE3732]/5 border border-[#CE3732]/30 rounded-md p-2.5">
              <p className="text-[10px] text-[#CE3732] font-bold uppercase tracking-widest mb-1">PIC confirmation</p>
              <p className="text-xs text-navy mb-2 leading-snug">
                {action.action_type === 'squawk_resolve'
                  ? 'Resolving this squawk can clear a grounding condition. As PIC, you are confirming the issue is actually fixed and the aircraft is safe to fly.'
                  : 'Sending this work package emails the mechanic on file. As PIC, you are confirming the items, date, and contact are correct.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPicConfirming(false); handleConfirm('confirm'); }}
                  disabled={isPending !== null}
                  className="flex-1 bg-[#CE3732] text-white font-oswald font-bold uppercase tracking-widest text-[10px] py-2 rounded active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isPending === 'confirm' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  I&apos;m the PIC — proceed
                </button>
                <button
                  onClick={() => setPicConfirming(false)}
                  disabled={isPending !== null}
                  className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest text-[10px] py-2 rounded active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <X size={12} /> Back
                </button>
              </div>
            </div>
          )}

          {action.status === 'failed' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => handleConfirm('retry')}
                disabled={isPending !== null}
                className="flex-1 bg-[#CE3732] text-white font-oswald font-bold uppercase tracking-widest text-[10px] py-2 rounded active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isPending === 'retry' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
