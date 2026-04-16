"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { authFetch } from "@/lib/authFetch";
import { swrKeys } from "@/lib/swrKeys";
import { HowardIcon } from "@/components/shell/TrayIcons";
import type { AircraftWithMetrics } from "@/lib/types";
import {
  X, ArrowLeft, Plane, Maximize2, Shield, Wrench, CalendarPlus,
  Activity, MessageSquare,
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

interface FollowUp {
  label: string;
  prompt: string;
}

interface QuickPrompt {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  prompt: string;
  followUps?: FollowUp[];
  /** 'aircraft' means the prompt needs a tail before Howard can answer;
   * HowardTab renders an aircraft picker until Howard calls a tool. */
  kind?: 'aircraft';
}

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
      if (!res.ok) return { thread: null, messages: [] };
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

  // Prompts stay aircraft-agnostic; Howard confirms which aircraft based
  // on the system-prompt rules (uses currentTail hint, asks if unknown).
  const quickPrompts: QuickPrompt[] = [
    {
      icon: Shield,
      label: 'Airworthiness check',
      kind: 'aircraft',
      prompt: `Is my aircraft airworthy right now? Walk me through it.`,
      followUps: [
        { label: 'Blockers vs warnings', prompt: 'Which of those are blockers and which are just warnings?' },
        { label: 'How to clear each', prompt: 'What does it take to clear each finding?' },
        { label: 'Regulatory basis', prompt: 'What regs back up those findings?' },
      ],
    },
    {
      icon: Wrench,
      label: 'Maintenance overview',
      kind: 'aircraft',
      prompt: `Give me the maintenance picture: anything overdue or due now, upcoming inspections in the next 30–90 days, open squawks, and any ADs to act on. Order by urgency.`,
      followUps: [
        { label: 'Required vs optional', prompt: 'Split those by required vs optional so I know what I can defer.' },
        { label: 'Bundle for one visit', prompt: "Help me group these into a single shop visit to minimize downtime." },
        { label: "What's grounding me", prompt: 'Which of those actually affect airworthiness right now?' },
        { label: 'Open squawks detail', prompt: 'Dig into the open squawks — causes and what it takes to clear them.' },
        { label: 'AD detail', prompt: 'More on the ADs — overdue, due soon, and what each requires.' },
      ],
    },
    {
      icon: CalendarPlus,
      label: 'Book some time',
      kind: 'aircraft',
      prompt: `I'd like to book some time. Ask me for the details you need.`,
    },
    {
      icon: Activity,
      label: 'Recent activity',
      kind: 'aircraft',
      prompt: `What's been happening the last 30 days — flights, squawks, MX work?`,
      followUps: [
        { label: "Who's flying it", prompt: "Who's been flying it? Any patterns?" },
        { label: 'Fuel burn trends', prompt: "How's the fuel burn looking across those flights?" },
        { label: 'Anything unusual', prompt: 'Anything unusual in the last month I should know about?' },
      ],
    },
  ];

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
          className="fixed right-4 z-[9998] w-14 h-14 rounded-full bg-[#0EA5E9] text-white shadow-xl flex items-center justify-center hover:bg-[#0284C7] active:scale-95 transition-all border-2 border-white"
          style={{
            // 5rem clears the bottom nav bar; add the iOS home-indicator
            // inset on notch devices so the FAB isn't half-hidden behind
            // the safe area. Fallback to 5rem when the env var is
            // unavailable.
            bottom: 'max(5rem, calc(env(safe-area-inset-bottom) + 5rem))',
          }}
        >
          <HowardIcon size={28} style={{ color: 'white' }} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[99999] bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4 modal-overlay"
          onClick={() => setOpen(false)}
        >
          <div
            className={`bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full md:max-w-md border-t-4 border-[#0EA5E9] flex flex-col ${
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
                <div className="p-2 rounded-full bg-[#0EA5E9]/10 shrink-0">
                  <HowardIcon size={22} style={{ color: '#0EA5E9' }} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">
                    {mode === 'flight-briefing' ? 'Flight Briefing' : 'Howard'}
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#0EA5E9] truncate">
                    {currentTail ? `Selected: ${currentTail}` : 'Hangar helper'}
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

            {mode === 'menu' && (
              <div className="p-4 flex flex-col gap-2">
                <p className="font-roboto text-sm text-gray-700 mb-1">
                  Hey, I&apos;m Howard, your hangar helper and advisor. I&apos;ve got plenty of aviation stories to share, but before we get into that, what can I help you with?
                </p>
                {quickPrompts.map(p => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.label}
                      onClick={() => sendPrompt(p.prompt, p.followUps, p.kind)}
                      className="text-left px-4 py-3 bg-gray-50 hover:bg-[#0EA5E9]/10 hover:border-[#0EA5E9] border border-gray-200 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98] flex items-center gap-3"
                    >
                      <Icon size={16} className="text-[#0EA5E9] shrink-0" />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setMode('flight-briefing')}
                  className="text-left px-4 py-3 bg-[#0EA5E9]/5 hover:bg-[#0EA5E9]/15 border border-[#0EA5E9]/50 rounded-lg text-sm font-bold text-navy transition-colors active:scale-[0.98] flex items-center gap-3"
                >
                  <Plane size={16} className="text-[#0EA5E9] shrink-0" />
                  <span>Flight briefing…</span>
                </button>
                <button
                  onClick={openFreeChat}
                  className="text-left px-4 py-3 bg-white hover:bg-gray-50 border border-dashed border-gray-300 rounded-lg text-sm font-bold text-gray-600 transition-colors active:scale-[0.98] flex items-center gap-3"
                >
                  <MessageSquare size={16} className="text-gray-500 shrink-0" />
                  <span>Something else…</span>
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
                        className={`w-full px-3 py-2 border rounded text-sm uppercase ${depError ? 'border-[#CE3732]' : 'border-gray-300'}`}
                        style={{ backgroundColor: '#ffffff' }}
                      />
                      {depError && <p className="text-[10px] text-[#CE3732] mt-1">Letters only, 3–5 characters.</p>}
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
                        className={`w-full px-3 py-2 border rounded text-sm uppercase ${destError ? 'border-[#CE3732]' : 'border-gray-300'}`}
                        style={{ backgroundColor: '#ffffff' }}
                      />
                      {destError && <p className="text-[10px] text-[#CE3732] mt-1">Letters only, 3–5 characters.</p>}
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
                      className={`w-full px-3 py-2 border rounded text-sm uppercase ${altError ? 'border-[#CE3732]' : 'border-gray-300'}`}
                      style={{ backgroundColor: '#ffffff' }}
                    />
                    {altError && <p className="text-[10px] text-[#CE3732] mt-1">Letters only, 3–5 characters.</p>}
                  </div>
                </div>
                <button
                  onClick={() => sendPrompt(buildBriefingPrompt(), briefingFollowUps, 'aircraft')}
                  disabled={!canSubmitBriefing}
                  className="mt-5 w-full bg-[#0EA5E9] text-white font-oswald font-bold uppercase tracking-widest text-sm py-3 rounded-lg disabled:opacity-40 active:scale-95 transition-transform"
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
