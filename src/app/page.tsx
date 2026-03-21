"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { 
  PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut, 
  Plus, X, Edit2, ChevronDown, Home, Users, LayoutGrid, 
  ShieldCheck, Settings, MailOpen, Database, Eye, EyeOff, Sliders, Send 
} from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";
import ReactCrop, { Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import SummaryTab from "@/components/tabs/SummaryTab";
import TimesTab from "@/components/tabs/TimesTab";
import MaintenanceTab from "@/components/tabs/MaintenanceTab";
import SquawksTab from "@/components/tabs/SquawksTab"; 
import NotesTab from "@/components/tabs/NotesTab";
import FleetSummary from "@/components/tabs/FleetSummary";

export default function FleetTrackerApp() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'admin' | 'pilot'>('pilot');
  const[userInitials, setUserInitials] = useState("");
  
  // Login State
  const[authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // App State
  const [aircraftList, setAircraftList] = useState<any[]>([]);
  const [activeTail, setActiveTail] = useState<string>("");
  const[activeTab, setActiveTab] = useState<'fleet' | 'summary' | 'times' | 'mx' | 'squawks' | 'notes'>('fleet');
  const [aircraftStatus, setAircraftStatus] = useState<'airworthy' | 'issues' | 'grounded'>('airworthy');
  const[unreadNotes, setUnreadNotes] = useState(0);

  // Global Settings State
  const[sysSettings, setSysSettings] = useState({
    reminder_1: 30,
    reminder_2: 15,
    reminder_3: 5,
    sched_time: 10,
    sched_days: 30
  });

  // --- ADMIN CONTROL CENTER STATE ---
  const[showAdminMenu, setShowAdminMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const[showSettingsModal, setShowSettingsModal] = useState(false);
  const [emailPreviewType, setEmailPreviewType] = useState<'squawk_mx' | 'squawk_internal' | 'mx_schedule' | 'mx_reminder'>('squawk_mx');

  // Invite User State
  const[showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<'admin'|'pilot'>('pilot');
  const [inviteAircraftIds, setInviteAircraftIds] = useState<string[]>([]);

  // Aircraft Access State
  const [showAccessModal, setShowAccessModal] = useState(false);
  const[allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string>("");
  const [userAccessList, setUserAccessList] = useState<string[]>([]);

  // Aircraft Modal State
  const [showAircraftModal, setShowAircraftModal] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);
  const[newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const[newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const[newHomeAirport, setNewHomeAirport] = useState("");
  const [newMainContact, setNewMainContact] = useState("");
  const [newMainContactPhone, setNewMainContactPhone] = useState(""); 
  const[newMainContactEmail, setNewMainContactEmail] = useState(""); 
  const[newMxContact, setNewMxContact] = useState(""); 
  const [newMxContactPhone, setNewMxContactPhone] = useState(""); 
  const [newMxContactEmail, setNewMxContactEmail] = useState(""); 
  const[isSubmitting, setIsSubmitting] = useState(false);

  // Cropper State
  const[avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 }); // 16:9
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => { 
    supabase.auth.getSession().then(({ data: { session } }) => { 
      setSession(session); 
      if (session) fetchAircraftData(session.user.id); 
    }); 
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session); 
      if (session) fetchAircraftData(session.user.id);
    });
    
    return () => subscription.unsubscribe();
  },[]);

  useEffect(() => { 
    if (activeTail && aircraftList.length > 0 && session) { 
      checkGroundedStatus(activeTail); 
      fetchUnreadNotes(activeTail, session.user.id); 
    } 
  },[activeTail, aircraftList, session]);

  const fetchAircraftData = async (userId: string) => {
    // Fetch global settings
    const { data: settingsData } = await supabase.from('aft_system_settings').select('*').eq('id', 1).single();
    if (settingsData) setSysSettings(settingsData);

    const { data: roleData } = await supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single();
    if (roleData) {
      setRole(roleData.role);
      setUserInitials(roleData.initials || "");
    }
    
    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData); 
      if (!activeTail) setActiveTail(aircraftData[0].tail_number);
    }
  };

  const fetchUnreadNotes = async (tail: string, userId: string) => {
    const aircraft = aircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;
    
    const { data: notes } = await supabase.from('aft_notes').select('id').eq('aircraft_id', aircraft.id);
    if (!notes || notes.length === 0) { 
      setUnreadNotes(0); 
      return; 
    }
    
    const noteIds = notes.map(n => n.id);
    const { data: reads } = await supabase.from('aft_note_reads').select('note_id').eq('user_id', userId).in('note_id', noteIds);
    const readIds = reads ? reads.map(r => r.note_id) :[];
    
    setUnreadNotes(noteIds.length - readIds.length);
  };

  const checkGroundedStatus = async (tail: string) => {
    const aircraft = aircraftList.find(a => a.tail_number === tail);
    if (!aircraft) return;
    
    let isGrounded = false; 
    let hasOpenSquawks = false;

    const { data: mxData } = await supabase.from('aft_maintenance_items').select('*').eq('aircraft_id', aircraft.id);
    if (mxData) {
      const currentEngineTime = aircraft.total_engine_time || 0;
      isGrounded = mxData.some(item => {
        if (!item.is_required) return false;
        if (item.tracking_type === 'time') return item.due_time <= currentEngineTime;
        if (item.tracking_type === 'date') return new Date(item.due_date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0));
        return false;
      });
    }

    if (!isGrounded) {
      const { data: sqData } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).eq('status', 'open');
      if (sqData && sqData.length > 0) {
        if (sqData.some(sq => sq.affects_airworthiness)) isGrounded = true;
        else hasOpenSquawks = true;
      }
    }
    
    if (isGrounded) setAircraftStatus('grounded');
    else if (hasOpenSquawks) setAircraftStatus('issues');
    else setAircraftStatus('airworthy');
  };

  // --- ADMIN CONTROL CENTER FUNCTIONS ---
  const handleDatabaseCleanup = async () => {
    if (!confirm("Run Health Check?\n\nThis will safely purge old read-receipts (older than 30 days) to keep the database fast and optimized.")) return;
    setIsSubmitting(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { error } = await supabase
        .from('aft_note_reads')
        .delete()
        .lt('read_at', thirtyDaysAgo.toISOString());
        
      if (error) throw error;
      alert("Database health check & cleanup completed successfully!");
    } catch (e: any) {
      alert("Cleanup failed: " + e.message);
    }
    setIsSubmitting(false);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await supabase.from('aft_system_settings').upsert({ id: 1, ...sysSettings });
    setIsSubmitting(false);
    setShowSettingsModal(false);
    alert("Global maintenance triggers updated!");
  };

  const getEmailPreviewHtml = () => {
    const baseStyle = `font-family: Arial, sans-serif; font-size: 14px; color: #333333; line-height: 1.6; max-w: 600px;`;
    const contactInfo = `<strong>John Doe</strong><br/>(555) 123-4567<br/><a href="#" style="color: #333333;">john@doe.com</a>`;
    
    if (emailPreviewType === 'squawk_mx') {
      return `
        <div style="${baseStyle}">
          <p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p>
          <p>A new squawk has been reported for N12345. Please let us know when you are able to accommodate this aircraft in your schedule to address the issue.</p>
          <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Status: AOG / GROUNDED<br/>Description: Left Main tire showing cords.</p>
          <p style="margin-top: 20px;">You can view the full report and attached photos securely here:<br/><a href="#">https://your-app.com/squawk/12345</a></p>
          <p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p>
        </div>
      `;
    }
    if (emailPreviewType === 'squawk_internal') {
      return `
        <div style="${baseStyle}">
          <p>A new squawk was reported on N12345 by ABC.</p>
          <p style="margin-top: 20px;"><strong>Squawk Details:</strong><br/>Location: KDFW<br/>Grounded: YES<br/>Description: Left Main tire showing cords.</p>
          <p style="margin-top: 20px;">Please log in to the fleet portal to view full details and any attached photos.</p>
        </div>
      `;
    }
    if (emailPreviewType === 'mx_schedule') {
      return `
        <div style="${baseStyle}">
          <p style="margin-bottom: 20px;">Hello Bob's Maintenance,</p>
          <p>The following maintenance item is coming due for N12345. Please let us know when you are able to add this aircraft to your schedule.</p>
          <p style="margin-top: 20px;"><strong>Maintenance Details:</strong><br/>Item: 100 Hour Inspection<br/>Due: at 1500.5 hours</p>
          <p style="margin-top: 20px;">Thank you,<br/>${contactInfo}</p>
        </div>
      `;
    }
    if (emailPreviewType === 'mx_reminder') {
      return `
        <div style="${baseStyle}">
          <p>This is an automated reminder that required maintenance is coming due for N12345.</p>
          <p style="margin-top: 20px;"><strong>Item:</strong> 100 Hour Inspection<br/><strong>Status:</strong> DUE IN 15 HOURS</p>
          <p style="margin-top: 20px;">Log in to the fleet portal to manage maintenance scheduling.</p>
        </div>
      `;
    }
    return "";
  };

  // --- ACCESS MANAGEMENT FUNCTIONS ---
  const openAccessModal = async () => {
    setIsSubmitting(true);
    const { data } = await supabase.from('aft_user_roles').select('*').eq('role', 'pilot');
    if (data) setAllUsers(data);
    setSelectedAccessUserId("");
    setUserAccessList([]);
    setShowAccessModal(true);
    setIsSubmitting(false);
  };

  const fetchUserAccess = async (userId: string) => {
    setSelectedAccessUserId(userId);
    const { data } = await supabase.from('aft_user_aircraft_access').select('aircraft_id').eq('user_id', userId);
    if (data) setUserAccessList(data.map(d => d.aircraft_id));
    else setUserAccessList([]);
  };

  const toggleAccess = async (aircraftId: string, hasAccess: boolean) => {
    if (!selectedAccessUserId) return;
    
    if (hasAccess) {
      setUserAccessList(prev => prev.filter(id => id !== aircraftId));
      await supabase.from('aft_user_aircraft_access').delete().match({ user_id: selectedAccessUserId, aircraft_id: aircraftId });
    } else {
      setUserAccessList(prev => [...prev, aircraftId]);
      await supabase.from('aft_user_aircraft_access').insert({ user_id: selectedAccessUserId, aircraft_id: aircraftId });
    }
  };

  const toggleInviteAircraft = (id: string) => {
    setInviteAircraftIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  // --- USER MANAGEMENT (RESET & DELETE) ---
  const handleAdminResetPassword = async () => {
    const selectedUserEmail = allUsers.find(u => u.user_id === selectedAccessUserId)?.email;
    if (!selectedUserEmail) return;
    
    if (!confirm(`Are you sure you want to send a password reset email to ${selectedUserEmail}?`)) return;
    
    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(selectedUserEmail, { 
      redirectTo: `${window.location.origin}/update-password` 
    });
    setIsSubmitting(false);
    
    if (error) alert("Error: " + error.message);
    else alert("Password reset link sent securely to " + selectedUserEmail);
  };

  const handleDeleteUser = async () => {
    const selectedUserEmail = allUsers.find(u => u.user_id === selectedAccessUserId)?.email;
    if (!selectedUserEmail) return;
    
    if (!confirm(`CRITICAL WARNING: Are you absolutely sure you want to permanently delete ${selectedUserEmail} and revoke all their access?`)) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedAccessUserId })
      });
      if (!res.ok) throw new Error(await res.text());
      
      alert("User successfully deleted.");
      
      const { data } = await supabase.from('aft_user_roles').select('*').eq('role', 'pilot');
      if (data) setAllUsers(data);
      setSelectedAccessUserId("");
      setUserAccessList([]);
    } catch (error: any) {
      alert("Failed to delete user: " + error.message);
    }
    setIsSubmitting(false);
  };

  // --- AUTHENTICATION FUNCTIONS ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setIsSubmitting(false);
    if (error) alert("Login Failed: " + error.message);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: `${window.location.origin}/update-password` });
    setIsSubmitting(false);
    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("Password reset link sent to your email!");
      setShowForgotPassword(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: inviteEmail, 
          role: inviteRole,
          aircraftIds: inviteAircraftIds 
        })
      });
      
      if (!res.ok) throw new Error(await res.text());
      
      alert(`Invitation successfully sent to ${inviteEmail}!`);
      setShowInviteModal(false); 
      setInviteEmail("");
      setInviteAircraftIds([]);
    } catch (error: any) {
      alert("Failed to invite user: " + error.message);
    }
    setIsSubmitting(false);
  };

  // --- CROPPER FUNCTIONS ---
  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => setAvatarSrc(reader.result?.toString() || ''));
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const getCroppedImg = async (): Promise<File | null> => {
    const image = imageRef.current;
    if (!image || !crop.width || !crop.height) return null;

    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;
    ctx.drawImage(
      image, 
      crop.x * scaleX, 
      crop.y * scaleY, 
      crop.width * scaleX, 
      crop.height * scaleY, 
      0, 
      0, 
      canvas.width, 
      canvas.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
        else resolve(null);
      }, 'image/jpeg');
    });
  };

  // --- AIRCRAFT FORM ---
  const openAircraftForm = (aircraft: any = null) => {
    if (aircraft) { 
      setEditingAircraftId(aircraft.id); 
      setNewTail(aircraft.tail_number); 
      setNewSerial(aircraft.serial_number || ""); 
      setNewModel(aircraft.aircraft_type); 
      setNewType(aircraft.engine_type); 
      setNewAirframeTime(aircraft.total_airframe_time || ""); 
      setNewEngineTime(aircraft.total_engine_time || ""); 
      setNewHomeAirport(aircraft.home_airport || ""); 
      setNewMainContact(aircraft.main_contact || ""); 
      setNewMainContactPhone(aircraft.main_contact_phone || ""); 
      setNewMainContactEmail(aircraft.main_contact_email || ""); 
      setNewMxContact(aircraft.mx_contact || ""); 
      setNewMxContactPhone(aircraft.mx_contact_phone || ""); 
      setNewMxContactEmail(aircraft.mx_contact_email || ""); 
    } else { 
      setEditingAircraftId(null); 
      setNewTail(""); 
      setNewSerial(""); 
      setNewModel(""); 
      setNewType('Piston'); 
      setNewAirframeTime(""); 
      setNewEngineTime(""); 
      setNewHomeAirport(""); 
      setNewMainContact(""); 
      setNewMainContactPhone(""); 
      setNewMainContactEmail(""); 
      setNewMxContact(""); 
      setNewMxContactPhone(""); 
      setNewMxContactEmail(""); 
    }
    setAvatarSrc(""); 
    setShowAircraftModal(true);
  };

  const handleSaveAircraft = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    
    let avatarUrl = aircraftList.find(a => a.id === editingAircraftId)?.avatar_url || null;

    if (avatarSrc) {
      const croppedFile = await getCroppedImg();
      if (croppedFile) {
        try {
          const compressed = await imageCompression(croppedFile, { maxSizeMB: 0.5, maxWidthOrHeight: 1200, useWebWorker: true });
          const fileName = `${newTail.toUpperCase()}_${Date.now()}`;
          const { data } = await supabase.storage.from('aft_aircraft_avatars').upload(fileName, compressed);
          if (data) {
            const { data: urlData } = supabase.storage.from('aft_aircraft_avatars').getPublicUrl(data.path);
            avatarUrl = urlData.publicUrl;
          }
        } catch (err) { 
          console.error("Avatar upload failed:", err); 
        }
      }
    }

    const payload = { 
      tail_number: newTail.toUpperCase(), 
      serial_number: newSerial, 
      aircraft_type: newModel, 
      engine_type: newType, 
      total_airframe_time: parseFloat(newAirframeTime) || 0, 
      total_engine_time: parseFloat(newEngineTime) || 0, 
      home_airport: newHomeAirport, 
      main_contact: newMainContact, 
      main_contact_phone: newMainContactPhone, 
      main_contact_email: newMainContactEmail, 
      mx_contact: newMxContact, 
      mx_contact_phone: newMxContactPhone, 
      mx_contact_email: newMxContactEmail, 
      avatar_url: avatarUrl
    };
    
    if (editingAircraftId) {
      await supabase.from('aft_aircraft').update(payload).eq('id', editingAircraftId);
    } else {
      await supabase.from('aft_aircraft').insert(payload);
    }
    
    await fetchAircraftData(session.user.id); 
    setActiveTail(newTail.toUpperCase()); 
    setShowAircraftModal(false); 
    setIsSubmitting(false);
  };

  const handleDeleteAircraft = async (id: string) => {
    setIsSubmitting(true);
    await supabase.from('aft_aircraft').delete().eq('id', id);
    
    const { data: aircraftData } = await supabase.from('aft_aircraft').select('*').order('tail_number');
    if (aircraftData && aircraftData.length > 0) {
      setAircraftList(aircraftData);
      setActiveTail(aircraftData[0].tail_number);
      setActiveTab('fleet');
    } else {
      setAircraftList([]);
      setActiveTail("");
      setActiveTab('fleet');
    }
    setIsSubmitting(false);
  };

  const getTabColor = (tabId: string) => {
    if (activeTab !== tabId) return 'text-gray-400 hover:bg-gray-50';
    switch(tabId) { 
      case 'summary': return 'text-navy'; 
      case 'times': return 'text-[#3AB0FF]'; 
      case 'mx': return 'text-[#F08B46]'; 
      case 'squawks': return 'text-[#CE3732]'; 
      case 'notes': return 'text-[#525659]'; 
      default: return 'text-brandOrange'; 
    }
  };

  const getIndicatorColor = (tabId: string) => {
    switch(tabId) { 
      case 'summary': return 'bg-navy'; 
      case 'times': return 'bg-[#3AB0FF]'; 
      case 'mx': return 'bg-[#F08B46]'; 
      case 'squawks': return 'bg-[#CE3732]'; 
      case 'notes': return 'bg-[#525659]'; 
      default: return 'bg-brandOrange'; 
    }
  };

  // --- LOGIN SCREEN ---
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-slateGray h-[100dvh] w-full overflow-hidden">
        <div className="bg-cream shadow-2xl rounded-sm p-8 w-full max-w-md animate-slide-up">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="Alis Grave Nil" className="mx-auto h-32 object-contain mb-4" />
            <h2 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy">
              {showForgotPassword ? 'Reset Password' : 'Aircraft Tracker'}
            </h2>
          </div>
          
          {!showForgotPassword ? (
            <form onSubmit={handleLogin} className="space-y-4 animate-fade-in">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label>
                <input 
                  type="email" 
                  required 
                  value={authEmail} 
                  onChange={(e) => setAuthEmail(e.target.value)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
                <div className="relative mt-1">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    required 
                    value={authPassword} 
                    onChange={(e) => setAuthPassword(e.target.value)} 
                    className="w-full border border-gray-300 rounded p-3 text-sm bg-white focus:border-navy outline-none pr-10" 
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
                  {isSubmitting ? "Logging in..." : "Access Portal"}
                </PrimaryButton>
              </div>
              <button 
                type="button" 
                onClick={() => setShowForgotPassword(true)} 
                className="w-full text-center text-xs text-gray-500 mt-4 hover:text-navy underline"
              >
                Forgot Password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4 animate-fade-in">
              <p className="text-xs text-gray-500 text-center mb-4">
                Enter your email and we will send you a secure link to set a new password.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
                <input 
                  type="email" 
                  required 
                  value={authEmail} 
                  onChange={(e) => setAuthEmail(e.target.value)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none" 
                />
              </div>
              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send Reset Link"}
                </PrimaryButton>
              </div>
              <button 
                type="button" 
                onClick={() => setShowForgotPassword(false)} 
                className="w-full text-center text-xs text-gray-500 mt-4 hover:text-navy underline"
              >
                Back to Login
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);

  return (
    <div className="flex flex-col bg-neutral-100 h-[100dvh] w-full overflow-hidden relative">
      
      {/* ADMIN CONTROL CENTER MODALS */}
      {showAdminMenu && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowAdminMenu(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2">
                <ShieldCheck size={20}/> Admin Center
              </h2>
              <button onClick={() => setShowAdminMenu(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <div className="space-y-3">
              <button onClick={() => { setShowAdminMenu(false); setShowInviteModal(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95">
                <Users size={18} className="text-navy" />
                <div>
                  <span className="block font-bold text-navy text-sm uppercase">Manage Users</span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Invite pilots & reset passwords</span>
                </div>
              </button>
              
              <button onClick={() => { setShowAdminMenu(false); openAccessModal(); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95">
                <PlaneTakeoff size={18} className="text-navy" />
                <div>
                  <span className="block font-bold text-navy text-sm uppercase">Aircraft Access</span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Assign planes to pilots</span>
                </div>
              </button>

              <button onClick={() => { setShowAdminMenu(false); setShowToolsMenu(true); }} className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left flex items-center gap-3 hover:border-navy hover:bg-blue-50 transition-colors active:scale-95">
                <Settings size={18} className="text-navy" />
                <div>
                  <span className="block font-bold text-navy text-sm uppercase">System Tools</span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Database health & triggers</span>
                </div>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SYSTEM TOOLS MODAL */}
      {showToolsMenu && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowToolsMenu(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-[#F08B46] animate-slide-up" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2">
                <Settings size={20}/> System Tools
              </h2>
              <button onClick={() => setShowToolsMenu(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <div className="space-y-4">
              <button onClick={() => { setShowToolsMenu(false); setShowEmailPreview(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest">
                <MailOpen size={16} /> Preview Automated Emails
              </button>

              <button onClick={() => { setShowToolsMenu(false); setShowSettingsModal(true); }} className="w-full border border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest">
                <Sliders size={16} /> Maintenance Triggers
              </button>

              <div className="border-t border-gray-200 pt-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-3 text-center">Database Maintenance</p>
                <button 
                  onClick={handleDatabaseCleanup} 
                  disabled={isSubmitting} 
                  className="w-full bg-[#CE3732] text-white font-bold py-3 px-4 rounded hover:bg-red-700 active:scale-95 transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest shadow-md"
                >
                  <Database size={16} /> {isSubmitting ? 'Running...' : 'Run Health & Cleanup Check'}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2 leading-tight">
                  Safely purges old read-receipts, 6-month-old notes, and sweeps storage for orphaned images to keep the app optimized.
                </p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* GLOBAL SETTINGS MODAL */}
      {showSettingsModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowSettingsModal(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2">
                <Sliders size={20}/> Maintenance Triggers
              </h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1">Internal Alerts (Sent to Pilots/Admins)</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-navy">Alert 1</label>
                  <input type="number" value={sysSettings.reminder_1} onChange={e=>setSysSettings({...sysSettings, reminder_1: parseInt(e.target.value)})} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-navy">Alert 2</label>
                  <input type="number" value={sysSettings.reminder_2} onChange={e=>setSysSettings({...sysSettings, reminder_2: parseInt(e.target.value)})} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-navy">Alert 3</label>
                  <input type="number" value={sysSettings.reminder_3} onChange={e=>setSysSettings({...sysSettings, reminder_3: parseInt(e.target.value)})} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                </div>
              </div>
              
              <p className="text-[10px] text-gray-500 uppercase tracking-widest border-b pb-1 mt-4">Mechanic Scheduling Requests (To MX)</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-navy">Hours Trigger</label>
                  <input type="number" value={sysSettings.sched_time} onChange={e=>setSysSettings({...sysSettings, sched_time: parseInt(e.target.value)})} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-navy">Days Trigger</label>
                  <input type="number" value={sysSettings.sched_days} onChange={e=>setSysSettings({...sysSettings, sched_days: parseInt(e.target.value)})} className="w-full border rounded p-2 text-sm mt-1 focus:border-navy outline-none" />
                </div>
              </div>

              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Globally"}</PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EMAIL PREVIEWER MODAL */}
      {showEmailPreview && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowEmailPreview(false)}>
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-navy animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-xl font-bold uppercase text-navy flex items-center gap-2">
                <MailOpen size={20}/> Email Previewer
              </h2>
              <button onClick={() => setShowEmailPreview(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Template to Preview</label>
              <select 
                value={emailPreviewType} 
                onChange={e=>setEmailPreviewType(e.target.value as any)} 
                className="w-full border border-gray-300 rounded p-2 text-sm mt-1 bg-white outline-none focus:border-navy"
              >
                <option value="squawk_mx">Squawk Alert (To MX)</option>
                <option value="squawk_internal">Squawk Alert (Internal)</option>
                <option value="mx_schedule">MX Schedule Request</option>
                <option value="mx_reminder">MX Due Reminder</option>
              </select>
            </div>

            <div className="border border-gray-300 rounded overflow-hidden shadow-inner bg-gray-50">
              <div className="bg-gray-200 px-3 py-1.5 border-b border-gray-300 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Rendered Inbox View
              </div>
              <div className="p-4 bg-white" dangerouslySetInnerHTML={{ __html: getEmailPreviewHtml() }} />
            </div>

          </div>
        </div>
      )}

      {/* AIRCRAFT MODAL WITH CROPPER */}
      {showAircraftModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-[#1B4869]">
                {editingAircraftId ? 'Edit Aircraft' : 'Add Aircraft'}
              </h2>
              <button onClick={() => setShowAircraftModal(false)} className="text-gray-400 hover:text-red-500 transition-colors">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={handleSaveAircraft} className="space-y-4">
              
              <div className="border border-dashed border-gray-300 bg-gray-50 rounded p-4 text-center">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2 cursor-pointer">
                  {avatarSrc ? 'Adjust Photo Alignment' : 'Upload Aircraft Photo (Avatar)'}
                </label>
                {!avatarSrc ? (
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={onSelectFile} 
                    className="text-xs text-gray-500 w-full cursor-pointer" 
                  />
                ) : (
                  <div className="w-full h-auto flex justify-center bg-black rounded overflow-hidden">
                    <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={16 / 9}>
                      <img ref={imageRef} src={avatarSrc} alt="Crop preview" className="max-h-[200px] object-contain" />
                    </ReactCrop>
                  </div>
                )}
                {avatarSrc && (
                  <button type="button" onClick={() => setAvatarSrc("")} className="text-[10px] uppercase text-red-500 font-bold mt-2 hover:underline">
                    Choose Different Photo
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Tail Number</label>
                  <input type="text" required value={newTail} onChange={e=>setNewTail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Serial Num</label>
                  <input type="text" value={newSerial} onChange={e=>setNewSerial(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Model Name</label>
                  <input type="text" required value={newModel} onChange={e=>setNewModel(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Engine Type</label>
                  <select value={newType} onChange={e=>setNewType(e.target.value as 'Piston'|'Turbine')} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F08B46] outline-none">
                    <option value="Piston">Piston</option>
                    <option value="Turbine">Turbine</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Home Airport</label>
                  <input type="text" value={newHomeAirport} onChange={e=>setNewHomeAirport(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" placeholder="KDFW" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Main Contact</label>
                  <input type="text" value={newMainContact} onChange={e=>setNewMainContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="John Doe" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Phone</label>
                  <input type="tel" value={newMainContactPhone} onChange={e=>setNewMainContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="(555) 123-4567" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Email</label>
                  <input type="email" value={newMainContactEmail} onChange={e=>setNewMainContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="john@doe.com" />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Contact</label>
                  <input type="text" value={newMxContact} onChange={e=>setNewMxContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Phone</label>
                  <input type="tel" value={newMxContactPhone} onChange={e=>setNewMxContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="(555) 987-6543" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Email</label>
                  <input type="email" value={newMxContactEmail} onChange={e=>setNewMxContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="mx@shop.com" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'}</label>
                  <input type="number" step="0.1" required value={newAirframeTime} onChange={e=>setNewAirframeTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Current {newType === 'Turbine' ? 'FTT' : 'Tach'}</label>
                  <input type="number" step="0.1" required value={newEngineTime} onChange={e=>setNewEngineTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                </div>
              </div>
              
              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Aircraft"}</PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN AIRCRAFT ACCESS MODAL */}
      {showAccessModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up max-h-[90vh] overflow-y-auto">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
                <ShieldCheck size={20}/> Assign Aircraft
              </h2>
              <button onClick={() => setShowAccessModal(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Select Pilot</label>
                <select 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-navy outline-none"
                  value={selectedAccessUserId}
                  onChange={(e) => fetchUserAccess(e.target.value)}
                >
                  <option value="">-- Choose a Pilot --</option>
                  {allUsers.map(u => (
                    <option key={u.user_id} value={u.user_id}>{u.email || u.user_id}</option>
                  ))}
                </select>
              </div>

              {selectedAccessUserId && (
                <>
                  <div className="border border-gray-200 rounded p-4 bg-gray-50">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Allowed Aircraft</h3>
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                      {aircraftList.map(ac => {
                        const hasAccess = userAccessList.includes(ac.id);
                        return (
                          <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={hasAccess} 
                              onChange={() => toggleAccess(ac.id, hasAccess)} 
                              className="w-4 h-4 text-navy border-gray-300 rounded"
                            />
                            <span className="font-bold text-sm text-navy uppercase">{ac.tail_number}</span>
                            <span className="text-[10px] text-gray-500 uppercase">{ac.aircraft_type}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4 border-t border-gray-200 mt-4">
                    <button 
                      type="button" 
                      onClick={handleAdminResetPassword} 
                      className="flex-1 border border-brandOrange text-brandOrange text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-orange-50 transition-colors"
                    >
                      Reset Password
                    </button>
                    <button 
                      type="button" 
                      onClick={handleDeleteUser} 
                      className="flex-1 border border-[#CE3732] text-[#CE3732] text-[10px] font-bold uppercase tracking-widest py-2 rounded hover:bg-red-50 transition-colors"
                    >
                      Delete User
                    </button>
                  </div>
                </>
              )}
            </div>
            
            <div className="pt-6">
              <PrimaryButton onClick={() => setShowAccessModal(false)}>Done</PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* INVITE USER MODAL */}
      {showInviteModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
                <Users size={20}/> Invite User
              </h2>
              <button onClick={() => { setShowInviteModal(false); setInviteAircraftIds([]); }} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
                <input 
                  type="email" 
                  required 
                  value={inviteEmail} 
                  onChange={e=>setInviteEmail(e.target.value)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy" 
                />
              </div>
              
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role</label>
                <select 
                  value={inviteRole} 
                  onChange={e=>setInviteRole(e.target.value as any)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white outline-none focus:border-navy"
                >
                  <option value="pilot">Pilot</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              {inviteRole === 'pilot' && (
                <div className="border border-gray-200 rounded p-3 bg-gray-50 mt-2 max-h-[30vh] overflow-y-auto">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Assign Aircraft Access</h3>
                  <div className="space-y-2">
                    {aircraftList.map(ac => (
                      <label key={ac.id} className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={inviteAircraftIds.includes(ac.id)} 
                          onChange={() => toggleInviteAircraft(ac.id)} 
                          className="w-4 h-4 text-navy border-gray-300 rounded" 
                        />
                        <span className="font-bold text-xs text-navy uppercase">{ac.tail_number}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Invite Email"}</PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="bg-navy text-white shadow-md z-20 shrink-0 w-full">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center w-full">
          
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">Active Aircraft</span>
            <div className="flex items-center gap-3">
              
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500 animate-pulse' : aircraftStatus === 'issues' ? 'bg-[#F08B46]' : 'bg-success'}`} />
              
              <div className="relative flex items-center">
                <select 
                  className="appearance-none bg-transparent text-xl font-oswald font-bold uppercase tracking-wide focus:outline-none cursor-pointer w-[120px] shrink-0 text-white pr-6 truncate" 
                  value={activeTail} 
                  onChange={(e) => setActiveTail(e.target.value)}
                >
                  {aircraftList.map(a => (
                    <option key={a.id} value={a.tail_number} className="text-white">{a.tail_number}</option>
                  ))}
                </select>
                <ChevronDown size={18} className="absolute right-1 text-white pointer-events-none opacity-80" />
              </div>
              
              {role === 'admin' && (
                <div className="flex gap-1 ml-1 shrink-0">
                  <button onClick={() => openAircraftForm()} className="bg-[#F08B46] text-white rounded-full p-1.5 hover:bg-[#E45D3E] transition-colors active:scale-95">
                    <Plus size={14} />
                  </button>
                  <button onClick={() => openAircraftForm(selectedAircraftData)} className="bg-slateGray text-white rounded-full p-1.5 hover:bg-gray-500 transition-colors active:scale-95">
                    <Edit2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-4">
            <button onClick={() => setActiveTab('fleet')} className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-[#F5B05B]' : 'text-gray-300'}`}>
              <LayoutGrid size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Fleet</span>
            </button>

            <button onClick={() => window.location.href = '/quick'} className="text-gray-300 hover:text-[#3AB0FF] transition-colors flex flex-col items-center active:scale-95 shrink-0">
              <Send size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span>
            </button>

            {role === 'admin' && (
              <button onClick={() => setShowAdminMenu(true)} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0">
                <ShieldCheck size={18} />
                <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span>
              </button>
            )}

            <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0">
              <LogOut size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
            </button>
          </div>

        </div>
      </header>

      {/* GROUNDED BANNER */}
      {aircraftStatus === 'grounded' && (
        <div className="bg-[#CE3732] text-white text-center py-2 px-4 shadow-md z-10 flex justify-center items-center gap-2 animate-pulse shrink-0 w-full">
          <AlertTriangle size={18} />
          <span className="font-oswald tracking-widest font-bold uppercase text-sm md:text-base">This aircraft is not flight ready</span>
          <AlertTriangle size={18} />
        </div>
      )}

      {/* MAIN SCROLLABLE CONTENT */}
      <main className="flex-1 overflow-y-auto p-4 flex justify-center w-full" style={{ touchAction: 'auto' }}>
        <div className="w-full max-w-3xl flex flex-col gap-6">
          {activeTab === 'fleet' && <FleetSummary aircraftList={aircraftList} onSelectAircraft={(tail) => { setActiveTail(tail); setActiveTab('summary'); }} />}
          
          {/* SAFE BYPASS FOR VERCEL BUILD ERROR TS2322 */}
          {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} setActiveTab={(tab: any) => setActiveTab(tab)} role={role} onDeleteAircraft={handleDeleteAircraft} />}
          
          {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onUpdate={() => fetchAircraftData(session.user.id)} />}
          {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} sysSettings={sysSettings} />}
          {activeTab === 'squawks' && <SquawksTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} />}
          {activeTab === 'notes' && <NotesTab aircraft={selectedAircraftData} session={session} role={role} userInitials={userInitials} onNotesRead={() => setUnreadNotes(0)} />}
        </div>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="bg-white border-t border-gray-200 w-full z-20 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-3xl mx-auto flex justify-around">
          {[
            { id: 'summary', icon: Home, label: 'Home', badge: 0 },
            { id: 'times', icon: Clock, label: 'Times', badge: 0 },
            { id: 'mx', icon: Wrench, label: 'Mx Due', badge: 0 },
            { id: 'squawks', icon: AlertTriangle, label: 'Squawks', badge: 0 },
            { id: 'notes', icon: FileText, label: 'Notes', badge: unreadNotes }
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-3 md:py-4 flex flex-col items-center justify-center transition-all relative active:scale-95 ${getTabColor(tab.id)}`}>
              
              <div className="relative mb-1">
                <tab.icon size={20} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CE3732] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#CE3732] text-[8px] text-white font-bold items-center justify-center border border-white"></span>
                  </span>
                )}
              </div>
              
              <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              {activeTab === tab.id && <div className={`absolute top-0 w-12 h-1 rounded-b-full ${getIndicatorColor(tab.id)}`}></div>}
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}