"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ToastProvider";
import { Eye, EyeOff } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

export default function AuthScreen() {
  const { showSuccess, showError } = useToast();
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setIsSubmitting(false);
    if (error) {
      // Supabase returns a single opaque "Invalid login credentials"
      // for both wrong email and wrong password. Give the pilot a
      // path forward instead of just echoing the library message.
      const friendly = /invalid\s+login/i.test(error.message)
        ? "Email or password is wrong. If you're sure your email is right, use \u201cForgot Password\u201d below."
        : error.message;
      showError(friendly);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const targetEmail = authEmail;
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/update-password`
    });
    setIsSubmitting(false);
    if (error) showError(error.message);
    else {
      // Keep the confirmation on-screen instead of flashing a toast —
      // pilots have reported not knowing whether to go check email
      // right away or wait for more UI.
      setResetSentTo(targetEmail);
      showSuccess("Check your email for the reset link.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
      <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Skyward Society" className="mx-auto h-32 object-contain mb-4" />
          <h2 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy">
            Skyward Aircraft Manager
          </h2>
        </div>
        
        {!showForgotPassword ? (
          <form onSubmit={handleLogin} className="space-y-4 animate-fade-in">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
              <div className="relative mt-1">
                <input type={showPassword ? "text" : "password"} required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm bg-white focus:border-navy outline-none pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy transition-colors">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="pt-4">
              <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Logging in..." : "Log in"}</PrimaryButton>
            </div>
            <button type="button" onClick={() => setShowForgotPassword(true)} className="w-full text-center text-xs text-gray-500 mt-4 hover:text-navy underline">
              Forgot Password?
            </button>
          </form>
        ) : resetSentTo ? (
          <div className="space-y-4 animate-fade-in text-center">
            <div className="bg-green-50 border border-green-200 rounded-md p-4">
              <p className="text-sm text-navy font-bold mb-1">Reset link sent</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Check <span className="font-bold">{resetSentTo}</span> for the link to set a new password. If it&apos;s not in your inbox within a minute, check your spam folder.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setResetSentTo(null); setShowForgotPassword(false); }}
              className="w-full text-center text-xs text-gray-500 hover:text-navy underline"
            >
              Back to Login
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgotPassword} className="space-y-4 animate-fade-in">
            <p className="text-xs text-gray-500 text-center mb-4">Enter your email and we&apos;ll send a link to set a new password.</p>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none" />
            </div>
            <div className="pt-4">
              <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Reset Link"}</PrimaryButton>
            </div>
            <button type="button" onClick={() => setShowForgotPassword(false)} className="w-full text-center text-xs text-gray-500 mt-4 hover:text-navy underline">
              Back to Login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
