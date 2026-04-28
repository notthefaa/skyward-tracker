"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics } from "@/lib/types";
import { HOWARD_QUICK_PROMPTS, type FollowUp } from "@/lib/howard/quickPrompts";
import { HOWARD_FIRST_PERSON_INTRO, HOWARD_PIC_DISCLAIMER } from "@/lib/howard/persona";
import {
  X, ArrowLeft, Plane, Maximize2, MessageSquare,
} from "lucide-react";

const HowardTab = dynamic(() => import("@/components/tabs/HowardTab"), { ssr: false });

interface Props {
  /** Aircraft currently selected in the surrounding UI — optional hint. */
  currentAircraft: AircraftWithMetrics | null;
  /** The user's accessible fleet, used for the tail-confirmation picker. */
  userFleet?: AircraftWithMetrics[];
  session?: any;
}

type Mode = 'menu' | 'flight-briefing' | 'chat';

/**
 * Floating entry point to Howard. Always available (Howard is a per-user
 * advisor now — picks aircraft conversationally when needed). The prompts
 * are aircraft-agnostic; if a tail is needed for the question, Howard
 * confirms against the currently-selected aircraft or asks.
 */
export default function HowardLauncher({ currentAircraft, userFleet = [], session }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [dep, setDep] = useState('');
  const [dest, setDest] = useState('');
  const [time, setTime] = useState('');
  const [alt, setAlt] = useState('');

  // Subscribe to the same SWR key HowardTab uses so we share the thread
  // cache — this dedupes to one request and lets us know whether the
  // pilot has an active conversation before they tap the launcher.
  const userId = session?.user?.id;
  const { data: howardData } = useSWR(
    userId ? swrKeys.howardUser(userId) : null,
    async () => {
      const res = await authFetch(`/api/howard`);
      // /api/howard returns 200 + { thread: null, messages: [] } for users
      // with no chat history. A !res.ok is a real failure — throw so SWR
      // retries instead of caching an empty thread as success.
      if (!res.ok) throw new Error("Couldn't load Howard");
      return await res.json() as { thread: any; messages: any[] };
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }
  );
  const hasConversation = (howardData?.messages?.length || 0) > 0;

  // After close, reset to menu 250ms later (masks the close animation).
  // On next open, the open-effect below takes precedence and jumps to
  // chat if a conversation exists.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setMode('menu'), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  // When the launcher opens AND the pilot already has an active
  // conversation, land on the chat surface directly instead of making
  // them click through the quick-prompt menu again. Only fires on the
  // open transition — if they explicitly hit Back to menu mid-session,
  // hasConversation changes don't yank them back to chat.
  useEffect(() => {
    if (open && hasConversation) {
      setMode('chat');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const currentTail = currentAircraft?.tail_number || null;

  const sendPrompt = (prompt: string, followUps?: FollowUp[], kind?: 'aircraft') => {
    try {
      sessionStorage.setItem(
        'aft_howard_prefill',
        JSON.stringify({ prompt, autoSend: true, followUps: followUps || null, kind: kind || null })
      );
    } catch {}
    setMode('chat');
  };

  const openFreeChat = () => {
    try { sessionStorage.removeItem('aft_howard_prefill'); } catch {}
    setMode('chat');
  };

  const expandToFullPage = () => {
    window.dispatchEvent(new CustomEvent('aft:navigate-howard'));
    setOpen(false);
  };

  const briefingFollowUps: FollowUp[] = [
    { label: 'More on weather', prompt: "Dig deeper on the weather — what's trending, and what should I be watching?" },
    { label: 'NOTAMs detail', prompt: 'More on the NOTAMs. Anything critical I should know for each airport or the route?' },
    { label: 'Hazards detail', prompt: 'Dig into SIGMETs, AIRMETs, and notable PIREPs along the route.' },
    { label: 'Alternate options', prompt: 'Suggest realistic alternates and the thinking behind them.' },
    { label: 'Aircraft concerns', prompt: "More on the aircraft side — anything I should address pre-flight?" },
    { label: 'Fuel planning', prompt: 'Help me think about fuel — reserves, burn, and any weather impact.' },
  ];

  const buildBriefingPrompt = () => {
    const when = time
      ? new Date(time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
      : null;
    const parts: string[] = [`Flight briefing.`];
    if (dep && dest) parts.push(`Departing ${dep.toUpperCase()} to ${dest.toUpperCase()}.`);
    else if (dep) parts.push(`Departing ${dep.toUpperCase()}.`);
    else if (dest) parts.push(`Heading to ${dest.toUpperCase()}.`);
    if (when) parts.push(`Planned for ${when}.`);
    if (alt) parts.push(`Alternate: ${alt.toUpperCase()}.`);
    parts.push(
      `Pull official weather (get_weather_briefing + get_aviation_hazards — aviationweather.gov) and official NOTAMs (get_notams — FAA NOTAM API) for each airport. Also flag aircraft-side concerns (confirm which aircraft first). Keep the top-level briefing tight; I'll ask for depth where I need it.`
    );
    return parts.join(' ');
  };

  // Strict alpha check — "ABC" / "KDAL" / "KORD" / "KJFK" ok, digits
  // and punctuation rejected so we don't fire a briefing call on
  // obviously junk input and then explain to the user it failed.
  const isValidAirport = (s: string) => /^[A-Za-z]{3,5}$/.test(s.trim());
  const canSubmitBriefing = isValidAirport(dep) && isValidAirport(dest) && (!alt || isValidAirport(alt));
  const depError = dep.trim().length > 0 && !isValidAirport(dep);
  const destError = dest.trim().length > 0 && !isValidAirport(dest);
  const altError = alt.trim().length > 0 && !isValidAirport(alt);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Howard"
          title="Ask Howard"
          data-tour="howard-fab"
          className="fixed right-4 z-[9998] w-14 h-14 rounded-full overflow-hidden shadow-xl active:scale-95 transition-all border-2 border-white"
          style={{
            // 5rem clears the bottom nav bar; add the iOS home-indicator
            // inset on notch devices so the FAB isn't half-hidden behind
            // the safe area. Fallback to 5rem when the env var is
            // unavailable.
            bottom: 'max(5rem, calc(env(safe-area-inset-bottom) + 5rem))',
          }}
        >
          {/* Full-bleed brand logo — the icon carries its own sunset
           * palette and figure, so no cyan button fill underneath.
           * overflow-hidden on the parent + full-size img lets the
           * rounded-full clip the square SVG into a circular badge. */}
          <img
            src="/howard-logo.svg"
            alt=""
            width={56}
            height={56}
            className="w-full h-full object-cover"
            draggable={false}
          />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[99999] bg-black/50 flex items-center justify-center p-3 md:p-4 modal-overlay"
          onClick={() => setOpen(false)}
        >
          <div
            className={`bg-white rounded-2xl md:rounded-xl shadow-2xl w-full md:max-w-md border-t-4 border-brandOrange flex flex-col ${
              mode === 'chat' ? 'h-[85vh] md:h-[70vh]' : 'max-h-[85vh] overflow-y-auto'
            }`}
            onClick={e => e.stopPropagation()}
          >
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
                {/* Brand logo — matches the floating FAB so the popup
                 * feels like an extension of the same entry point. */}
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-brandOrange/20">
                  <img src="/howard-logo.svg" alt="" className="w-full h-full object-cover" draggable={false} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">
                    {mode === 'flight-briefing' ? 'Flight Briefing' : 'Howard'}
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brandOrange truncate">
                    {currentTail ? `Selected: ${currentTail}` : 'Aviation mentor'}
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

            {/* PIC-authority disclaimer — visible in every mode so the
             * pilot sees it before any back-and-forth with Howard. */}
            <div className="px-4 py-2.5 bg-brandOrange/5 border-b border-brandOrange/20 shrink-0">
              <p className="text-[10px] font-roboto text-gray-600 leading-snug">
                {HOWARD_PIC_DISCLAIMER}
              </p>
            </div>

            {mode === 'menu' && (
              <div className="p-4 flex flex-col gap-2">
                <p className="font-roboto text-sm text-gray-700 mb-1">
                  {HOWARD_FIRST_PERSON_INTRO}
                </p>
                {HOWARD_QUICK_PROMPTS.map(p => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.label}
                      onClick={() => sendPrompt(p.prompt, p.followUps, p.kind)}
                      className="text-left px-4 py-3 bg-gray-50 hover:bg-brandOrange/10 hover:border-brandOrange border border-gray-200 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98] flex items-center gap-3"
                    >
                      <Icon size={16} className="text-brandOrange shrink-0" />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setMode('flight-briefing')}
                  className="text-left px-4 py-3 bg-gray-50 hover:bg-brandOrange/10 hover:border-brandOrange border border-gray-200 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98] flex items-center gap-3"
                >
                  <Plane size={16} className="text-brandOrange shrink-0" />
                  <span>Flight briefing…</span>
                </button>
                <button
                  onClick={openFreeChat}
                  className="text-left px-4 py-3 bg-white hover:bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm font-bold text-gray-600 transition-colors active:scale-[0.98] flex flex-col gap-0.5"
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare size={16} className="text-gray-500 shrink-0" />
                    <span>Ask Howard anything</span>
                  </div>
                  <span className="text-[10px] font-normal text-gray-500 pl-7 leading-tight">Weather, regs, buying a plane, a specific question — just type it.</span>
                </button>
              </div>
            )}

            {mode === 'flight-briefing' && (
              <div className="p-4">
                <p className="font-roboto text-sm text-gray-700 mb-4">
                  Where and when? I&apos;ll pull weather, NOTAMs, hazards, and flag aircraft-side concerns (I&apos;ll confirm which aircraft).
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
                        placeholder="KDAL or DAL"
                        maxLength={5}
                        autoCapitalize="characters"
                        aria-invalid={depError}
                        className={`w-full px-3 py-2 border rounded text-sm uppercase ${depError ? 'border-danger' : 'border-gray-300'}`}
                        style={{ backgroundColor: '#ffffff' }}
                      />
                      {depError && <p className="text-[10px] text-danger mt-1">Letters only, 3–5 characters.</p>}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                        Destination
                      </label>
                      <input
                        type="text"
                        value={dest}
                        onChange={e => setDest(e.target.value)}
                        placeholder="KAUS or AUS"
                        maxLength={5}
                        autoCapitalize="characters"
                        aria-invalid={destError}
                        className={`w-full px-3 py-2 border rounded text-sm uppercase ${destError ? 'border-danger' : 'border-gray-300'}`}
                        style={{ backgroundColor: '#ffffff' }}
                      />
                      {destError && <p className="text-[10px] text-danger mt-1">Letters only, 3–5 characters.</p>}
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
                      placeholder="KADS or ADS"
                      maxLength={5}
                      autoCapitalize="characters"
                      aria-invalid={altError}
                      className={`w-full px-3 py-2 border rounded text-sm uppercase ${altError ? 'border-danger' : 'border-gray-300'}`}
                      style={{ backgroundColor: '#ffffff' }}
                    />
                    {altError && <p className="text-[10px] text-danger mt-1">Letters only, 3–5 characters.</p>}
                  </div>
                </div>
                <button
                  onClick={() => sendPrompt(buildBriefingPrompt(), briefingFollowUps, 'aircraft')}
                  disabled={!canSubmitBriefing}
                  className="mt-5 w-full bg-brandOrange text-white font-oswald font-bold uppercase tracking-widest text-sm py-3 rounded-lg disabled:opacity-40 active:scale-95 transition-transform"
                >
                  Get briefing
                </button>
              </div>
            )}

            {mode === 'chat' && (
              <div className="flex-1 min-h-0 p-4 pt-3">
                <HowardTab currentAircraft={currentAircraft} userFleet={userFleet} session={session} compact />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
