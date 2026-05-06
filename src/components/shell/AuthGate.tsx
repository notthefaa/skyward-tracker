"use client";

import { useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { NETWORK_TIMEOUT_MS } from "@/lib/constants";
import { WifiOff } from "lucide-react";
import dynamic from "next/dynamic";

const AuthScreen = dynamic(() => import("@/components/AuthScreen"));

interface AuthGateProps {
  children: (session: any) => ReactNode;
}

/**
 * AuthGate handles all authentication concerns:
 * - Initial session recovery
 * - Auth state change listener
 * - Token refresh handling
 * - Visibility change (background resume) session validation
 * - App version checking
 * - Network timeout display
 *
 * Renders children only when authenticated, passing the session object.
 * Renders AuthScreen when not authenticated.
 * Renders loading/timeout states during auth checking.
 */
export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isNetworkTimeout, setIsNetworkTimeout] = useState(false);

  // ─── Auth Init ───
  useEffect(() => {
    // App version check on mount: this client already has the new
    // bundle (it just executed), so no reload is needed — just sync
    // localStorage to the version we're actually running. The boot
    // path doesn't have any user state worth preserving anyway.
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) {
      localStorage.setItem('aft_app_version', appVersion);
    }

    // Race getSession against a timeout so a stalled GoTrueClient
    // mutex (background refresh suspended by iOS) can't strand the
    // splash screen forever. On miss we treat it as no-session and
    // let the 'aft:network-timeout' UI prompt the user.
    const STARTUP_SESSION_TIMEOUT_MS = 8_000;
    Promise.race([
      supabase.auth.getSession().then(r => r as any).catch((e: any) => ({ data: { session: null }, error: e })),
      new Promise<{ data: { session: null }; error: null; timedOut: true }>(resolve =>
        setTimeout(() => resolve({ data: { session: null }, error: null, timedOut: true }), STARTUP_SESSION_TIMEOUT_MS),
      ),
    ]).then((res: any) => {
      const { data: { session }, error } = res;
      if (error) {
        console.warn('[Auth] Session recovery failed:', error.message);
        supabase.auth.signOut();
        setSession(null);
        setIsAuthChecking(false);
        return;
      }
      setSession(session);
      setIsAuthChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) {
        setSession(session);
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        setSession(session);
        setIsAuthChecking(false);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsAuthChecking(false);
        return;
      }
      // PASSWORD_RECOVERY fires when a user clicks a recovery link.
      // Send them to /update-password instead of dropping into the
      // main app — otherwise a logged-in user clicking the link in
      // another tab would see a brief flash of the dashboard before
      // realising they need to be on the recovery page.
      if (event === 'PASSWORD_RECOVERY') {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/update-password')) {
          window.location.href = '/update-password?type=recovery';
        }
        return;
      }
      setSession(session);
      setIsAuthChecking(false);
    });

    // ─── Background Resume ───
    let lastVersionCheck = 0;
    const VERSION_CHECK_COOLDOWN = 5 * 60 * 1000; // 5 minutes between checks

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Bounded resume getSession (same hazard as startup).
        Promise.race([
          supabase.auth.getSession().then(r => r as any).catch((e: any) => ({ data: { session: null }, error: e })),
          new Promise<{ data: { session: null }; error: null }>(resolve =>
            setTimeout(() => resolve({ data: { session: null }, error: null }), 8_000),
          ),
        ]).then((res: any) => {
          const { data: { session: freshSession }, error } = res;
          if (error || !freshSession) {
            console.warn('[Auth] Background resume failed — signing out');
            // scope: 'local' so we don't revoke refresh tokens for OTHER
            // devices when the resume probe simply timed out on a slow
            // network. Without this, iOS users on cellular get kicked
            // out of every device every time the PWA resumes slowly.
            supabase.auth.signOut({ scope: 'local' });
          } else {
            setSession(freshSession);
          }
        });

        // Version check with cooldown to prevent banner spam.
        // Dispatch an event instead of force-reloading so a pilot
        // mid-form (flight log, mx event, Howard chat) gets to
        // finish before refreshing — UpdateAvailableBanner handles
        // the soft prompt and the actual reload.
        const now = Date.now();
        if (appVersion && now - lastVersionCheck > VERSION_CHECK_COOLDOWN) {
          lastVersionCheck = now;
          fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.version && data.version !== appVersion) {
                window.dispatchEvent(
                  new CustomEvent('aft:version-stale', { detail: { version: data.version } }),
                );
              }
            })
            .catch(() => {}); // Silent fail — network issues shouldn't surface
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ─── Network Timeout ───
  useEffect(() => {
    let t: NodeJS.Timeout;
    if (isAuthChecking) {
      t = setTimeout(() => setIsNetworkTimeout(true), NETWORK_TIMEOUT_MS);
    }
    return () => { clearTimeout(t); setIsNetworkTimeout(false); };
  }, [isAuthChecking]);

  // ─── Render States ───
  if (isAuthChecking) {
    if (isNetworkTimeout) return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white text-center">
        <WifiOff size={64} className="mb-6 text-brandOrange animate-pulse" />
        <h2 className="font-oswald text-3xl tracking-widest uppercase mb-4">Connection Timeout</h2>
        <p className="text-sm font-roboto text-gray-300 mb-8 max-w-xs leading-relaxed">Can&apos;t reach our servers right now. You might be on spotty cell or WiFi.</p>
        <button onClick={() => window.location.reload()} className="w-full max-w-xs bg-brandOrange text-white font-oswald text-xl tracking-widest uppercase py-4 rounded-xl shadow-lg active:scale-95 transition-transform">Refresh App</button>
      </div>
    );
    return <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">Loading...</div>;
  }

  if (!session) return <AuthScreen />;

  return <>{children(session)}</>;
}
