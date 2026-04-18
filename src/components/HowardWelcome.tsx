"use client";

import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { HOWARD_BIO, HOWARD_LOGO_PATH } from "@/lib/howard/persona";

/**
 * First-impression screen for a brand-new user. Shown once, before any
 * tab UI loads. Two paths:
 *   - "Let's set up together"  → Howard-guided chat onboarding.
 *   - "I'll do it myself"      → classic PilotOnboarding form.
 *
 * The choice is durable (both paths flip `completed_onboarding=true`
 * on finish) so re-visits don't yank the user back here.
 */
export default function HowardWelcome({
  onStartGuided,
  onStartForm,
  onLogout,
}: {
  onStartGuided: () => void;
  onStartForm: () => void;
  onLogout: () => void;
}) {
  // Lock body scroll while this is mounted — it's a full-screen step,
  // not a floating modal, and the background <main> shouldn't peek
  // through if the viewport gets taller than the card.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-8 overflow-y-auto"
      style={{
        background: 'linear-gradient(135deg, #091F3C 0%, #1a3a5c 50%, #091F3C 100%)',
      }}
    >
      <div className="relative w-full max-w-lg bg-cream shadow-2xl rounded-lg border-t-4 border-[#e6651b] animate-slide-up overflow-hidden">
        {/* Log out escape hatch — some users will land here by accident
            (wrong account, shared device) and need a way back out. */}
        <button
          onClick={onLogout}
          className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#CE3732] active:scale-95 transition-colors px-2 py-1"
          aria-label="Log out"
        >
          <LogOut size={12} />
          <span>Log out</span>
        </button>

        <div className="px-6 pt-10 pb-6 md:px-10 md:pt-12 md:pb-8">
          {/* Logo — big, centered, sets the tone instantly. */}
          <div className="flex justify-center mb-5">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden border-2 border-[#e6651b]/30 shadow-lg">
              <img
                src={HOWARD_LOGO_PATH}
                alt="Howard"
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          </div>

          <h1 className="font-oswald text-3xl md:text-4xl font-bold uppercase tracking-widest text-navy text-center leading-tight">
            Meet Howard
          </h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#e6651b] text-center mt-1 mb-5">
            Your aviation mentor
          </p>

          <p className="font-roboto text-sm md:text-base text-gray-700 leading-relaxed text-center">
            {HOWARD_BIO}
          </p>

          <div className="mt-6 pt-5 border-t border-gray-200">
            <p className="font-roboto text-sm text-navy text-center mb-4">
              Let&apos;s get your profile and first aircraft set up. Pick the path that feels right.
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={onStartGuided}
                className="w-full bg-[#e6651b] hover:bg-[#c35617] text-white font-oswald font-bold uppercase tracking-widest text-sm py-3.5 rounded-lg active:scale-[0.98] transition-all shadow-md"
              >
                Let&apos;s set up together
              </button>
              <button
                onClick={onStartForm}
                className="w-full bg-white hover:bg-gray-50 text-navy font-oswald font-bold uppercase tracking-widest text-sm py-3.5 rounded-lg border border-gray-300 active:scale-[0.98] transition-all"
              >
                I&apos;ll do it myself
              </button>
            </div>

            <p className="text-[10px] font-roboto italic text-gray-500 text-center mt-4 leading-snug">
              Either way, Howard&apos;s always one tap away via the orange button after you finish.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
