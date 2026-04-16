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
    lead: "Seven stops, under a minute. I'll show you what this app actually does — some of it you won't find anywhere else.",
    bullets: [],
  },
  {
    target: 'summary',
    accent: '#091F3C',
    hero: Home,
    eyebrow: "Step 1 of 7",
    title: "Summary — the pre-flight check",
    lead: "Everything you'd check before walking to the airplane.",
    bullets: [
      { icon: Wrench, text: "Live airworthiness verdict citing the specific FAR (91.205, 91.411, 91.413, 91.207)" },
      { icon: PenLine, text: "Current Hobbs/Tach, engine burn rate, fuel state, next inspection due" },
      { icon: Home, text: "Open squawks with airworthiness impact flagged — grounded items turn the header red" },
    ],
  },
  {
    target: 'log',
    accent: '#3AB0FF',
    hero: PenLine,
    eyebrow: "Step 2 of 7",
    title: "Log — two log types, one tab",
    lead: "Flight and Ops Checks. Every entry updates your aircraft's totals atomically — no drift, no race conditions.",
    bullets: [
      { icon: PenLine, text: "Flight: Hobbs/Tach/AFTT, route, fuel, landings — totals lock the aircraft row so two pilots can't clobber each other" },
      { icon: PenLine, text: "Ops Checks: VOR (FAR 91.171 with 30-day validity tracked), oil consumption trending, tire PSI" },
    ],
  },
  {
    target: 'calendar',
    accent: '#56B94A',
    hero: Calendar,
    eyebrow: "Step 3 of 7",
    title: "Calendar — shared scheduling",
    lead: "Reservations that talk to maintenance.",
    bullets: [
      { icon: Wrench, text: "Confirmed maintenance dates auto-block the calendar — no double-booking over a shop visit" },
      { icon: MessageSquare, text: "If MX bumps a pilot's reservation, they get an email explaining what happened and why" },
    ],
  },
  {
    target: 'maintenance',
    accent: '#F08B46',
    hero: Wrench,
    eyebrow: "Step 4 of 7",
    title: "Maintenance — the shop side",
    lead: "Four views: MX items, squawks, service events, and ADs that auto-sync nightly from the FAA.",
    bullets: [
      { icon: Wrench, text: "Dual-interval tracking — hours AND calendar date, whichever comes first. Start from FAA templates or custom." },
      { icon: MessageSquare, text: "Squawks with photos and airworthiness-impact flags. Resolved squawks link back to the service event that fixed them." },
      { icon: Calendar, text: "Service: email your mechanic a portal link — they propose dates, upload photos, sign off items. No login required." },
      { icon: BookOpen, text: "ADs auto-sync from the FAA DRS feed nightly. Export a 91.417(b) compliance CSV for your IA anytime." },
    ],
  },
  {
    target: 'more',
    accent: '#525659',
    hero: FolderOpen,
    eyebrow: "Step 5 of 7",
    title: "More — documents, equipment, crew notes",
    lead: "The stuff that makes the difference between tracking an airplane and actually managing it.",
    bullets: [
      { icon: FolderOpen, text: "Upload POH, registration, W&B, MEL — each file SHA-256 hashed for tamper detection. Howard can search inside them." },
      { icon: Wrench, text: "Equipment list with transponder / altimeter / pitot-static / ELT due dates — feeds the airworthiness check automatically" },
      { icon: MessageSquare, text: "Notes: crew message board with photos that stays with the aircraft, not a group text that scrolls away" },
    ],
  },
  {
    target: 'howard-fab',
    accent: '#e6651b',
    hero: MessageSquare,
    eyebrow: "Step 6 of 7",
    title: "And me — always one tap away",
    lead: "That orange button is me. I pull real data from the FAA and your own records — I never guess.",
    bullets: [
      { icon: Wrench, text: "Airworthiness checks against 91.205/411/413/207, citing the specific reg that's blocking you" },
      { icon: Calendar, text: "Flight briefings with official METARs, TAFs, NOTAMs, PIREPs — decoded into plain English" },
      { icon: FolderOpen, text: "Search inside your uploaded documents. Ask 'What's the Vne?' and I'll find it in your POH." },
      { icon: BookOpen, text: "Propose bookings, resolve squawks, schedule MX — you see a card and tap Confirm" },
    ],
  },
  {
    target: '',
    accent: '#091F3C',
    hero: Settings,
    eyebrow: "Step 7 of 7",
    title: "Settings & Crew",
    lead: "Your FAA ratings shape how I talk to you. Admins get crew tools — invite pilots, control access per aircraft.",
    bullets: [
      { icon: Settings, text: "Student pilots get more scaffolding; CFIs get the short version. Set your ratings and I adjust." },
      { icon: MessageSquare, text: "MX reminder thresholds — how early you want heads-up emails as inspections approach" },
      { icon: BookOpen, text: "Features Guide in Settings: the full rundown, organized by task, any time you want it" },
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
