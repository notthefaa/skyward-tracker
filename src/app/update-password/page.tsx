"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/AppButtons";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // NEW: Security Verification State
  const [session, setSession] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(true);

  // Automatically parse the secure link and wait for the session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsVerifying(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsVerifying(false);
    });

    return () => subscription.unsubscribe();
  },[]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Safety check just in case
    if (!session) {
      alert("Security session lost. Please close this window and click your invite link again.");
      setIsSubmitting(false);
      return;
    }
    
    // 1. Save the new password via Supabase Auth
    const { error: pwdError } = await supabase.auth.updateUser({ password });
    
    if (pwdError) {
      alert("Error updating password: " + pwdError.message);
      setIsSubmitting(false);
      return;
    }

    // 2. Save their initials and email to their database profile
    await supabase.from('aft_user_roles').update({ 
      initials: initials.toUpperCase(),
      email: session.user.email
    }).eq('user_id', session.user.id);

    // 3. Send them to the main dashboard!
    window.location.href = "/";
  };

  // 1. Show a loading screen while processing the email link
  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full text-white font-oswald text-2xl tracking-widest uppercase animate-pulse">
        Verifying Secure Link...
      </div>
    );
  }

  // 2. If the link is expired, already used, or invalid, show a friendly error
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md text-center animate-slide-up border-t-4 border-[#CE3732]">
          <AlertTriangle size={48} className="mx-auto text-[#CE3732] mb-4" />
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-widest text-[#CE3732] mb-4">
            Link Expired
          </h2>
          <p className="text-sm text-gray-600 font-roboto mb-8 leading-relaxed">
            This setup link is invalid or has already been used. Please ask your administrator to resend the invite.
          </p>
          <PrimaryButton onClick={() => window.location.href = "/"}>
            Return to Login
          </PrimaryButton>
        </div>
      </div>
    );
  }

  // 3. If everything is secure, show the setup form!
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
      <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up border-t-4 border-navy">
        
        <div className="text-center mb-8">
          <h2 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy">
            Complete Setup
          </h2>
          <p className="text-sm text-gray-500 font-roboto mt-2">
            Enter your initials and a secure password to access your account.
          </p>
        </div>
        
        <form onSubmit={handleUpdate} className="space-y-4">
          
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
              {isSubmitting ? "Saving..." : "Save & Enter Portal"}
            </PrimaryButton>
          </div>

        </form>
      </div>
    </div>
  );
}