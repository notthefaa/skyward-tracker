"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { HowardIcon } from "@/components/shell/TrayIcons";
import type { AircraftWithMetrics } from "@/lib/types";
import { X, ArrowLeft, Plane, Maximize2 } from "lucide-react";

// HowardTab is big; lazy-load it so the FAB bundle stays tiny until
// the user actually opens a chat.
const HowardTab = dynamic(() => import("@/components/tabs/HowardTab"), { ssr: false });

interface Props {
  aircraft: AircraftWithMetrics | null;
  session?: any;
}

type Mode = 'menu' | 'flight-briefing' | 'chat';

/**
 * Floating entry point to Howard. Appears globally while an aircraft is
 * selected (hidden on the Howard tab itself). Tap the FAB → popup with
 * a brief intro and a set of pre-drafted prompts. Pick one and the chat
 * opens inside the popup so the user can keep talking without leaving
 * their current page.
 *
 * The "Flight briefing" path first collects departure / destination /
 * time / alternate, then builds a richer prompt.
 */
export default function HowardLauncher({ aircraft, session }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [dep, setDep] = useState('');
  const [dest, setDest] = useState('');
  const [time, setTime] = useState('');
  const [alt, setAlt] = useState('');

  // Reset to menu when the popup fully closes, so reopening is a fresh
  // starting point. (The conversation itself persists in the DB so the
  // chat view will still show history when re-entered.)
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setMode('menu'), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!aircraft) return null;

  const tail = aircraft.tail_number;

  /** Prime the sessionStorage handoff and jump the embedded HowardTab
   * into chat mode. The tab reads the prefill on mount and auto-sends. */
  const sendPrompt = (prompt: string) => {
    try {
      sessionStorage.setItem('aft_howard_prefill', JSON.stringify({ prompt, autoSend: true }));
    } catch {}
    setMode('chat');
  };

  /** Expand to the full-page Howard tab and close the popup. */
  const expandToFullPage = () => {
    window.dispatchEvent(new CustomEvent('aft:navigate-howard'));
    setOpen(false);
  };

  const quickPrompts: { label: string; prompt: string }[] = [
    {
      label: 'Airworthiness check',
      prompt: `Is ${tail} airworthy right now? Walk me through it.`,
    },
    {
      label: "What's due now",
      prompt: `Anything on ${tail} overdue or due right now? Required items first.`,
    },
    {
      label: 'Upcoming maintenance',
      prompt: `What maintenance is coming due on ${tail} in the next 30 to 90 days? Order by urgency.`,
    },
    {
      label: 'Open squawks',
      prompt: `Rundown of open squawks on ${tail}. Flag anything affecting airworthiness.`,
    },
    {
      label: 'AD compliance',
      prompt: `Any ADs on ${tail} I need to act on? Overdue or due soon.`,
    },
    {
      label: 'Recent activity',
      prompt: `What's been going on with ${tail} the last 30 days — flights, squawks, MX work?`,
    },
  ];

  const buildBriefingPrompt = () => {
    const when = time
      ? new Date(time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
      : null;
    const parts: string[] = [`Flight briefing for ${tail}.`];
    if (dep && dest) parts.push(`Departing ${dep.toUpperCase()} to ${dest.toUpperCase()}.`);
    else if (dep) parts.push(`Departing ${dep.toUpperCase()}.`);
    else if (dest) parts.push(`Heading to ${dest.toUpperCase()}.`);
    if (when) parts.push(`Planned for ${when}.`);
    if (alt) parts.push(`Alternate: ${alt.toUpperCase()}.`);
    parts.push(`Pull weather and hazards, and flag anything on the aircraft side I should know about.`);
    return parts.join(' ');
  };

  const canSubmitBriefing = dep.trim().length >= 3 && dest.trim().length >= 3;

  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Howard"
          title="Ask Howard"
          className="fixed bottom-20 right-4 z-[9998] w-14 h-14 rounded-full bg-[#0EA5E9] text-white shadow-xl flex items-center justify-center hover:bg-[#0284C7] active:scale-95 transition-all border-2 border-white"
        >
          <HowardIcon size={28} style={{ color: 'white' }} />
        </button>
      )}

      {/* Popup */}
      {open && (
        <div
          className="fixed inset-0 z-[99999] bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className={`bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full md:max-w-md border-t-4 border-[#0EA5E9] flex flex-col ${
              mode === 'chat' ? 'h-[85vh] md:h-[70vh]' : 'max-h-[85vh] overflow-y-auto'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header (shared across modes) */}
            <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {mode !== 'menu' && (
                  <button
                    onClick={() => setMode('menu')}
                    className="text-gray-500 hover:text-navy p-1 -ml-1"
                    aria-label="Back"
                    title="Back"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
                <div className="p-2 rounded-full bg-[#0EA5E9]/10 shrink-0">
                  <HowardIcon size={22} style={{ color: '#0EA5E9' }} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">
                    {mode === 'flight-briefing' ? 'Flight Briefing' : 'Howard'}
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#0EA5E9] truncate">
                    For {tail}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mode === 'chat' && (
                  <button
                    onClick={expandToFullPage}
                    aria-label="Open full page"
                    title="Open full page"
                    className="text-gray-400 hover:text-navy p-1"
                  >
                    <Maximize2 size={16} />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-gray-400 hover:text-navy p-1"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            {mode === 'menu' && (
              <div className="p-4 flex flex-col gap-2">
                <p className="font-roboto text-sm text-gray-700 mb-1">
                  Howard here — old pilot, decades around the ramp. What do you want to know about {tail}?
                </p>
                {quickPrompts.map(p => (
                  <button
                    key={p.label}
                    onClick={() => sendPrompt(p.prompt)}
                    className="text-left px-4 py-3 bg-gray-50 hover:bg-[#0EA5E9]/10 hover:border-[#0EA5E9] border border-gray-200 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98]"
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setMode('flight-briefing')}
                  className="text-left px-4 py-3 bg-[#0EA5E9]/5 hover:bg-[#0EA5E9]/15 border border-[#0EA5E9]/50 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98] flex items-center gap-2"
                >
                  <Plane size={14} className="text-[#0EA5E9]" />
                  Flight briefing…
                </button>
              </div>
            )}

            {mode === 'flight-briefing' && (
              <div className="p-4">
                <p className="font-roboto text-sm text-gray-700 mb-4">
                  Where and when? I'll pull weather, hazards, and flag anything on {tail}'s side worth noting.
                </p>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                        Departure
                      </label>
                      <input
                        type="text"
                        value={dep}
                        onChange={e => setDep(e.target.value)}
                        placeholder="KDAL"
                        maxLength={4}
                        autoCapitalize="characters"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm uppercase"
                        style={{ backgroundColor: '#ffffff' }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                        Destination
                      </label>
                      <input
                        type="text"
                        value={dest}
                        onChange={e => setDest(e.target.value)}
                        placeholder="KAUS"
                        maxLength={4}
                        autoCapitalize="characters"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm uppercase"
                        style={{ backgroundColor: '#ffffff' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                      Departure time (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={time}
                      onChange={e => setTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      style={{ backgroundColor: '#ffffff' }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                      Alternate (optional)
                    </label>
                    <input
                      type="text"
                      value={alt}
                      onChange={e => setAlt(e.target.value)}
                      placeholder="KADS"
                      maxLength={4}
                      autoCapitalize="characters"
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm uppercase"
                      style={{ backgroundColor: '#ffffff' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => sendPrompt(buildBriefingPrompt())}
                  disabled={!canSubmitBriefing}
                  className="mt-5 w-full bg-[#0EA5E9] text-white font-oswald font-bold uppercase tracking-widest text-sm py-3 rounded-lg disabled:opacity-40 active:scale-95 transition-transform"
                >
                  Get briefing
                </button>
              </div>
            )}

            {mode === 'chat' && (
              <div className="flex-1 min-h-0 p-4 pt-3">
                <HowardTab aircraft={aircraft} session={session} compact />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
