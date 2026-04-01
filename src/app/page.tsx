"use client";

import dynamic from "next/dynamic";

const AuthGate = dynamic(() => import("@/components/shell/AuthGate"));
const AppShell = dynamic(() => import("@/components/shell/AppShell"));

/**
 * Root page component.
 *
 * This is a thin composition root that connects AuthGate (session management)
 * with AppShell (fleet data, navigation, content rendering).
 *
 * Auth concerns: AuthGate
 * App concerns: AppShell
 */
export default function FleetTrackerApp() {
  return (
    <AuthGate>
      {(session) => <AppShell session={session} />}
    </AuthGate>
  );
}
