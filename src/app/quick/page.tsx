"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, ChevronRight, CheckCircle, Camera, Clock, X, Eye, EyeOff, LogOut, Info, Download, Share } from "lucide-react";
import imageCompression from "browser-image-compression";
import { PrimaryButton } from "@/components/AppButtons";

export default function QuickLogCompanion() {
  const [session, setSession] = useState<any>(null);
  const[userInitials, setUserInitials] = useState("");
  const [aircraftList, setAircraftList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- LOGIN STATE ---
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // --- WIZARD STATE ---
  type FlowType = 'flight' | 'squawk' | null;
  const[flow, setFlow] = useState<FlowType>(null);
  const [step, setStep] = useState(0);
  const [selectedAircraft, setSelectedAircraft] = useState<any>(null);

  // --- INSTALL PROMPT STATE ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showIosInstruction, setShowIosInstruction] = useState(false);
  const[isIos, setIsIos] = useState(false);

  // --- FLIGHT LOG STATE ---
  const[logAftt, setLogAftt] = useState("");
  const[logFtt, setLogFtt] = useState("");
  const [logHobbs, setLogHobbs] = useState("");
  const[logTach, setLogTach] = useState("");
  const[logLandings, setLogLandings] = useState("");
  const [logCycles, setLogCycles] = useState("");
  const[logFuel, setLogFuel] = useState("");
  const [logFuelUnit, setLogFuelUnit] = useState<'gallons' | 'lbs'>('gallons');
  const [logInitials, setLogInitials] = useState("");
  const [logReason, setLogReason] = useState("");
  const [logPax, setLogPax] = useState("");
  const [showLegend, setShowLegend] = useState(false);

  // --- SQUAWK STATE ---
  const [sqLocation, setSqLocation] = useState("");
  const [sqDescription, setSqDescription] = useState("");
  const [sqAirworthy, setSqAirworthy] = useState<boolean | null>(null);
  const [sqImages, setSqImages] = useState<File[]>([]);
  const[sqNotifyMx, setSqNotifyMx] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
      else setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
      else setIsLoading(false);
    });

    // Detect iOS and Android Install Prompts
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) setIsIos(true);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });

    return () => subscription.unsubscribe();
  },[]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setIsSubmitting(false);
    if (error) alert("Login Failed: " + error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const fetchUserData = async (userId: string) => {
    const { data: roleData } = await supabase.from('aft_user_roles').select('role, initials').eq('user_id', userId).single();
    if (roleData) {
      setLogInitials(roleData.initials || "");
      setUserInitials(roleData.initials || "");
      
      let query = supabase.from('aft_aircraft').select('*').order('tail_number');
      
      if (roleData.role === 'pilot') {
        const { data: access } = await supabase.from('aft_user_aircraft_access').select('aircraft_id').eq('user_id', userId);
        if (access && access.length > 0) query = query.in('id', access.map(a => a.aircraft_id));
        else query = query.in('id',[]);
      }
      
      const { data: aircraftData } = await query;
      if (aircraftData) setAircraftList(aircraftData);
    }
    setIsLoading(false);
  };

  const handleInstallClick = () => {
    if (isIos) {
      setShowIosInstruction(true);
    } else if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
    } else {
      alert("To install, use your browser's menu to 'Add to Home Screen'.");
    }
  };

  const startFlow = (type: FlowType) => {
    setFlow(type);
    if (aircraftList.length === 1) {
      setSelectedAircraft(aircraftList[0]);
      setStep(2);
    } else {
      setStep(1);
    }
  };

  // FULL CACHE & STATE CLEAR
  const resetFlow = () => {
    setFlow(null);
    setStep(0);
    setSelectedAircraft(null);
    
    // Zero out all flight state
    setLogAftt(""); setLogFtt(""); setLogHobbs(""); setLogTach("");
    setLogLandings(""); setLogCycles(""); setLogFuel(""); setLogPax(""); setLogReason("");
    
    // Zero out all squawk state & wipe image cache
    setSqLocation(""); setSqDescription(""); setSqAirworthy(null); setSqImages([]); setSqNotifyMx(true);
    
    window.scrollTo(0, 0); // Reset scroll position to top
    if (session) fetchUserData(session.user.id); // Refresh aircraft times from DB
  };

  const isTurbine = selectedAircraft?.engine_type === 'Turbine';

  const handleNext = () => {
    if (flow === 'flight' && step === 2) {
      if (isTurbine) {
        if (!logAftt || parseFloat(logAftt) < (selectedAircraft.total_airframe_time || 0)) return alert(`AFTT must be >= ${selectedAircraft.total_airframe_time || 0}`);
        if (!logFtt || parseFloat(logFtt) < (selectedAircraft.total_engine_time || 0)) return alert(`FTT must be >= ${selectedAircraft.total_engine_time || 0}`);
      } else {
        if (!logTach || parseFloat(logTach) < (selectedAircraft.total_engine_time || 0)) return alert(`Tach must be >= ${selectedAircraft.total_engine_time || 0}`);
        if (logHobbs && parseFloat(logHobbs) < (selectedAircraft.total_airframe_time || 0)) return alert(`Hobbs must be >= ${selectedAircraft.total_airframe_time || 0}`);
      }
      if (!logLandings) return alert("Please enter the number of landings.");
      if (isTurbine && !logCycles) return alert("Please enter engine cycles.");
    }

    if (flow === 'squawk' && step === 2 && sqAirworthy === null) return alert("Please indicate if the aircraft is safe to fly.");
    if (flow === 'squawk' && step === 3 && (!sqLocation || !sqDescription)) return alert("Location and Description are required.");

    setStep(s => s + 1);
  };

  const submitFlightLog = async () => {
    setIsSubmitting(true);
    let fuelGallons = logFuel ? parseFloat(logFuel) : null;
    if (fuelGallons !== null && logFuelUnit === 'lbs') fuelGallons = fuelGallons / (isTurbine ? 6.7 : 6.0);

    const payload: any = { 
      aircraft_id: selectedAircraft.id, user_id: session.user.id, 
      engine_cycles: isTurbine ? (parseInt(logCycles) || 0) : 0, 
      landings: parseInt(logLandings), initials: logInitials.toUpperCase(), 
      pax_info: logPax || null, trip_reason: logReason || null, fuel_gallons: fuelGallons
    };
    
    const aircraftUpdate: any = {};
    if (isTurbine) {
      payload.aftt = parseFloat(logAftt); payload.ftt = parseFloat(logFtt);
      aircraftUpdate.total_airframe_time = parseFloat(logAftt); aircraftUpdate.total_engine_time = parseFloat(logFtt);
    } else {
      payload.tach = parseFloat(logTach); aircraftUpdate.total_engine_time = parseFloat(logTach);
      if (logHobbs) { payload.hobbs = parseFloat(logHobbs); aircraftUpdate.total_airframe_time = parseFloat(logHobbs); }
    }
    if (fuelGallons !== null) {
      aircraftUpdate.current_fuel_gallons = fuelGallons; aircraftUpdate.fuel_last_updated = new Date().toISOString(); 
    }

    await supabase.from('aft_flight_logs').insert(payload);
    await supabase.from('aft_aircraft').update(aircraftUpdate).eq('id', selectedAircraft.id);
    
    setStep(99); 
    setIsSubmitting(false);
  };

  const submitSquawk = async () => {
    setIsSubmitting(true);
    let uploadedPaths: string[] =[];
    
    if (sqImages.length > 0) {
      for (const file of sqImages) {
        try {
          const compressed = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
          const fileName = `${selectedAircraft.tail_number}_${Date.now()}_${compressed.name}`;
          const { data } = await supabase.storage.from('aft_squawk_images').upload(fileName, compressed);
          if (data) uploadedPaths.push(supabase.storage.from('aft_squawk_images').getPublicUrl(data.path).data.publicUrl);
        } catch (e) { console.error(e); }
      }
    }

    const payload = {
      aircraft_id: selectedAircraft.id, reported_by: session.user.id, reporter_initials: userInitials,
      location: sqLocation, description: sqDescription, affects_airworthiness: sqAirworthy,
      status: 'open', pictures: uploadedPaths, is_deferred: false
    };

    const { data: newSquawk } = await supabase.from('aft_squawks').insert(payload).select().single();

    if (newSquawk) {
      try {
        await fetch('/api/emails/squawk-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ squawk: newSquawk, aircraft: selectedAircraft, notifyMx: sqNotifyMx })
        });
      } catch (err) {}
    }

    setStep(99); 
    setIsSubmitting(false);
  };

  if (isLoading) return <div className="h-[100dvh] bg-navy flex items-center justify-center text-[#3AB0FF] font-oswald tracking-widest text-2xl animate-pulse">LOADING...</div>;

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center p-4 bg-navy h-[100dvh] w-full overflow-hidden">
        <div className="bg-white shadow-2xl rounded-2xl p-8 w-full max-w-sm animate-slide-up">
          <div className="text-center mb-8">
            <h2 className="font-oswald text-4xl font-bold uppercase tracking-widest text-navy">Log It</h2>
            <p className="text-xs text-gray-500 font-bold uppercase mt-2">Sign in once to stay connected.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label>
              <input type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl p-4 text-sm mt-1 bg-gray-50 focus:border-[#3AB0FF] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Password</label>
              <div className="relative mt-1">
                <input type={showPassword ? "text" : "password"} required value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl p-4 text-sm bg-gray-50 focus:border-[#3AB0FF] outline-none pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy">
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            <button disabled={isSubmitting} className="w-full bg-[#3AB0FF] text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-[0_10px_20px_rgba(58,176,255,0.3)] mt-6 active:scale-95 transition-transform disabled:opacity-50">
              {isSubmitting ? "LOGGING IN..." : "ACCESS"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-navy flex flex-col overflow-x-hidden relative selection:bg-none">
      
      {/* iOS INSTALL INSTRUCTIONS MODAL */}
      {showIosInstruction && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 animate-fade-in" onClick={() => setShowIosInstruction(false)}>
          <div className="bg-white w-full rounded-t-3xl p-8 pb-12 animate-slide-up text-center" onClick={e => e.stopPropagation()}>
            <h3 className="font-oswald text-2xl font-bold uppercase text-navy mb-4">Add to Home Screen</h3>
            <p className="text-gray-600 font-roboto mb-6">To install the Log It app on your iPhone or iPad:</p>
            <ol className="text-left text-navy font-bold space-y-4 mb-8 max-w-xs mx-auto">
              <li className="flex items-center gap-3"><span className="bg-gray-100 p-2 rounded text-xl"><Share size={18} className="text-blue-500"/></span> Tap the <strong>Share</strong> button below.</li>
              <li className="flex items-center gap-3"><span className="bg-gray-100 p-2 rounded text-xl">➕</span> Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li className="flex items-center gap-3"><span className="bg-gray-100 p-2 rounded text-xl">✔️</span> Tap <strong>Add</strong> in the top right corner.</li>
            </ol>
            <PrimaryButton onClick={() => setShowIosInstruction(false)}>Got it!</PrimaryButton>
          </div>
        </div>
      )}

      {/* REASON LEGEND MODAL */}
      {showLegend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 animate-fade-in" onClick={() => setShowLegend(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-[#3AB0FF] animate-slide-up relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setShowLegend(false)} className="absolute top-6 right-6 text-gray-400 hover:text-red-500 transition-colors">
              <X size={24}/>
            </button>
            <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-6">Reason Codes</h3>
            <ul className="text-lg text-navy font-roboto space-y-4">
              <li><strong className="text-[#3AB0FF] w-12 inline-block">PE:</strong> Personal Ent.</li>
              <li><strong className="text-[#3AB0FF] w-12 inline-block">BE:</strong> Business Ent.</li>
              <li><strong className="text-[#3AB0FF] w-12 inline-block">MX:</strong> Maintenance</li>
              <li><strong className="text-[#3AB0FF] w-12 inline-block">T:</strong> Training</li>
            </ul>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="text-white px-4 py-6 shrink-0 flex justify-center items-center relative z-20">
        <h1 className="font-oswald text-3xl font-bold uppercase tracking-widest">Log It</h1>
        {flow && step !== 99 ? (
          <button onClick={resetFlow} className="absolute right-4 text-gray-300 hover:text-white p-2">
            <X size={28} />
          </button>
        ) : (
          <button onClick={handleLogout} className="absolute right-4 text-gray-300 hover:text-white p-2" title="Logout">
            <LogOut size={24} />
          </button>
        )}
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-4 flex flex-col items-center pb-40" style={{ touchAction: 'auto' }}>
        <div className="w-full max-w-md w-full animate-slide-up">

          {/* HOME MENU (PREMIUM 3D CIRCULAR BUTTONS) */}
          {!flow && (
            <div className="flex flex-col items-center justify-center gap-10 mt-4 h-full">
              
              <button 
                onClick={() => startFlow('flight')}
                className="w-64 h-64 bg-gradient-to-b from-[#3AB0FF] to-[#1A85D6] text-white rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_4px_0_rgba(255,255,255,0.3)] flex flex-col items-center justify-center gap-3 active:scale-95 active:translate-y-2 transition-all"
              >
                <Clock size={64} className="opacity-95 drop-shadow-md"/>
                <h2 className="font-oswald text-3xl font-bold tracking-widest uppercase drop-shadow-md">Log Flight</h2>
              </button>
              
              <button 
                onClick={() => startFlow('squawk')}
                className="w-64 h-64 bg-gradient-to-b from-[#CE3732] to-[#9E201C] text-white rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_4px_0_rgba(255,255,255,0.3)] flex flex-col items-center justify-center gap-3 active:scale-95 active:translate-y-2 transition-all"
              >
                <AlertTriangle size={64} className="opacity-95 drop-shadow-md"/>
                <h2 className="font-oswald text-3xl font-bold tracking-widest uppercase drop-shadow-md">Log Squawk</h2>
              </button>

              {/* Add to Home Screen Link */}
              <button onClick={handleInstallClick} className="mt-6 text-[#3AB0FF] text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:text-white transition-colors bg-white/10 px-6 py-3 rounded-full active:scale-95">
                <Download size={16} /> Add to Home Screen
              </button>
            </div>
          )}

          {/* STEP 1: SELECT AIRCRAFT */}
          {flow && step === 1 && (
            <div className="flex flex-col gap-4">
              <h3 className="font-oswald text-2xl font-bold text-white uppercase text-center mb-2 tracking-widest">Select Aircraft</h3>
              {aircraftList.length === 0 ? (
                <p className="text-center text-gray-400 font-bold uppercase">No aircraft assigned to you.</p>
              ) : (
                aircraftList.map(ac => (
                  <button 
                    key={ac.id} 
                    onClick={() => { setSelectedAircraft(ac); setStep(2); }}
                    className="bg-white border-4 border-transparent hover:border-[#3AB0FF] p-6 rounded-3xl shadow-xl flex justify-between items-center active:scale-95 transition-all"
                  >
                    <div className="text-left">
                      <h4 className="font-oswald text-4xl font-bold text-navy uppercase leading-none">{ac.tail_number}</h4>
                      <p className="text-sm font-bold uppercase tracking-widest text-gray-400 mt-2">{ac.aircraft_type}</p>
                    </div>
                    <ChevronRight size={32} className="text-gray-300"/>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ========================================== */}
          {/* FLIGHT LOG FLOW */}
          {/* ========================================== */}
          {flow === 'flight' && step === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <span className="text-xs font-bold uppercase tracking-widest text-[#3AB0FF] block mb-1">Flight Times</span>
                <h3 className="font-oswald text-5xl font-bold text-white uppercase">{selectedAircraft.tail_number}</h3>
              </div>
              
              <div className="bg-white p-6 rounded-3xl shadow-xl border-t-8 border-[#3AB0FF] space-y-6">
                {isTurbine ? (
                  <>
                    <div>
                      <label className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                        <span>AFTT</span> <span className="text-[#3AB0FF]">Last: {selectedAircraft.total_airframe_time?.toFixed(1) || 0}</span>
                      </label>
                      <input type="number" step="0.1" value={logAftt} onChange={e=>setLogAftt(e.target.value)} className="w-full text-4xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 text-center focus:border-[#3AB0FF] outline-none" placeholder="0.0" />
                    </div>
                    <div>
                      <label className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                        <span>FTT</span> <span className="text-[#3AB0FF]">Last: {selectedAircraft.total_engine_time?.toFixed(1) || 0}</span>
                      </label>
                      <input type="number" step="0.1" value={logFtt} onChange={e=>setLogFtt(e.target.value)} className="w-full text-4xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 text-center focus:border-[#3AB0FF] outline-none" placeholder="0.0" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                        <span>Tach</span> <span className="text-[#3AB0FF]">Last: {selectedAircraft.total_engine_time?.toFixed(1) || 0}</span>
                      </label>
                      <input type="number" step="0.1" value={logTach} onChange={e=>setLogTach(e.target.value)} className="w-full text-4xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 text-center focus:border-[#3AB0FF] outline-none" placeholder="0.0" />
                    </div>
                    <div>
                      <label className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                        <span>Hobbs (Opt)</span> <span className="text-[#3AB0FF]">Last: {selectedAircraft.total_airframe_time?.toFixed(1) || 0}</span>
                      </label>
                      <input type="number" step="0.1" value={logHobbs} onChange={e=>setLogHobbs(e.target.value)} className="w-full text-4xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 text-center focus:border-[#3AB0FF] outline-none" placeholder="0.0" />
                    </div>
                  </>
                )}
                
                {/* STRICTLY CENTERED LANDINGS / CYCLES */}
                <div className={`grid ${isTurbine ? 'grid-cols-2 gap-4' : 'grid-cols-1'} border-t-2 border-gray-100 pt-6`}>
                  <div className="flex flex-col items-center justify-center">
                    <label className="block text-center text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Landings</label>
                    <input type="number" value={logLandings} onChange={e=>setLogLandings(e.target.value)} className="w-32 text-3xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-3 text-center focus:border-[#3AB0FF] outline-none" placeholder="0" />
                  </div>
                  {isTurbine && (
                    <div className="flex flex-col items-center justify-center">
                      <label className="block text-center text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Cycles</label>
                      <input type="number" value={logCycles} onChange={e=>setLogCycles(e.target.value)} className="w-32 text-3xl font-roboto font-bold text-navy bg-gray-50 border-2 border-gray-200 rounded-2xl p-3 text-center focus:border-[#3AB0FF] outline-none" placeholder="0" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {flow === 'flight' && step === 3 && (
            <div className="space-y-4">
              <h3 className="font-oswald text-3xl font-bold text-white uppercase text-center mb-6 tracking-widest">Final Details</h3>
              <div className="bg-white p-6 rounded-3xl shadow-xl border-t-8 border-[#3AB0FF] space-y-6">
                
                <div className="grid grid-cols-3 gap-3 border-b-2 border-gray-100 pb-6">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Current Fuel State (Opt)</label>
                    <input type="number" step="0.1" value={logFuel} onChange={e=>setLogFuel(e.target.value)} className="w-full text-xl font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#3AB0FF] outline-none" placeholder="Quantity" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Unit</label>
                    <select value={logFuelUnit} onChange={e=>setLogFuelUnit(e.target.value as any)} className="w-full text-lg font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#3AB0FF] outline-none">
                      <option value="gallons">Gal</option>
                      <option value="lbs">Lbs</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Initials *</label>
                    <input type="text" maxLength={3} value={logInitials} onChange={e=>setLogInitials(e.target.value.toUpperCase())} className="w-full text-xl font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#3AB0FF] outline-none uppercase text-center" placeholder="ABC" />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500">Reason</label>
                      <button type="button" onClick={() => setShowLegend(true)} className="text-[10px] text-[#3AB0FF] hover:text-blue-600 flex items-center gap-1 font-bold uppercase">
                        <Info size={12} /> Legend
                      </button>
                    </div>
                    <select value={logReason} onChange={e=>setLogReason(e.target.value)} className="w-full text-lg font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#3AB0FF] outline-none">
                      <option value="">Select...</option>
                      <option value="PE">PE</option>
                      <option value="BE">BE</option>
                      <option value="MX">MX</option>
                      <option value="T">T</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Passengers (Opt)</label>
                  <input type="text" value={logPax} onChange={e=>setLogPax(e.target.value)} className="w-full text-lg font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#3AB0FF] outline-none" placeholder="Names..." />
                </div>
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* SQUAWK FLOW */}
          {/* ========================================== */}
          {flow === 'squawk' && step === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <span className="text-xs font-bold uppercase tracking-widest text-[#CE3732] block mb-1">Airworthiness</span>
                <h3 className="font-oswald text-5xl font-bold text-white uppercase">{selectedAircraft.tail_number}</h3>
              </div>
              
              <div className="bg-white p-6 rounded-3xl shadow-xl border-t-8 border-[#CE3732] space-y-6 text-center">
                <p className="font-oswald tracking-widest text-2xl text-navy mb-4 uppercase font-bold">Is the aircraft safe to fly?</p>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setSqAirworthy(false)}
                    className={`p-8 rounded-2xl font-oswald text-4xl font-bold tracking-widest transition-all ${sqAirworthy === false ? 'bg-success text-white scale-105 shadow-xl' : 'bg-gray-100 text-gray-400 hover:bg-green-50'}`}
                  >
                    YES<br/><span className="text-xs uppercase font-roboto block mt-3 opacity-80">(Monitor)</span>
                  </button>
                  <button 
                    onClick={() => setSqAirworthy(true)}
                    className={`p-8 rounded-2xl font-oswald text-4xl font-bold tracking-widest transition-all ${sqAirworthy === true ? 'bg-[#CE3732] text-white scale-105 shadow-xl' : 'bg-gray-100 text-gray-400 hover:bg-red-50'}`}
                  >
                    NO<br/><span className="text-xs uppercase font-roboto block mt-3 opacity-80">(Grounded)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {flow === 'squawk' && step === 3 && (
            <div className="space-y-4">
              <h3 className="font-oswald text-3xl font-bold text-white uppercase text-center mb-6 tracking-widest">Discrepancy</h3>
              <div className="bg-white p-6 rounded-3xl shadow-xl border-t-8 border-[#CE3732] space-y-6">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Location (Airport) *</label>
                  <input type="text" value={sqLocation} onChange={e=>setSqLocation(e.target.value)} className="w-full text-xl font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 focus:border-[#CE3732] outline-none" placeholder="e.g. KDFW" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Description *</label>
                  <textarea value={sqDescription} onChange={e=>setSqDescription(e.target.value)} className="w-full text-lg font-bold bg-gray-50 border-2 border-gray-200 rounded-xl p-4 min-h-[160px] focus:border-[#CE3732] outline-none" placeholder="What is broken...?" />
                </div>
              </div>
            </div>
          )}

          {flow === 'squawk' && step === 4 && (
            <div className="space-y-4">
              <h3 className="font-oswald text-3xl font-bold text-white uppercase text-center mb-6 tracking-widest">Attach Media</h3>
              <div className="bg-white p-6 rounded-3xl shadow-xl border-t-8 border-[#CE3732] space-y-6">
                
                <div className="border-4 border-dashed border-gray-300 rounded-2xl p-10 text-center bg-gray-50 relative hover:bg-gray-100 transition-colors">
                  <Camera size={64} className="mx-auto text-[#CE3732] mb-4"/>
                  <span className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy block">Add Photos</span>
                  <input type="file" multiple accept="image/*" onChange={(e)=>{if (e.target.files) setSqImages(Array.from(e.target.files));}} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  {sqImages.length > 0 && <p className="text-lg font-bold text-success mt-4 bg-green-100 inline-block px-4 py-1 rounded-full">{sqImages.length} Photos Selected</p>}
                </div>

                <div className="bg-orange-50 p-6 rounded-2xl border-2 border-orange-200">
                  <label className="flex items-start gap-4 cursor-pointer">
                    <input type="checkbox" checked={sqNotifyMx} onChange={e=>setSqNotifyMx(e.target.checked)} className="mt-1 w-6 h-6 text-[#CE3732] rounded" />
                    <span className="text-lg font-bold text-navy">
                      Email Maintenance?
                      <span className="block text-xs font-bold text-gray-500 uppercase mt-2 leading-tight">Will send an alert to the MX contact for this tail.</span>
                    </span>
                  </label>
                </div>
                
                {isTurbine && (
                  <p className="text-xs text-gray-400 font-bold text-center uppercase tracking-widest pt-2 px-4">
                    Note: Legal Deferrals (MEL/CDL) must be processed via the full app.
                  </p>
                )}

              </div>
            </div>
          )}

          {/* SUCCESS SCREEN */}
          {step === 99 && (
            <div className="flex flex-col items-center justify-center py-24 animate-fade-in text-center px-4">
              <div className="bg-white p-8 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.4)] mb-8">
                <CheckCircle size={100} className="text-success" />
              </div>
              <h2 className="font-oswald text-5xl font-bold text-white uppercase mb-4 leading-none tracking-widest">Success!</h2>
              <p className="text-lg text-gray-300 font-bold uppercase tracking-widest mb-10">
                {flow === 'flight' ? 'Flight securely logged.' : 'Squawk securely reported.'}
              </p>
              <button onClick={resetFlow} className="w-full max-w-xs bg-white text-navy font-oswald text-2xl font-bold uppercase tracking-widest px-8 py-6 rounded-2xl shadow-xl active:scale-95 transition-transform border-4 border-transparent hover:border-gray-200">
                DONE
              </button>
            </div>
          )}

        </div>
      </main>

      {/* FLOATING ACTION BAR - LIFTED HIGHER */}
      {flow && step > 1 && step < 99 && (
        <div className="fixed bottom-12 left-4 right-4 z-30 pb-safe pointer-events-none">
          <div className="max-w-md mx-auto flex gap-4 pointer-events-auto">
            <button onClick={() => setStep(s => s - 1)} disabled={isSubmitting} className="flex-1 bg-white text-navy font-oswald text-2xl font-bold uppercase tracking-widest py-5 rounded-2xl active:scale-95 transition-transform shadow-[0_10px_20px_rgba(0,0,0,0.5)] border border-gray-200">
              BACK
            </button>
            
            {flow === 'flight' && (
              step === 3 ? (
                <button onClick={submitFlightLog} disabled={isSubmitting || !logInitials} className="flex-[2] bg-gradient-to-b from-success to-green-600 text-white font-oswald text-2xl font-bold uppercase tracking-widest py-5 rounded-2xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] active:scale-95 transition-transform disabled:opacity-50 flex justify-center items-center border border-green-600">
                  {isSubmitting ? "SAVING..." : "SUBMIT LOG"}
                </button>
              ) : (
                <button onClick={handleNext} className="flex-[2] bg-gradient-to-b from-[#3AB0FF] to-[#1A85D6] text-white font-oswald text-2xl font-bold uppercase tracking-widest py-5 rounded-2xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] active:scale-95 transition-transform flex justify-center items-center border border-blue-400">
                  NEXT
                </button>
              )
            )}

            {flow === 'squawk' && (
              step === 4 ? (
                <button onClick={submitSquawk} disabled={isSubmitting} className="flex-[2] bg-gradient-to-b from-success to-green-600 text-white font-oswald text-2xl font-bold uppercase tracking-widest py-5 rounded-2xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] active:scale-95 transition-transform disabled:opacity-50 flex justify-center items-center border border-green-600">
                  {isSubmitting ? "SAVING..." : "SUBMIT ISSUE"}
                </button>
              ) : (
                <button onClick={handleNext} className="flex-[2] bg-gradient-to-b from-[#CE3732] to-[#9E201C] text-white font-oswald text-2xl font-bold uppercase tracking-widest py-5 rounded-2xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] active:scale-95 transition-transform flex justify-center items-center border border-red-500">
                  NEXT
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Safe Area Padding for iOS */}
      <style dangerouslySetInnerHTML={{__html: ` .pb-safe { padding-bottom: env(safe-area-inset-bottom, 1rem); } `}} />
    </div>
  );
}