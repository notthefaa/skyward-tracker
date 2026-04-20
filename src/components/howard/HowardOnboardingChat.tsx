"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { LogOut } from "lucide-react";
import { HOWARD_LOGO_PATH, HOWARD_PIC_DISCLAIMER } from "@/lib/howard/persona";

const HowardTab = dynamic(() => import("@/components/tabs/HowardTab"), { ssr: false });

/**
 * Full-screen container for Howard's guided onboarding conversation.
 * Distinct from the launcher popup and from the normal HowardTab
 * because:
 *   - No tabs / nav chrome around it — this IS the app for the user
 *     right now.
 *   - No aircraft picker — the user has no aircraft yet.
 *   - Howard speaks first via the ONBOARDING_KICKOFF_MARKER kickoff.
 *   - Exits via `onComplete` when the onboarding_setup proposal lands
 *     as 'executed'.
 */
export default function HowardOnboardingChat({
  session,
  onComplete,
  onLogout,
  onSwitchToForm,
}: {
  session: any;
  onComplete: () => void;
  onLogout: () => void;
  onSwitchToForm: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-slate-50 to-neutral-100 flex flex-col">
      {/* Slim header — Howard brand + escape hatches. Kept compact so
          the chat transcript has as much room as possible on mobile. */}
      <header className="bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full overflow-hidden border border-brandOrange/30 shrink-0">
              <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <div className="min-w-0">
              <h1 className="font-oswald text-base font-bold uppercase tracking-widest text-navy leading-none truncate">
                Setting up with Howard
              </h1>
              <p className="text-[9px] font-bold uppercase tracking-widest text-brandOrange mt-0.5">
                First-time setup
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSwitchToForm}
              className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy active:scale-95 px-2 py-1.5 hidden sm:block"
              title="Skip the chat and fill the form instead"
            >
              Use form instead
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#CE3732] active:scale-95 px-2 py-1.5"
            >
              <LogOut size={12} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-1.5 border-t border-brandOrange/10 bg-brandOrange/5">
          <p className="text-[10px] font-roboto italic text-gray-600 leading-snug">
            {HOWARD_PIC_DISCLAIMER}
          </p>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-3 py-3 md:px-6 md:py-4">
        <HowardTab
          currentAircraft={null}
          userFleet={[]}
          session={session}
          compact
          onboardingMode
          onOnboardingComplete={onComplete}
        />
      </div>
    </div>
  );
}
