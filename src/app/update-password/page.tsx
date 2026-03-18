"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/AppButtons";
import { Eye, EyeOff } from "lucide-react";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // 1. Save the new password via Supabase Auth
    const { error: pwdError } = await supabase.auth.updateUser({ password });
    
    if (pwdError) {
      alert("Error updating password: " + pwdError.message);
      setIsSubmitting(false);
      return;
    }

    // 2. Save their initials and email to their database profile
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.from('aft_user_roles').update({ 
        initials: initials.toUpperCase(),
        email: session.user.email
      }).eq('user_id', session.user.id);
    }

    // 3. Send them to the app!
    window.location.href = "/";
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
      <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up">
        
        <div className="text-center mb-8">
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy">
            Complete Setup
          </h2>
          <p className="text-xs text-gray-500 mt-2">
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
              className="w-full border border-gray-300 rounded p-3 text-sm bg-white outline-none focus:border-[#F08B46] mt-1" 
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
                className="w-full border border-gray-300 rounded p-3 text-sm bg-white outline-none focus:border-[#F08B46] pr-10" 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
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