"use client";

import dynamic from "next/dynamic";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/components/ToastProvider";

const PilotOnboarding = dynamic(() => import("@/components/PilotOnboarding"));
const HowardWelcome = dynamic(() => import("@/components/HowardWelcome"), { ssr: false });
const HowardOnboardingChat = dynamic(() => import("@/components/howard/HowardOnboardingChat"), { ssr: false });

// First-time onboarding state machine.
//   onboardingPath === null     → HowardWelcome (pick guided/form)
//   onboardingPath === 'guided' → HowardOnboardingChat
//   onboardingPath === 'form'   → PilotOnboarding
// Render this AFTER isDataLoaded + completedOnboarding === false in
// the caller. The wrapper handles the path switch + the onComplete
// post-write sequencing.
export default function OnboardingRouter({
  session,
  onboardingPath,
  setOnboardingPath,
  handleLogout,
  handleInitialFetch,
  setCompletedOnboarding,
}: {
  session: any;
  onboardingPath: 'guided' | 'form' | null;
  setOnboardingPath: (v: 'guided' | 'form' | null) => void;
  handleLogout: () => void;
  handleInitialFetch: (userId: string) => Promise<void>;
  setCompletedOnboarding: (v: boolean) => void;
}) {
  const { showSuccess } = useToast();

  if (onboardingPath === 'guided') {
    return (
      <HowardOnboardingChat
        session={session}
        onLogout={handleLogout}
        onSwitchToForm={() => setOnboardingPath('form')}
        onComplete={() => {
          // The executor flipped completed_onboarding=true server-side
          // and created the aircraft; refetch fleet so the rest of the
          // shell renders normally. The spotlight tour will kick in
          // once tourCompleted is still false.
          setOnboardingPath(null);
          setCompletedOnboarding(true);
          handleInitialFetch(session.user.id);
        }}
      />
    );
  }
  if (onboardingPath === 'form') {
    return (
      <PilotOnboarding
        session={session}
        handleLogout={handleLogout}
        onSuccess={async () => {
          // Mark onboarding done server-side so we don't bounce back to
          // the welcome modal after the fleet refetch completes.
          try {
            await authFetch('/api/user/onboarding-complete', { method: 'POST' });
          } catch {
            // Non-blocking — if the flag write fails, the user still has
            // an aircraft and the next reload's fetch will pick that up
            // via the row.
          }
          // Await the fleet refetch BEFORE flipping local onboarding
          // state, so the welcome → form → "no aircraft in your fleet"
          // empty-state flicker doesn't happen mid-render. If the fetch
          // fails, still flip onboarding so the user lands on the main
          // shell instead of being stuck on the form.
          try {
            await handleInitialFetch(session.user.id);
          } catch {
            // handleInitialFetch already shows its own toast.
          }
          setOnboardingPath(null);
          setCompletedOnboarding(true);
          showSuccess('Aircraft added to your hangar.');
        }}
      />
    );
  }
  return (
    <HowardWelcome
      onStartGuided={() => setOnboardingPath('guided')}
      onStartForm={() => setOnboardingPath('form')}
      onLogout={handleLogout}
    />
  );
}
