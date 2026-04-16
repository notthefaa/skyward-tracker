"use client";

import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/authFetch";
import {
  X, Home, PenLine, Calendar, Wrench, FolderOpen, MessageSquare, Settings, BookOpen,
  type LucideIcon,
} from "lucide-react";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";

/**
 * Post-onboarding spotlight tour. Eight Howard-voice steps walking the
 * pilot through every major destination in the app. Each step carries
 * a hero icon + 1-sentence lead + 2–4 icon-bulleted capabilities so
 * the user gets detail without text fatigue. A spotlight cutout
 * anchors to the real UI when the target exists.
 *
 * Final step links into the Features Overview modal for pilots who
 * want more depth — keeps the tour itself short while giving the
 * longer-form guide a natural handoff point.
 */

type Bullet = { icon: LucideIcon; text: string };

type Step = {
  target: string;      // data-tour attribute value, or '' for centered step
  accent: string;      // hex accent used on the card border + hero ring
  hero: LucideIcon;    // the big icon at the top of the card
  eyebrow: string;     // short label above the title (e.g., "Step 3")
  title: string;
  lead: string;        // 1-sentence intro from Howard
  bullets: Bullet[];
};

const STEPS: Step[] = [
  {
    target: '',
    accent: '#e6651b',
    hero: BookOpen,
    eyebrow: "Intro",
    title: "You're in. Let's look around.",
    lead: "Quick tour — seven stops, under a minute. I'll point out where everything lives so you know what the app can do for you.",
    bullets: [],
  },
  {
    target: 'summary',
    accent: '#091F3C',
    hero: Home,
    eyebrow: "Step 1 of 8",
    title: "Summary — your cockpit dashboard",
    lead: "Everything you'd ask before a flight, at a glance.",
    bullets: [
      { icon: Wrench, text: "Current totals, next inspection, open squawks" },
      { icon: PenLine, text: "Recent flight activity + burn rate" },
      { icon: Home, text: "Airworthiness status with the regs that back it" },
    ],
  },
  {
    target: 'log',
    accent: '#3AB0FF',
    hero: PenLine,
    eyebrow: "Step 2 of 8",
    title: "Log — where the day's data lands",
    lead: "One tap splits into Flight and Ops Checks — same spot, two shapes of logging.",
    bullets: [
      { icon: PenLine, text: "Flight: Hobbs/Tach/AFTT, route, pilot, fuel, landings" },
      { icon: PenLine, text: "Ops Checks: VOR (91.171), oil consumption, tire pressure" },
      { icon: Home, text: "Totals auto-update the aircraft's current meter" },
    ],
  },
  {
    target: 'calendar',
    accent: '#56B94A',
    hero: Calendar,
    eyebrow: "Step 3 of 7",
    title: "Calendar — book the airplane",
    lead: "Reserve time, see who else is flying, avoid doubles.",
    bullets: [
      { icon: Calendar, text: "Tap a day to book — route, times, notes" },
      { icon: Wrench, text: "Confirmed maintenance blocks show as unbookable" },
      { icon: MessageSquare, text: "Pilots get an email if their booking gets bumped for MX" },
    ],
  },
  {
    target: 'maintenance',
    accent: '#F08B46',
    hero: Wrench,
    eyebrow: "Step 4 of 7",
    title: "Maintenance — the shop side",
    lead: "Four views sit behind one tab: MX items, squawks, service events, ADs.",
    bullets: [
      { icon: Wrench, text: "Maintenance: dual-interval tracking (hours AND date)" },
      { icon: MessageSquare, text: "Squawks: report a discrepancy, link to a fix" },
      { icon: Calendar, text: "Service: bundle work into one shop visit with a mechanic portal" },
      { icon: BookOpen, text: "ADs: track FAA directives + 91.417(b) compliance export" },
    ],
  },
  {
    target: 'more',
    accent: '#525659',
    hero: FolderOpen,
    eyebrow: "Step 5 of 7",
    title: "More — the rest of the hangar",
    lead: "One tap opens the secondary tray with everything that didn't need its own spot in the main nav.",
    bullets: [
      { icon: MessageSquare, text: "Notes: crew message board with photos — unread count badged here" },
      { icon: FolderOpen, text: "Documents: POH, registration, airworthiness cert, W&B — Howard searches inside them" },
      { icon: Wrench, text: "Equipment: installed avionics with 91.411/91.413/91.207 due dates" },
      { icon: BookOpen, text: "Howard usage: token spend + conversation analytics" },
    ],
  },
  {
    target: 'howard-fab',
    accent: '#e6651b',
    hero: MessageSquare,
    eyebrow: "Step 6 of 7",
    title: "And me — always one tap away",
    lead: "That orange button is me. Ask anything: airworthiness, a briefing, 'is she fueled?' — I'll pull real data, never guess.",
    bullets: [
      { icon: Wrench, text: "Airworthiness check against 91.205 / 411 / 413 / 207" },
      { icon: Calendar, text: "Book, reschedule, or pull a weather+NOTAM briefing" },
      { icon: BookOpen, text: "Cite regs, sync ADs from the FAA DRS feed, decode METARs" },
    ],
  },
  {
    target: '',
    accent: '#091F3C',
    hero: Settings,
    eyebrow: "Step 7 of 7",
    title: "Settings & Crew — make it yours",
    lead: "Profile, ratings, notifications. Admins get crew tools — invite pilots, grant access, set reminder windows.",
    bullets: [
      { icon: Settings, text: "Your name, initials, FAA ratings (shapes Howard's tone)" },
      { icon: MessageSquare, text: "Notification preferences — MX reminders, squawks, notes" },
      { icon: BookOpen, text: "Features Guide: detail on everything, any time" },
    ],
  },
];

function getTargetRect(targetKey: string): DOMRect | null {
  if (!targetKey) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${targetKey}"]`);
  if (!el) return null;
  return el.getBoundingClientRect();
}

export default function HowardTour({
  onComplete,
  onOpenFeaturesGuide,
}: {
  onComplete: () => void;
  /** Optional — if the consumer wires up the Features Overview modal,
   * the final step shows a "Open Features Guide" button that hands
   * off to it. Without this prop, that button is hidden. */
  onOpenFeaturesGuide?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const HeroIcon = current.hero;

  useLayoutEffect(() => {
    const update = () => setRect(getTargetRect(current.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [current.target]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const finish = useCallback(async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    try {
      await authFetch('/api/user/tour-complete', { method: 'POST' });
    } catch {
      // Best effort — tour still closes client-side.
    } finally {
      onComplete();
    }
  }, [isFinishing, onComplete]);

  const next = () => {
    if (isLast) { finish(); return; }
    setStep(s => s + 1);
  };
  const back = () => { if (!isFirst) setStep(s => s - 1); };
  const skip = () => { finish(); };

  // Tooltip positioning: try to place below target, flip to above if
  // there's not enough room. Centered step has no rect → center card.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 375;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 667;
  const CARD_W = Math.min(400, viewportW - 32);
  const CARD_MARGIN = 16;

  let cardStyle: React.CSSProperties = {
    width: CARD_W,
    left: Math.max(CARD_MARGIN, (viewportW - CARD_W) / 2),
    top: Math.max(CARD_MARGIN, (viewportH - 420) / 2),
  };

  if (rect) {
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const cardLeft = Math.min(
      Math.max(CARD_MARGIN, rect.left + rect.width / 2 - CARD_W / 2),
      viewportW - CARD_W - CARD_MARGIN,
    );
    if (spaceBelow > 280) {
      cardStyle = { width: CARD_W, left: cardLeft, top: rect.bottom + 14 };
    } else if (spaceAbove > 280) {
      cardStyle = { width: CARD_W, left: cardLeft, bottom: viewportH - rect.top + 14 };
    } else {
      cardStyle = { width: CARD_W, left: cardLeft, top: CARD_MARGIN };
    }
  }

  const PAD = 6;
  const spotlightStyle: React.CSSProperties | undefined = rect
    ? {
        position: 'fixed',
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        borderRadius: 12,
        boxShadow: '0 0 0 9999px rgba(9, 31, 60, 0.72)',
        pointerEvents: 'none',
        transition: 'top 0.22s ease, left 0.22s ease, width 0.22s ease, height 0.22s ease',
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-[99999]">
      {!rect && <div className="absolute inset-0 bg-[#091F3C]/70 pointer-events-none" />}
      {rect && <div style={spotlightStyle} />}

      <div
        className="absolute bg-white shadow-2xl rounded-xl overflow-hidden animate-slide-up"
        style={{ ...cardStyle, borderTop: `4px solid ${current.accent}` }}
      >
        <button
          onClick={skip}
          aria-label="Skip tour"
          disabled={isFinishing}
          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-navy active:scale-95 z-10"
        >
          <X size={16} />
        </button>

        {/* Hero: big accented icon + Howard attribution */}
        <div
          className="px-5 pt-5 pb-3 flex items-center gap-3"
          style={{ background: `linear-gradient(135deg, ${current.accent}08, ${current.accent}14)` }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-sm"
            style={{ backgroundColor: current.accent, color: '#ffffff' }}
          >
            <HeroIcon size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full overflow-hidden border border-[#e6651b]/30">
                <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: current.accent }}>
                Howard • {current.eyebrow}
              </p>
            </div>
            <h3 className="font-oswald text-lg md:text-xl font-bold uppercase text-navy leading-tight mt-0.5">
              {current.title}
            </h3>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="font-roboto text-sm text-gray-700 leading-relaxed">
            {current.lead}
          </p>

          {current.bullets.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {current.bullets.map((b, i) => {
                const BulletIcon = b.icon;
                return (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-gray-700">
                    <span
                      className="mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${current.accent}15`, color: current.accent }}
                    >
                      <BulletIcon size={12} />
                    </span>
                    <span className="leading-snug">{b.text}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {isLast && onOpenFeaturesGuide && (
            <button
              onClick={() => { onOpenFeaturesGuide(); finish(); }}
              disabled={isFinishing}
              className="mt-4 w-full border border-[#e6651b]/30 text-[#e6651b] font-oswald font-bold uppercase tracking-widest text-[11px] py-2 rounded hover:bg-[#e6651b]/5 active:scale-[0.98] disabled:opacity-50"
            >
              Open the Features Guide
            </button>
          )}
        </div>

        <div className="px-5 pb-4 flex items-center gap-2 justify-between border-t border-gray-100 pt-3">
          <button
            onClick={isFirst ? skip : back}
            disabled={isFinishing}
            className="text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy px-2 py-1 active:scale-95 disabled:opacity-50"
          >
            {isFirst ? 'Skip' : 'Back'}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 mr-2">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className="block w-1.5 h-1.5 rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      i === step ? current.accent : i < step ? `${current.accent}66` : '#E5E7EB',
                  }}
                />
              ))}
            </div>
            <button
              onClick={next}
              disabled={isFinishing}
              className="text-white font-oswald font-bold uppercase tracking-widest text-xs px-5 py-2 rounded active:scale-95 transition-all disabled:opacity-50"
              style={{ backgroundColor: current.accent }}
            >
              {isLast ? "Let's fly" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
