"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, Wrench, AlertTriangle, FileText, Clock, LogOut, Plus, X, Edit2, ChevronDown, Home, Users } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";
import ReactCrop, { Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

import SummaryTab from "@/components/tabs/SummaryTab";
import TimesTab from "@/components/tabs/TimesTab";
import MaintenanceTab from "@/components/tabs/MaintenanceTab";
import SquawksTab from "@/components/tabs/SquawksTab"; 
import NotesTab from "@/components/tabs/NotesTab";

export default function FleetTrackerApp() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'admin' | 'pilot'>('pilot');
  
  // Login State
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // App State
  const [aircraftList, setAircraftList] = useState<any[]>([]);
  const[activeTail, setActiveTail] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'summary' | 'times' | 'mx' | 'squawks' | 'notes'>('summary');
  const[aircraftStatus, setAircraftStatus] = useState<'airworthy' | 'issues' | 'grounded'>('airworthy');
  const[unreadNotes, setUnreadNotes] = useState(0);

  // Invite User State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const[inviteRole, setInviteRole] = useState<'admin'|'pilot'>('pilot');

  // Aircraft Modal State
  const[showAircraftModal, setShowAircraftModal] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);
  const [newTail, setNewTail] = useState("");
  const[newSerial, setNewSerial] = useState("");
  const [newModel, setNewModel] = useState("");
  const[newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const[newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const [newHomeAirport, setNewHomeAirport] = useState("");
  const [newMainContact, setNewMainContact] = useState("");
  const [newMainContactPhone, setNewMainContactPhone] = useState(""); 
  const [newMainContactEmail, setNewMainContactEmail] = useState(""); 
  const[newMxContact, setNewMxContact] = useState(""); 
  const [newMxContactPhone, setNewMxContactPhone] = useState(""); 
  const [newMxContactEmail, setNewMxContactEmail] = useState(""); 
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cropper State
  const [avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 }); // 16:9 aspect ratio
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
    const { data: roleData } = await supabase.from('aft_user_roles').select('role').eq('user_id', userId).single();
    if (roleData) setRole(roleData.role);
    
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
    if (!notes || notes.length === 0) { setUnreadNotes(0); return; }
    
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
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      if (!res.ok) throw new Error(await res.text());
      alert(`Invitation successfully sent to ${inviteEmail}!`);
      setShowInviteModal(false); 
      setInviteEmail("");
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
    ctx.drawImage(image, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY, 0, 0, canvas.width, canvas.height);

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
        } catch (err) { console.error("Avatar upload failed:", err); }
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

  const getTabColor = (tabId: string) => {
    if (activeTab !== tabId) return 'text-gray-400 hover:bg-gray-50';
    switch(tabId) { 
      case 'summary': return 'text-navy'; 
      case 'times': return 'text-[#F5B05B]'; 
      case 'mx': return 'text-[#F08B46]'; 
      case 'squawks': return 'text-[#CE3732]'; 
      case 'notes': return 'text-[#525659]'; 
      default: return 'text-brandOrange'; 
    }
  };

  const getIndicatorColor = (tabId: string) => {
    switch(tabId) { 
      case 'summary': return 'bg-navy'; 
      case 'times': return 'bg-[#F5B05B]'; 
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
                <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F08B46] outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
                <input type="password" required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F08B46] outline-none" />
              </div>
              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Logging in..." : "Access Portal"}</PrimaryButton>
              </div>
              <button type="button" onClick={() => setShowForgotPassword(true)} className="w-full text-center text-xs text-gray-500 mt-4 hover:text-navy underline">
                Forgot Password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4 animate-fade-in">
              <p className="text-xs text-gray-500 text-center mb-4">Enter your email and we will send you a secure link to set a new password.</p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
                <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white focus:border-[#F08B46] outline-none" />
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

  const selectedAircraftData = aircraftList.find(a => a.tail_number === activeTail);

  return (
    <div className="flex flex-col bg-neutral-100 h-[100dvh] w-full overflow-hidden relative">
      
      {/* AIRCRAFT MODAL WITH CROPPER */}
      {showAircraftModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-[#1B4869]">{editingAircraftId ? 'Edit Aircraft' : 'Add Aircraft'}</h2>
              <button onClick={() => setShowAircraftModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button>
            </div>
            
            <form onSubmit={handleSaveAircraft} className="space-y-4">
              
              {/* IMAGE CROPPER UI */}
              <div className="border border-dashed border-gray-300 bg-gray-50 rounded p-4 text-center">
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2 cursor-pointer">
                  {avatarSrc ? 'Adjust Photo Alignment' : 'Upload Aircraft Photo (Avatar)'}
                </label>
                {!avatarSrc ? (
                  <input type="file" accept="image/*" onChange={onSelectFile} className="text-xs text-gray-500 w-full cursor-pointer" />
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

              {/* Main Contact Info */}
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
              
              {/* MX Contact Info */}
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

      {/* INVITE USER MODAL */}
      {showInviteModal && role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 border-navy animate-slide-up">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><Users size={20}/> Invite User</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-red-500">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email Address</label>
                <input type="email" required value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 outline-none focus:border-navy" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Role</label>
                <select value={inviteRole} onChange={e=>setInviteRole(e.target.value as any)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 bg-white outline-none focus:border-navy">
                  <option value="pilot">Pilot</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Sending..." : "Send Invite Email"}</PrimaryButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BRAND BANNER CROPPED */}
      <div className="w-full h-4 md:h-6 shrink-0">
        <img src="/header-bg.png" alt="Brand Stripes" className="w-full h-full object-cover object-right block" />
      </div>

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
            {role === 'admin' && (
              <button onClick={() => setShowInviteModal(true)} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0">
                <Users size={18} />
                <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Users</span>
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
          {activeTab === 'summary' && <SummaryTab aircraft={selectedAircraftData} />}
          {activeTab === 'times' && <TimesTab aircraft={selectedAircraftData} session={session} role={role} onUpdate={() => fetchAircraftData(session.user.id)} />}
          {activeTab === 'mx' && <MaintenanceTab aircraft={selectedAircraftData} role={role} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} />}
          {activeTab === 'squawks' && <SquawksTab aircraft={selectedAircraftData} session={session} role={role} onGroundedStatusChange={() => checkGroundedStatus(activeTail)} />}
          {activeTab === 'notes' && <NotesTab aircraft={selectedAircraftData} session={session} role={role} onNotesRead={() => setUnreadNotes(0)} />}
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