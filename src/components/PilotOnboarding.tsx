"use client";

import { useState, useRef } from "react";
import { authFetch } from "@/lib/authFetch";
import { PlaneTakeoff, LogOut } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";
import ReactCrop, { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

export default function PilotOnboarding({ 
  session, 
  handleLogout, 
  onSuccess 
}: { 
  session: any, 
  handleLogout: () => void, 
  onSuccess: () => void 
}) {
  const [newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const [newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const [newHomeAirport, setNewHomeAirport] = useState("");
  const [newMainContact, setNewMainContact] = useState("");
  const [newMainContactPhone, setNewMainContactPhone] = useState(""); 
  const [newMainContactEmail, setNewMainContactEmail] = useState(""); 
  const [newMxContact, setNewMxContact] = useState(""); 
  const [newMxContactPhone, setNewMxContactPhone] = useState(""); 
  const [newMxContactEmail, setNewMxContactEmail] = useState(""); 
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    let avatarUrl = null;

    if (avatarSrc) {
      const croppedFile = await getCroppedImg();
      if (croppedFile) {
        try {
          const compressed = await imageCompression(croppedFile, { maxSizeMB: 0.5, maxWidthOrHeight: 1200, useWebWorker: true });
          const { supabase } = await import("@/lib/supabase");
          const fileName = `${newTail.toUpperCase()}_${Date.now()}`;
          const { data } = await supabase.storage.from('aft_aircraft_avatars').upload(fileName, compressed);
          if (data) {
            const { data: urlData } = supabase.storage.from('aft_aircraft_avatars').getPublicUrl(data.path);
            avatarUrl = urlData.publicUrl;
          }
        } catch (err) { console.error(err); }
      }
    }

    const payload = { 
      tail_number: newTail.toUpperCase(), serial_number: newSerial, aircraft_type: newModel, engine_type: newType, 
      total_airframe_time: parseFloat(newAirframeTime) || 0, total_engine_time: parseFloat(newEngineTime) || 0, 
      setup_aftt: newType === 'Turbine' ? (parseFloat(newAirframeTime) || 0) : 0,
      setup_ftt: newType === 'Turbine' ? (parseFloat(newEngineTime) || 0) : 0,
      setup_hobbs: newType === 'Piston' ? (parseFloat(newAirframeTime) || 0) : 0,
      setup_tach: newType === 'Piston' ? (parseFloat(newEngineTime) || 0) : 0,
      home_airport: newHomeAirport, main_contact: newMainContact, 
      main_contact_phone: newMainContactPhone, main_contact_email: newMainContactEmail, 
      mx_contact: newMxContact, mx_contact_phone: newMxContactPhone, mx_contact_email: newMxContactEmail, 
      avatar_url: avatarUrl, created_by: session.user.id
    };

    try {
      // SECURITY: Use authFetch — server derives userId from session token
      const res = await authFetch('/api/aircraft/create', {
        method: 'POST',
        body: JSON.stringify({ payload })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to create aircraft.");
      }
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col bg-neutral-100 min-h-[100dvh] w-full overflow-y-auto">
      <header className="bg-navy text-white shadow-md z-20 shrink-0 w-full">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center w-full min-h-[60px]">
          <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-white m-0 leading-none">Skyward Aircraft Manager</h1>
          <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0" title="Logout">
            <LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </header>
      <div className="flex-1 p-4 flex justify-center items-start pt-8 pb-20">
        <div className="bg-cream shadow-2xl rounded-sm w-full max-w-lg p-6 md:p-8 border-t-4 border-[#F08B46] animate-slide-up">
          <div className="text-center mb-8">
            <h2 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy mb-2">Set Up Your Aircraft</h2>
            <p className="text-sm text-gray-500 font-roboto">Please enter your aircraft details to initialize your flight log and maintenance tracking.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="border border-dashed border-gray-300 bg-gray-50 rounded p-4 text-center">
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2 cursor-pointer">{avatarSrc ? 'Adjust Photo Alignment' : 'Upload Aircraft Photo (Avatar)'}</label>
              {!avatarSrc ? (
                <input type="file" accept="image/*" onChange={onSelectFile} className="text-xs text-gray-500 w-full cursor-pointer bg-white" />
              ) : (
                <div className="w-full h-auto flex justify-center bg-black rounded overflow-hidden">
                  <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={16 / 9}>
                    <img ref={imageRef} src={avatarSrc} alt="Crop preview" className="max-h-[200px] object-contain" />
                  </ReactCrop>
                </div>
              )}
              {avatarSrc && <button type="button" onClick={() => setAvatarSrc("")} className="text-[10px] uppercase text-red-500 font-bold mt-2 hover:underline">Choose Different Photo</button>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Tail Number</label><input type="text" required value={newTail} onChange={e => setNewTail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Serial Num</label><input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Model Name</label><input type="text" required value={newModel} onChange={e => setNewModel(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Engine Type</label><select value={newType} onChange={e => setNewType(e.target.value as any)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white"><option value="Piston">Piston</option><option value="Turbine">Turbine</option></select></div>
            </div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Home Airport</label><input type="text" value={newHomeAirport} onChange={e => setNewHomeAirport(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" placeholder="ICAO" /></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Main Contact</label><input type="text" value={newMainContact} onChange={e => setNewMainContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Phone</label><input type="tel" value={newMainContactPhone} onChange={e => setNewMainContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Email</label><input type="email" value={newMainContactEmail} onChange={e => setNewMainContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Contact</label><input type="text" value={newMxContact} onChange={e => setNewMxContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Phone</label><input type="tel" value={newMxContactPhone} onChange={e => setNewMxContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Email</label><input type="email" value={newMxContactEmail} onChange={e => setNewMxContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'} *</label><input type="number" step="0.1" required value={newAirframeTime} onChange={e => setNewAirframeTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Current {newType === 'Turbine' ? 'FTT' : 'Tach'} *</label><input type="number" step="0.1" required value={newEngineTime} onChange={e => setNewEngineTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" /></div>
            </div>
            <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create Aircraft & Enter Portal"}</PrimaryButton></div>
          </form>
        </div>
      </div>
    </div>
  );
}
