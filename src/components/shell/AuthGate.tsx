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
    // App version check
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) {
      const lv = localStorage.getItem('aft_app_version');
      if (lv && lv !== appVersion) {
        localStorage.setItem('aft_app_version', appVersion);
        window.location.reload();
      } else if (!lv) {
        localStorage.setItem('aft_app_version', appVersion);
      }
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
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
      setSession(session);
      setIsAuthChecking(false);
    });

    // ─── Background Resume ───
    let lastVersionCheck = 0;
    const VERSION_CHECK_COOLDOWN = 5 * 60 * 1000; // 5 minutes between checks

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().then(({ data: { session: freshSession }, error }) => {
          if (error || !freshSession) {
            console.warn('[Auth] Background resume failed — signing out');
            supabase.auth.signOut();
          } else {
            setSession(freshSession);
          }
        });

        // Version check with cooldown to prevent rapid reloads
        const now = Date.now();
        if (appVersion && now - lastVersionCheck > VERSION_CHECK_COOLDOWN) {
          lastVersionCheck = now;
          fetch('/api/version', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.version && data.version !== appVersion) {
                localStorage.setItem('aft_app_version', data.version);
                window.location.reload();
              }
            })
            .catch(() => {}); // Silent fail — network issues shouldn't trigger reload
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
        <p className="text-sm font-roboto text-gray-300 mb-8 max-w-xs leading-relaxed">We are having trouble connecting to the database. You may be experiencing spotty cell or WiFi coverage.</p>
        <button onClick={() => window.location.reload()} className="w-full max-w-xs bg-brandOrange text-white font-oswald text-xl tracking-widest uppercase py-4 rounded-xl shadow-lg active:scale-95 transition-transform">Refresh App</button>
      </div>
    );
    return <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">Loading...</div>;
  }

  if (!session) return <AuthScreen />;

  return <>{children(session)}</>;
}
