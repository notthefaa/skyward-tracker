"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics, SystemSettings, AppTab } from "@/lib/types";
import { ShieldCheck, Settings, MailOpen, Database, Sliders, Globe, Users, PlaneTakeoff, X, ChevronRight } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

const whiteBg = { backgroundColor: '#ffffff' } as const;

interface AdminModalsProps {
  showAdminMenu: boolean;
  setShowAdminMenu: (val: boolean) => void;
  allAircraftList: AircraftWithMetrics[];
  setActiveTail: (tail: string) => void;
  setActiveTab: (tab: AppTab) => void;
  sysSettings: SystemSettings;
  setSysSettings: (val: SystemSettings) => void;
  refreshData: () => void;
}

export default function AdminModals({ 
  showAdminMenu, setShowAdminMenu, allAircraftList, setActiveTail, 
  setActiveTab, sysSettings, setSysSettings, refreshData 
}: AdminModalsProps) {
  
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showGlobalFleetModal, setShowGlobalFleetModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);

  const [globalFleetSearch, setGlobalFleetSearch] = useState("");
  const [emailPreviewType, setEmailPreviewType] = useState<'squawk_mx' | 'squawk_internal' | 'mx_schedule' | 'mx_reminder'>('squawk_mx');
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin'|'pilot'>('pilot');
  const [inviteAircraftIds, setInviteAircraftIds] = useState<string[]>([]);

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string>("");
  const [userAccessList, setUserAccessList] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!showAdminMenu && !showGlobalFleetModal && !showToolsMenu && !showSettingsModal && !showEmailPreview && !showAccessModal && !showInviteModal) return null;

  const handleDatabaseCleanup = async () => {
    if (!confirm("Run Health Check?\n\nThis will safely purge old read-receipts (older than 30 days) to keep the database fast and optimized.")) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/admin/db-health', { method: 'POST' });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || 'Cleanup failed'); }
      const data = await res.json();
      alert(`Database health check completed!\n\nOrphaned images cleaned:\n- Squawk images: ${data.cleaned?.squawk_images || 0}\n- Note images: ${data.cleaned?.note_images || 0}\n- Avatars: ${data.cleaned?.avatars || 0}`);
    } catch (e: any) { alert("Cleanup failed: " + e.message); }
    setIsSubmitting(false);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    await supabase.from('aft_system_settings').upsert({ id: 1, ...sysSettings });
    setIsSubmitting(false); setShowSettingsModal(false); setSysSettings({ ...sysSettings });
    alert("Global maintenance triggers updated!");
  };

  const openAccessModal = async () => {
    setIsSubmitting(true);
    const { data } = await supabase.from('aft_user_roles').select('*').order('role').order('email');
    if (data) setAllUsers(data); setSelectedAccessUserId(""); setUserAccessList([]);
    setShowAccessModal(true); setIsSubmitting(false);
  };

  const fetchUserAccess = async (userId: string) => {
    setSelectedAccessUserId(userId);
    const { data } = await supabase.from('aft_user_aircraft_access').select('aircraft_id').eq('user_id', userId);
    if (data) setUserAccessList(data.map(d => d.aircraft_id)); else setUserAccessList([]);
  };

  const toggleAccess = async (aircraftId: string, hasAccess: boolean) => {
    if (!selectedAccessUserId) return;
    if (hasAccess) { setUserAccessList(prev => prev.filter(id => id !== aircraftId)); await supabase.from('aft_user_aircraft_access').delete().match({ user_id: selectedAccessUserId, aircraft_id: aircraftId }); }
    else { setUserAccessList(prev => [...prev, aircraftId]); await supabase.from('aft_user_aircraft_access').insert({ user_id: selectedAccessUserId, aircraft_id: aircraftId }); }
  };

  const toggleInviteAircraft = (id: string) => { setInviteAircraftIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]); };

  const handleAdminResetPassword = async () => {
    const selectedUserEmail = allUsers.find(u => u.user_id === selectedAccessUserId)?.email;
    if (!selectedUserEmail) return;
    if (!confirm(`Are you sure you want to send a password reset email to ${selectedUserEmail}?`)) return;
    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(selectedUserEmail, { redirectTo: `${window.location.origin}/update-password` });
    setIsSubmitting(false);
    if (error) alert("Error: " + error.message); else alert("Password reset link sent securely to " + selectedUserEmail);
  };

  const handleDeleteUser = async () => {
    const selectedUserEmail = allUsers.find(u => u.user_id === selectedAccessUserId)?.email;
    if (!selectedUserEmail) return;
    if (!confirm(`CRITICAL WARNING: Are you absolutely sure you want to permanently delete ${selectedUserEmail} and revoke all their access?`)) return;
    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/users', { method: 'DELETE', body: JSON.stringify({ userId: selectedAccessUserId }) });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || 'Failed to delete user'); }
      alert("User successfully deleted.");
      const { data } = await supabase.from('aft_user_roles').select('*').order('role').order('email');
      if (data) setAllUsers(data); setSelectedAccessUserId(""); setUserAccessList([]);
    } catch (error: any) { alert("Failed to delete user: " + error.message); }
    setIsSubmitting(false);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    try {
      const res = await authFetch('/api/invite', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole, aircraftIds: inviteAircraftIds }) });
      if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || 'Failed to invite user'); }
      alert(`Invitation successfully sent to ${inviteEmail}!`);
      setShowInviteModal(false); setInviteEmail(""); setInviteAircraftIds([]);
    } catch (error: any) { alert("Failed to invite user: " + error.message); }
    setIsSubmitting(false);
  };

  const getEmailPreviewHtml = () => {
    const baseStyle = `font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-width: 600px;`;
    const contactInfo = `<strong>John Doe</strong><br/>(555) 123-4567<br/><a href="#" style="color: #333333;">john@doe.com</a>`;
    if (emailPreviewType === 'squawk_mx') return `<div style="${baseStyle}"><p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p><p>A new squawk has been reported for N12345. Please let us know when you are able to accommodate this aircraft in your schedule to address the issue.</p><p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Status: AOG / GROUNDED<br/>Description: Left Main tire showing cords.</p><p style="margin-top: 20px;">You can view the full report and attached photos securely here:<br/><a href="#">https://your-app.com/squawk/12345</a></p><p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p></div>`;
    if (emailPreviewType === 'squawk_internal') return `<div style="${baseStyle}"><p>A new squawk was reported on N12345 by ABC.</p><p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Grounded: YES<br/>Description: Left Main tire showing cords.</p><p style="margin-top: 20px;">Please log in to the fleet portal to view full details and any attached photos.</p></div>`;
    if (emailPreviewType === 'mx_schedule') return `<div style="${baseStyle}"><p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p><p>The following maintenance item is coming due for N12345. Please let us know when you are able to add this aircraft to your schedule.</p><p style="margin-top: 20px;"><strong>Maintenance Details:</strong><br/>Item: 100 Hour Inspection<br/>Due: at 1500.5 hours</p><p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p></div>`;
    if (emailPreviewType === 'mx_reminder') return `<div style="${baseStyle}"><p>This is an automated reminder that required maintenance is coming due for N12345.</p><p style="margin-top: 20px;"><strong>Item:</strong> 100 Hour Inspection<br/><strong>Status:</strong> DUE IN 15 HOURS</p><p style="margin-top: 20px;">Log in to the fleet portal to manage maintenance scheduling.</p></div>`;
    return "";
  };

  return (
    <>
      {showAdminMenu && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowAdminMenu(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><ShieldCheck size={20}/> Admin Center</h2><button onClick={() => setShowAdminMenu(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <div className="space-y-3">
              <button onClick={() => { setShowAdminMenu(false); setShowGlobalFleetModal(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Globe size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Global Fleet</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">View all aircraft in system</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); setShowInviteModal(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Users size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Invite User</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Invite pilots & reset passwords</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); openAccessModal(); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><PlaneTakeoff size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">Aircraft Access</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Assign planes to pilots & admins</span></div></button>
              <button onClick={() => { setShowAdminMenu(false); setShowToolsMenu(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95"><Settings size={18} className="text-navy" /><div><span className="block font-bold text-navy text-sm uppercase">System Tools</span><span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Database health & triggers</span></div></button>
            </div>
          </div>
        </div>
      )}

      {showGlobalFleetModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => { setShowGlobalFleetModal(false); setGlobalFleetSearch(""); }}>
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6 shrink-0"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Globe size={20} className="text-navy"/> Global Fleet</h2><button onClick={() => { setShowGlobalFleetModal(false); setGlobalFleetSearch(""); }} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <div className="mb-4 shrink-0"><input type="text" placeholder="Search Tail Number..." value={globalFleetSearch} onChange={(e) => setGlobalFleetSearch(e.target.value.toUpperCase())} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-navy outline-none uppercase font-bold" /></div>
            <div className="overflow-y-auto space-y-2 pr-2 flex-1">
              {allAircraftList.filter(ac => ac.tail_number.includes(globalFleetSearch)).length === 0 ? (
                <p className="text-center text-sm text-gray-400 italic py-4">No aircraft found.</p>
              ) : (
                allAircraftList.filter(ac => ac.tail_number.includes(globalFleetSearch)).map(ac => (
                  <button key={ac.id} onClick={() => { setActiveTail(ac.tail_number); setActiveTab('summary'); setShowGlobalFleetModal(false); setGlobalFleetSearch(""); }} className="w-full bg-gray-50 border border-gray-200 p-3 rounded text-left flex justify-between items-center hover:border-navy hover:bg-blue-50 transition-colors active:scale-95">
                    <div><span className="font-oswald text-lg font-bold text-navy uppercase block leading-none">{ac.tail_number}</span><span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1 block">{ac.aircraft_type}</span></div>
                    <ChevronRight size={18} className="text-gray-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showToolsMenu && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowToolsMenu(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F08B46] animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Settings size={20}/> System Tools</h2><button onClick={() => setShowToolsMenu(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <div className="space-y-4">
              <button onClick={() => { setShowToolsMenu(false); setShowEmailPreview(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><MailOpen size={16} /> Preview Automated Emails</button>
              <button onClick={() => { setShowToolsMenu(false); setShowSettingsModal(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest"><Sliders size={16} /> Maintenance Triggers</button>
              <div className="border-t border-gray-200 pt-4"><p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3 text-center">Database Maintenance</p><button onClick={handleDatabaseCleanup} disabled={isSubmitting} className="w-full bg-[#CE3732] text-white font-bold py-3 px-4 rounded hover:bg-red-700 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest shadow-md"><Database size={16} /> {isSubmitting ? 'Running...' : 'Run Health & Cleanup Check'}</button></div>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 z-[10001] flex items-center justify-center p-3 animate-fade-in" onClick={() => setShowSettingsModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-5 border-t-4 border-navy animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><Sliders size={20}/> Maintenance Triggers</h2><button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1">Internal Alerts - Date Based (Days)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 1</label><input type="number" value={sysSettings.reminder_1 || 30} onChange={e=>setSysSettings({...sysSettings, reminder_1: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 2</label><input type="number" value={sysSettings.reminder_2 || 15} onChange={e=>setSysSettings({...sysSettings, reminder_2: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 3</label><input type="number" value={sysSettings.reminder_3 || 5} onChange={e=>setSysSettings({...sysSettings, reminder_3: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Internal Alerts - Time Based (Hours)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 1</label><input type="number" value={sysSettings.reminder_hours_1 || 30} onChange={e=>setSysSettings({...sysSettings, reminder_hours_1: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 2</label><input type="number" value={sysSettings.reminder_hours_2 || 15} onChange={e=>setSysSettings({...sysSettings, reminder_hours_2: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Alert 3</label><input type="number" value={sysSettings.reminder_hours_3 || 5} onChange={e=>setSysSettings({...sysSettings, reminder_hours_3: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Mechanic Scheduling Requests (To MX)</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-navy">Hard Hour Limit</label><input type="number" value={sysSettings.sched_time || 10} onChange={e=>setSysSettings({...sysSettings, sched_time: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
                <div><label className="text-[10px] font-bold uppercase text-navy">Hard Date Limit</label><input type="number" value={sysSettings.sched_days || 30} onChange={e=>setSysSettings({...sysSettings, sched_days: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" /></div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-navy">Predictive Time Scheduling (Days Out)</label>
                <input type="number" value={sysSettings.predictive_sched_days || 45} onChange={e=>setSysSettings({...sysSettings, predictive_sched_days: parseInt(e.target.value)})} style={whiteBg} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                <p className="text-[10px] text-gray-400 mt-2 leading-tight">If an hour-based item is projected to hit its limit within this timeframe, the scheduling email will dispatch based on the flight history Confidence Score.</p>
              </div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Globally"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}

      {showEmailPreview && (
        <div className="fixed inset-0 bg-black/60 z-[10001] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowEmailPreview(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-navy animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4"><h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2"><MailOpen size={20}/> Email Previewer</h2><button onClick={() => setShowEmailPreview(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Template to Preview</label>
              <select value={emailPreviewType} onChange={e=>setEmailPreviewType(e.target.value as any)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 outline-none focus:border-navy">
                <option value="squawk_mx">Squawk Alert (To MX)</option><option value="squawk_internal">Squawk Alert (Internal)</option><option value="mx_schedule">MX Schedule Request</option><option value="mx_reminder">MX Due Reminder</option>
              </select>
            </div>
            <div className="border border-gray-300 rounded overflow-hidden shadow-inner bg-gray-50">
              <div className="bg-gray-200 px-3 py-1.5 border-b border-gray-300 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Rendered Inbox View</div>
              <div className="p-4 bg-white" dangerouslySetInnerHTML={{ __html: getEmailPreviewHtml() }} />
            </div>
          </div>
        </div>
      )}

      {showAccessModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowAccessModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><ShieldCheck size={20}/> Assign Aircraft</h2><button onClick={() => setShowAccessModal(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Pilot</label>
                <select className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-navy outline-none" style={whiteBg} value={selectedAccessUserId} onChange={(e) => fetchUserAccess(e.target.value)}>
                  <option value="">-- Choose a Pilot --</option>
                  {allUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.email || u.user_id} ({u.role})</option>)}
                </select>
              </div>
              {selectedAccessUserId && (
                <>
                  <div className="border border-gray-200 rounded p-4 bg-gray-50">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Allowed Aircraft</h3>
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                      {allAircraftList.map(ac => {
                        const hasAccess = userAccessList.includes(ac.id);
                        return (
                          <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={hasAccess} onChange={() => toggleAccess(ac.id, hasAccess)} className="w-4 h-4 text-navy border-gray-300 rounded" />
                            <span className="font-bold text-sm text-navy uppercase">{ac.tail_number}</span>
                            <span className="text-[10px] text-gray-500 uppercase">{ac.aircraft_type}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-4 border-t border-gray-200 mt-4">
                    <button type="button" onClick={handleAdminResetPassword} className="flex-1 border border-brandOrange text-brandOrange text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-orange-50 transition-colors">Reset Password</button>
                    <button type="button" onClick={handleDeleteUser} className="flex-1 border border-[#CE3732] text-[#CE3732] text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-red-50 transition-colors">Delete User</button>
                  </div>
                </>
              )}
            </div>
            <div className="pt-6"><PrimaryButton onClick={() => setShowAccessModal(false)}>Done</PrimaryButton></div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowInviteModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6"><h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Users size={20}/> Invite User</h2><button onClick={() => { setShowInviteModal(false); setInviteAircraftIds([]); }} className="text-gray-400 hover:text-red-500"><X size={24}/></button></div>
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label><input type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy" /></div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role</label>
                <select value={inviteRole} onChange={e=>setInviteRole(e.target.value as any)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy">
                  <option value="pilot">Pilot</option><option value="admin">Administrator</option>
                </select>
              </div>
              <div className="border border-gray-200 rounded p-3 bg-gray-50 mt-2 max-h-[30vh] overflow-y-auto">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Assign Aircraft Access</h3>
                <div className="space-y-2">
                  {allAircraftList.map(ac => (
                    <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={inviteAircraftIds.includes(ac.id)} onChange={() => toggleInviteAircraft(ac.id)} className="w-4 h-4 text-navy border-gray-300 rounded" />
                      <span className="font-bold text-xs text-navy uppercase">{ac.tail_number}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Invite Email"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
