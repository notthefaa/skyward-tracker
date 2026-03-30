"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { NOTIFICATION_TYPES } from "@/lib/types";
import type { NotificationType } from "@/lib/types";
import { Settings, Bell, Trash2, Key, X, Loader2, AlertTriangle } from "lucide-react";

export default function SettingsModal({ 
  show, onClose, session 
}: { 
  show: boolean, onClose: () => void, session: any 
}) {
  const [prefs, setPrefs] = useState<Record<NotificationType, boolean>>({} as any);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);

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
    }
  }, [show, session]);

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
    if (error) alert("Error: " + error.message);
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
        throw new Error(data.error || 'Failed to delete account');
      }
      await supabase.auth.signOut();
    } catch (err: any) {
      alert(err.message);
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
    <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
        
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Settings size={20} className="text-gray-500" /> Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500"><X size={24} /></button>
        </div>

        <div className="p-6 space-y-8">

          {/* ─── NOTIFICATION PREFERENCES ─── */}
          <div>
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
              <Key size={18} className="text-[#F08B46]" /> Password
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-4">Reset your account password via email</p>

            {passwordResetSent ? (
              <p className="text-sm text-[#56B94A] font-bold">Password reset link sent to {session.user.email}</p>
            ) : (
              <button 
                onClick={handlePasswordReset} 
                disabled={isResettingPassword}
                className="text-sm font-bold text-[#F08B46] hover:underline disabled:opacity-50 flex items-center gap-2"
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
                        <p className="text-sm font-bold text-navy">This action is permanent and cannot be undone.</p>
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
  );
}
