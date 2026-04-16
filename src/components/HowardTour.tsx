"use client";

import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/authFetch";
import { X } from "lucide-react";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";

/**
 * Post-onboarding spotlight tour. Shown once, right after the user
 * finishes onboarding (either guided or form path). Walks them through
 * the key nav destinations with Howard-voice copy beside each.
 *
 * Steps target DOM elements by `data-tour` attribute so the tour
 * doesn't have to know which tab is currently selected — the target
 * simply needs to exist in the tree. If a target is missing (small
 * screen, collapsed tray, etc.), the step renders centered with no
 * spotlight instead of crashing.
 *
 * Persistence: POST to /api/user/tour-complete on finish/skip. The
 * server flips `tour_completed=true` in aft_user_roles; AppShell's
 * gate then stops rendering this tour forever.
 */

type Step = {
  target: string;      // data-tour attribute value, or '' for centered step
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    target: '',
    title: "You're in. Quick tour?",
    body: "I'll walk you through the four spots you'll use most. Takes about thirty seconds.",
  },
  {
    target: 'summary',
    title: "Summary — the heart of it",
    body: "Current totals, next inspection, burn rate, fuel state, squawk count. Everything you'd ask before a flight, at a glance.",
  },
  {
    target: 'log',
    title: "Log — flights and checks",
    body: "Log a flight, record a VOR check, track tire pressure and oil. This is where the day's data lands.",
  },
  {
    target: 'maintenance',
    title: "Maintenance — the shop side",
    body: "MX items, inspections, open squawks, ADs. When it's time to bundle work, hand it off to your mechanic right from here.",
  },
  {
    target: 'howard-fab',
    title: "And me — always one tap away",
    body: "That orange button is me. Anywhere in the app, tap it and ask. Airworthiness, a quick briefing, 'is she fueled?' — whatever you need.",
  },
];

function getTargetRect(targetKey: string): DOMRect | null {
  if (!targetKey) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${targetKey}"]`);
  if (!el) return null;
  return el.getBoundingClientRect();
}

export default function HowardTour({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Recompute the spotlight rect whenever the step changes or the
  // viewport resizes. useLayoutEffect so the overlay paints in the
  // same frame the step advances and we don't flash the old cutout.
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

  // Lock background scroll while the tour is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const finish = useCallback(async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    try {
      // Persist server-side. If it fails, we still close the tour
      // client-side — users won't appreciate the overlay sticking
      // because of a network hiccup. The server flag just prevents
      // the tour from reappearing on next load.
      await authFetch('/api/user/tour-complete', { method: 'POST' });
    } catch {
      // Best effort; silence.
    } finally {
      onComplete();
    }
  }, [isFinishing, onComplete]);

  const next = () => {
    if (isLast) { finish(); return; }
    setStep(s => s + 1);
  };

  const skip = () => { finish(); };

  // Tooltip positioning: try to place below target, flip to above if
  // there's not enough room. Centered step has no rect → center card.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 375;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 667;
  const CARD_W = Math.min(360, viewportW - 32);
  const CARD_MARGIN = 16;

  let cardStyle: React.CSSProperties = {
    width: CARD_W,
    left: Math.max(CARD_MARGIN, (viewportW - CARD_W) / 2),
    top: Math.max(CARD_MARGIN, (viewportH - 320) / 2),
  };

  if (rect) {
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const cardLeft = Math.min(
      Math.max(CARD_MARGIN, rect.left + rect.width / 2 - CARD_W / 2),
      viewportW - CARD_W - CARD_MARGIN,
    );
    if (spaceBelow > 220) {
      cardStyle = { width: CARD_W, left: cardLeft, top: rect.bottom + 14 };
    } else if (spaceAbove > 220) {
      cardStyle = { width: CARD_W, left: cardLeft, bottom: viewportH - rect.top + 14 };
    } else {
      // Sandwich: put the card where there's more room
      cardStyle = { width: CARD_W, left: cardLeft, top: CARD_MARGIN };
    }
  }

  // Spotlight cutout — a rounded rect with a very large inset
  // box-shadow to darken everything outside it. Padding expands the
  // cutout slightly around the target so the element doesn't look
  // jammed against the dim.
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
      {/* Backdrop when there's no specific target — solid dim without
          a cutout. The outer div is click-through to the card. */}
      {!rect && (
        <div className="absolute inset-0 bg-[#091F3C]/70 pointer-events-none" />
      )}

      {/* Spotlight cutout for targeted steps */}
      {rect && <div style={spotlightStyle} />}

      {/* Tooltip card */}
      <div
        className="absolute bg-cream shadow-2xl rounded-lg border-t-4 border-[#e6651b] p-5 md:p-6 animate-slide-up"
        style={cardStyle}
      >
        <button
          onClick={skip}
          aria-label="Skip tour"
          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-navy active:scale-95"
          disabled={isFinishing}
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border border-[#e6651b]/30 shrink-0">
            <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#e6651b] leading-tight">
              Howard • Step {step + 1} of {STEPS.length}
            </p>
            <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-tight truncate">
              {current.title}
            </h3>
          </div>
        </div>

        <p className="font-roboto text-sm text-gray-700 leading-relaxed mb-4">
          {current.body}
        </p>

        <div className="flex items-center gap-2 justify-between">
          <button
            onClick={skip}
            disabled={isFinishing}
            className="text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy px-2 py-1 active:scale-95 disabled:opacity-50"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {/* Step dots */}
            <div className="flex gap-1 mr-2">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`block w-1.5 h-1.5 rounded-full transition-colors ${
                    i === step ? 'bg-[#e6651b]' : i < step ? 'bg-[#e6651b]/40' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={next}
              disabled={isFinishing}
              className="bg-[#e6651b] hover:bg-[#c35617] text-white font-oswald font-bold uppercase tracking-widest text-xs px-5 py-2 rounded active:scale-95 transition-all disabled:opacity-50"
            >
              {isLast ? "Let's fly" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
