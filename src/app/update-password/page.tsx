"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";

export default function UpdatePassword() {
  const { showError } = useToast();
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [fullName, setFullName] = useState("");
  const[isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Security Verification State
  const [session, setSession] = useState<any>(null);
  const[isVerifying, setIsVerifying] = useState(true);
  // 'invite' uses the full Complete-Setup form (name + initials + password).
  // 'recovery' is a returning user who already has a profile and only
  // needs to change their password — collecting fullName/initials again
  // would overwrite their saved profile with whatever they retype.
  const [flowType, setFlowType] = useState<'invite' | 'recovery'>('invite');

  // New Link Request State
  const[requestEmail, setRequestEmail] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  useEffect(() => {
    const verifyToken = async () => {
      // 1. OUTLOOK/SAFELINKS FIX: Look for the raw token hash in the URL
      const params = new URLSearchParams(window.location.search);
      const token_hash = params.get('token_hash');
      const type = params.get('type') as 'invite' | 'recovery' | null;

      if (token_hash && type) {
        if (type === 'recovery') setFlowType('recovery');
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash,
          type,
        });
        if (error) {
          // Surface verifyOtp errors so the user knows why they're seeing
          // the "Link Expired" screen — silent failure made it impossible
          // to distinguish "token expired" from "token format wrong".
          showError(`Couldn't verify the link: ${error.message}`);
        }

        if (data?.session) {
          setSession(data.session);
          // Clean the URL so the token doesn't linger in the address bar
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        setIsVerifying(false);
        return;
      }

      // 2. Standard Fallback Check
      // Bound against an 8s timer — iOS resume with a wedged GoTrue
      // lock can hang getSession() indefinitely, leaving the user on
      // the verifying spinner with no way out. Mirror the pattern in
      // service/[id]/page.tsx. On miss, fall through to the
      // onAuthStateChange subscription below which fires when the
      // GoTrue thread eventually unsticks.
      const sessionResult = await Promise.race([
        supabase.auth.getSession().then(r => ({ ok: true as const, data: r.data })),
        new Promise<{ ok: false }>(resolve => setTimeout(() => resolve({ ok: false }), 8000)),
      ]);
      if (sessionResult.ok && sessionResult.data.session) {
         setSession(sessionResult.data.session);
      }
      setIsVerifying(false);
    };

    verifyToken();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSession(session);
        setIsVerifying(false);
      }
    });

    return () => subscription.unsubscribe();
  },[]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!session) {
      showError("The secure session expired. Close this window and click your invite link again.");
      setIsSubmitting(false);
      return;
    }

    try {
      // 1. Save the new password via Supabase Auth
      const { error: pwdError } = await supabase.auth.updateUser({ password });
      if (pwdError) {
        showError("Couldn't update the password: " + pwdError.message);
        return;
      }

      // 2. Save profile fields ONLY for invites — recovery users already
      // have a saved profile, and writing the form values back would
      // overwrite their full_name/initials with whatever they retype.
      // Bubble errors to the user instead of redirecting with half-saved
      // state.
      if (flowType === 'invite') {
        const { error: profileError } = await supabase.from('aft_user_roles').update({
          initials: initials.toUpperCase(),
          email: (session.user.email || '').toLowerCase(),
          full_name: fullName.trim(),
        }).eq('user_id', session.user.id);
        if (profileError) {
          showError("Couldn't save your profile: " + profileError.message);
          return;
        }
      }

      // 3. Send them to the main dashboard!
      window.location.href = "/";
    } catch (err: any) {
      showError("Setup didn't finish: " + (err?.message || 'unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = requestEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Enter a valid email address.');
      return;
    }
    setIsRequesting(true);

    try {
      const res = await fetch('/api/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(15_000),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Couldn't send a new invite link.");
      }
      
      setRequestSent(true);
    } catch (error: any) {
      showError(error.message);
    }
    
    setIsRequesting(false);
  };

  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">
        Verifying your link...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md text-center animate-slide-up border-t-4 border-danger">
          <AlertTriangle size={48} className="mx-auto text-danger mb-4" />
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-widest text-danger mb-4">
            Link Expired
          </h2>
          
          {!requestSent ? (
            <>
              <p className="text-sm text-gray-600 font-roboto mb-6 leading-relaxed">
                Invite links expire for security. Enter your email below and we&apos;ll send you a fresh one.
              </p>
              
              <form onSubmit={handleRequestNewLink} noValidate className="space-y-4 text-left">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    inputMode="email"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none"
                  />
                </div>
                <PrimaryButton disabled={isRequesting}>
                  {isRequesting ? "Sending..." : "Request new link"}
                </PrimaryButton>
              </form>
              
              <button 
                type="button" 
                onClick={() => window.location.href = "/"} 
                className="w-full text-center text-xs text-gray-500 mt-6 hover:text-navy underline"
              >
                Return to Login
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 font-roboto mb-8 leading-relaxed">
                If we find an account for <strong>{requestEmail}</strong>, a fresh invite link is on its way. Check your inbox (and spam folder).
              </p>
              <PrimaryButton onClick={() => window.location.href = "/"}>
                Return to Login
              </PrimaryButton>
            </>
          )}
          
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
      <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up border-t-4 border-navy">
        
        <div className="text-center mb-8">
          <h2 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy">
            {flowType === 'recovery' ? 'Reset Password' : 'Complete Setup'}
          </h2>
          <p className="text-sm text-gray-500 font-roboto mt-2">
            {flowType === 'recovery'
              ? 'Enter a new password to get back into your account.'
              : 'Set your name, initials, and a password to finish creating your account.'}
          </p>
        </div>

        <form onSubmit={handleUpdate} noValidate className="space-y-4">

          {flowType === 'invite' && (
            <>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
              Full Name
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-gray-300 rounded p-3 text-sm bg-white outline-none focus:border-navy mt-1"
              placeholder="e.g. Jane Smith"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
              Your Initials
            </label>
            <input
              type="text"
              required
              maxLength={3}
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase())}
              className="w-full border border-gray-300 rounded p-3 text-sm bg-white outline-none focus:border-navy mt-1 uppercase"
              placeholder="e.g. ABC"
            />
          </div>
            </>
          )}

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
              New Password
            </label>
            <div className="relative mt-1">
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                minLength={6} 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm bg-white outline-none focus:border-navy pr-10" 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Must be at least 6 characters.</p>
          </div>

          <div className="pt-4">
            <PrimaryButton disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : flowType === 'recovery'
                  ? "Save new password"
                  : "Save and enter Skyward"}
            </PrimaryButton>
          </div>

        </form>
      </div>
    </div>
  );
}