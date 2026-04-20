"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/components/ToastProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { NOTIFICATION_TYPES, FAA_RATINGS } from "@/lib/types";
import type { NotificationType } from "@/lib/types";
import { friendlyPgError } from "@/lib/pgErrors";
import { Settings, Bell, Trash2, Key, X, Loader2, AlertTriangle, User, Check, Award, BookOpen } from "lucide-react";

export default function SettingsModal({ 
  show, onClose, session 
}: { 
  show: boolean, onClose: () => void, session: any
}) {
  useModalScrollLock(show);
  const { showError, showSuccess } = useToast();
  const [prefs, setPrefs] = useState<Record<NotificationType, boolean>>({} as any);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);

  // Profile (full name / initials)
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("");
  const [originalFullName, setOriginalFullName] = useState("");
  const [originalInitials, setOriginalInitials] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Pilot FAA ratings — feeds Howard's context to tailor tone/detail
  const [ratings, setRatings] = useState<Set<string>>(new Set());
  const [savingRating, setSavingRating] = useState<string | null>(null);

  // Delete account
  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<any>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Password reset
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [passwordResetSent, setPasswordResetSent] = useState(false);

  useEffect(() => {
    if (show && session) {
      loadPreferences();
      checkPrimaryContactStatus();
      loadProfile();
    }
    // Reset the danger-zone on close so reopening doesn't keep "DELETE"
    // staged in the confirm field — one accidental click away from a
    // destructive submit otherwise.
    if (!show) {
      setShowDeleteSection(false);
      setDeleteConfirmText("");
      setDeleteImpact(null);
    }
  }, [show, session]);

  const loadProfile = async () => {
    setIsLoadingProfile(true);
    const { data } = await supabase
      .from('aft_user_roles')
      .select('full_name, initials, faa_ratings')
      .eq('user_id', session.user.id)
      .maybeSingle();
    const name = data?.full_name || "";
    const inits = data?.initials || "";
    setFullName(name);
    setInitials(inits);
    setOriginalFullName(name);
    setOriginalInitials(inits);
    setRatings(new Set((data?.faa_ratings as string[] | null) || []));
    setIsLoadingProfile(false);
  };

  const toggleRating = async (code: string) => {
    const next = new Set(ratings);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setRatings(next);
    setSavingRating(code);
    const { error } = await supabase
      .from('aft_user_roles')
      .update({ faa_ratings: Array.from(next) })
      .eq('user_id', session.user.id);
    if (error) {
      showError("Couldn't save rating: " + friendlyPgError(error));
      // Revert on failure
      setRatings(ratings);
    }
    setSavingRating(null);
  };

  const handleSaveProfile = async () => {
    const trimmedName = fullName.trim();
    const trimmedInitials = initials.trim().toUpperCase();
    if (!trimmedName) return showError("Full name is required.");
    if (!trimmedInitials) return showError("Initials are required.");
    setIsSavingProfile(true);
    const { error } = await supabase
      .from('aft_user_roles')
      .update({ full_name: trimmedName, initials: trimmedInitials })
      .eq('user_id', session.user.id);
    if (error) {
      showError("Couldn't save profile: " + friendlyPgError(error));
    } else {
      setFullName(trimmedName);
      setInitials(trimmedInitials);
      setOriginalFullName(trimmedName);
      setOriginalInitials(trimmedInitials);
      showSuccess("Profile updated");
    }
    setIsSavingProfile(false);
  };

  const loadPreferences = async () => {
    setIsLoadingPrefs(true);
    const { data } = await supabase
      .from('aft_notification_preferences')
      .select('notification_type, enabled')
      .eq('user_id', session.user.id);

    const prefMap: Record<string, boolean> = {};
    for (const t of NOTIFICATION_TYPES) {
      prefMap[t.type] = true;
    }
    if (data) {
      for (const row of data) {
        prefMap[row.notification_type] = row.enabled;
      }
    }
    setPrefs(prefMap as Record<NotificationType, boolean>);
    setIsLoadingPrefs(false);
  };

  /** Check if the current user is the primary contact (main_contact_email) on any aircraft */
  const checkPrimaryContactStatus = async () => {
    const userEmail = session.user.email?.toLowerCase();
    if (!userEmail) return;

    // Get all aircraft the user has access to
    const { data: accessData } = await supabase
      .from('aft_user_aircraft_access')
      .select('aircraft_id')
      .eq('user_id', session.user.id);

    if (!accessData || accessData.length === 0) {
      setIsPrimaryContact(false);
      return;
    }

    const aircraftIds = accessData.map(a => a.aircraft_id);
    const { data: aircraftData } = await supabase
      .from('aft_aircraft')
      .select('main_contact_email')
      .in('id', aircraftIds);

    if (aircraftData) {
      const isPC = aircraftData.some(
        ac => ac.main_contact_email && ac.main_contact_email.toLowerCase() === userEmail
      );
      setIsPrimaryContact(isPC);
    }
  };

  const togglePref = async (type: NotificationType) => {
    const newValue = !prefs[type];
    setPrefs(prev => ({ ...prev, [type]: newValue }));
    setSavingPref(type);

    await supabase.from('aft_notification_preferences').upsert({
      user_id: session.user.id,
      notification_type: type,
      enabled: newValue,
    }, { onConflict: 'user_id,notification_type' });

    setSavingPref(null);
  };

  const handlePasswordReset = async () => {
    setIsResettingPassword(true);
    const { error } = await supabase.auth.resetPasswordForEmail(session.user.email, {
      redirectTo: `${window.location.origin}/update-password`
    });
    if (error) showError(error.message);
    else setPasswordResetSent(true);
    setIsResettingPassword(false);
  };

  const loadDeleteImpact = async () => {
    setIsLoadingImpact(true);
    setShowDeleteSection(true);
    try {
      const res = await authFetch('/api/account/delete');
      const data = await res.json();
      setDeleteImpact(data);
    } catch (err) {
      console.error(err);
    }
    setIsLoadingImpact(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    try {
      const res = await authFetch('/api/account/delete', {
        method: 'DELETE',
        body: JSON.stringify({ confirmDelete: true })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Couldn't delete the account");
      }
      await supabase.auth.signOut();
    } catch (err: any) {
      showError(err.message);
      setIsDeleting(false);
    }
  };

  if (!show) return null;

  // Filter notification types: show primary-contact-only toggles only if user IS a primary contact
  const visibleNotifications = NOTIFICATION_TYPES.filter(nt => {
    if (nt.primaryContactOnly && !isPrimaryContact) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-white rounded shadow-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
        
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Settings size={20} className="text-gray-500" /> Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-[#CE3732]"><X size={24} /></button>
        </div>

        <div className="p-6 space-y-8">

          {/* ─── PROFILE ─── */}
          <div>
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-1 flex items-center gap-2">
              <User size={18} className="text-navy" /> Profile
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-4">Your name and initials as shown to the other pilots</p>

            {isLoadingProfile ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="text-gray-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Full Name</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. Jane Smith"
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Initials</label>
                  <input
                    type="text"
                    maxLength={3}
                    value={initials}
                    onChange={e => setInitials(e.target.value.toUpperCase())}
                    placeholder="e.g. JS"
                    className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none uppercase"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={
                    isSavingProfile ||
                    (fullName.trim() === originalFullName && initials.trim().toUpperCase() === originalInitials)
                  }
                  className="text-sm font-bold text-navy hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-2"
                >
                  {isSavingProfile
                    ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
                    : <><Check size={14} /> Save Profile</>}
                </button>
              </div>
            )}
          </div>

          {/* ─── PILOT RATINGS ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-1 flex items-center gap-2">
              <Award size={18} className="text-mxOrange" /> Pilot Ratings
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-4">
              Howard uses these to tailor briefings and tone — pick everything you hold
            </p>

            {isLoadingProfile ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="text-gray-400 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {FAA_RATINGS.map(r => {
                  const checked = ratings.has(r.code);
                  const saving = savingRating === r.code;
                  return (
                    <label key={r.code} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRating(r.code)}
                        disabled={saving}
                        className="w-4 h-4 rounded border-gray-300 text-mxOrange focus:ring-mxOrange cursor-pointer shrink-0"
                      />
                      <span className="text-xs text-navy group-hover:text-mxOrange transition-colors leading-tight">
                        {r.label}
                      </span>
                      {saving && <Loader2 size={10} className="text-gray-400 animate-spin" />}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── NOTIFICATION PREFERENCES ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-1 flex items-center gap-2">
              <Bell size={18} className="text-[#3AB0FF]" /> Notifications
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-4">Choose which email notifications you receive</p>

            {isLoadingPrefs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="text-gray-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                {visibleNotifications.map(nt => (
                  <label key={nt.type} className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative mt-0.5">
                      <input 
                        type="checkbox" 
                        checked={prefs[nt.type] !== false} 
                        onChange={() => togglePref(nt.type)} 
                        className="w-5 h-5 rounded border-gray-300 text-[#3AB0FF] focus:ring-[#3AB0FF] cursor-pointer" 
                      />
                      {savingPref === nt.type && (
                        <Loader2 size={12} className="absolute -right-5 top-1 text-gray-400 animate-spin" />
                      )}
                    </div>
                    <div>
                      <span className="text-sm font-bold text-navy block group-hover:text-[#3AB0FF] transition-colors">{nt.label}</span>
                      <span className="text-[10px] text-gray-500 leading-tight">{nt.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ─── PASSWORD RESET ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-1 flex items-center gap-2">
              <Key size={18} className="text-mxOrange" /> Password
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-4">Reset your account password via email</p>

            {passwordResetSent ? (
              <p className="text-sm text-[#56B94A] font-bold">Password reset link sent to {session.user.email}</p>
            ) : (
              <button 
                onClick={handlePasswordReset} 
                disabled={isResettingPassword}
                className="text-sm font-bold text-mxOrange hover:underline disabled:opacity-50 flex items-center gap-2"
              >
                {isResettingPassword ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : 'Send Password Reset Email'}
              </button>
            )}
          </div>

          {/* ─── ACCOUNT INFO ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-3">Account</h3>
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Email</p>
              <p className="text-sm text-navy font-bold">{session.user.email}</p>
            </div>
          </div>

          {/* ─── FEATURES GUIDE ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-3">Help & Reference</h3>
            <button
              onClick={() => {
                // Close Settings so the full-screen guide gets focus,
                // then dispatch the global open event. Small delay lets
                // the scroll lock cleanup run before the next lock.
                onClose();
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('aft:open-features-guide'));
                }, 50);
              }}
              className="w-full flex items-center justify-between gap-3 bg-brandOrange/5 hover:bg-brandOrange/10 border border-brandOrange/30 rounded-lg px-4 py-3 active:scale-[0.98] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 text-left">
                <div className="w-9 h-9 rounded-full bg-brandOrange text-white flex items-center justify-center shrink-0">
                  <BookOpen size={16} />
                </div>
                <div className="min-w-0">
                  <p className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">
                    Features Guide
                  </p>
                  <p className="text-[11px] font-roboto text-gray-500 leading-snug">
                    What every part of the app does — organized by task.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange shrink-0">Open</span>
            </button>
          </div>

          {/* ─── DELETE ACCOUNT ─── */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="font-oswald text-lg font-bold uppercase text-[#CE3732] mb-1 flex items-center gap-2">
              <Trash2 size={18} /> Danger Zone
            </h3>

            {!showDeleteSection ? (
              <button onClick={loadDeleteImpact} className="text-sm font-bold text-[#CE3732] hover:underline mt-2">
                Delete my account...
              </button>
            ) : (
              <div className="mt-4 bg-red-50 border border-red-200 rounded p-4 animate-fade-in">
                {isLoadingImpact ? (
                  <div className="flex items-center justify-center py-4"><Loader2 size={24} className="text-[#CE3732] animate-spin" /></div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 mb-4">
                      <AlertTriangle size={18} className="text-[#CE3732] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-navy">Once your account is deleted, it&apos;s gone — no undo.</p>
                        <p className="text-xs text-gray-600 mt-2">Deleting your account will:</p>
                        <ul className="text-xs text-gray-600 mt-1 space-y-1 ml-4 list-disc">
                          <li>Remove your profile and all preferences</li>
                          <li>Cancel all your future reservations</li>
                          {deleteImpact?.ownedAircraft?.length > 0 && (
                            <li className="text-[#CE3732] font-bold">
                              Permanently delete {deleteImpact.ownedAircraft.length} aircraft you created: {deleteImpact.ownedAircraft.map((a: any) => a.tail_number).join(', ')} — including all their flight logs, maintenance records, squawks, notes, and service events
                            </li>
                          )}
                          {deleteImpact?.affectedUserCount > 0 && (
                            <li className="text-[#CE3732] font-bold">
                              {deleteImpact.affectedUserCount} other user{deleteImpact.affectedUserCount > 1 ? 's' : ''} will lose access to those aircraft
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] block mb-1">Type DELETE to confirm</label>
                      <input 
                        type="text" 
                        value={deleteConfirmText} 
                        onChange={e => setDeleteConfirmText(e.target.value)} 
                        className="w-full border border-red-300 rounded p-3 text-sm focus:border-[#CE3732] outline-none bg-white" 
                        placeholder="DELETE"
                      />
                    </div>

                    <div className="flex gap-3 mt-4">
                      <button onClick={() => { setShowDeleteSection(false); setDeleteConfirmText(""); }} className="flex-1 border border-gray-300 text-gray-600 font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95">
                        Cancel
                      </button>
                      <button 
                        onClick={handleDeleteAccount} 
                        disabled={deleteConfirmText !== 'DELETE' || isDeleting} 
                        className="flex-1 bg-[#CE3732] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded text-xs active:scale-95 disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete My Account'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
      </div>
    </div>
  );
}
