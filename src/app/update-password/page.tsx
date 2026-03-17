"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/AppButtons";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const[isSubmitting, setIsSubmitting] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Supabase securely updates the password using the token from the email link
    const { error } = await supabase.auth.updateUser({ password });
    
    if (error) {
      alert("Error updating password: " + error.message);
      setIsSubmitting(false);
    } else {
      window.location.href = "/"; // Send them to the app!
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full">
      <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up">
        <div className="text-center mb-8">
          <h2 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy">Set New Password</h2>
          <p className="text-xs text-gray-500 mt-2">Enter a secure password to access your account.</p>
        </div>
        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">New Password</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white outline-none focus:border-[#F08B46]" />
          </div>
          <div className="pt-4">
            <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Password & Login"}</PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}