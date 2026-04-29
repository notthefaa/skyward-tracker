"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/components/ToastProvider";
import { validateFileSize, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { PlaneTakeoff, LogOut, Camera, Upload } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { compressImage } from "@/lib/imageCompress";
import type { Crop } from "react-image-crop";

const AvatarCropper = dynamic(() => import("@/components/AvatarCropper"), { ssr: false });

export default function PilotOnboarding({ 
  session, 
  handleLogout, 
  onSuccess 
}: { 
  session: any, 
  handleLogout: () => void, 
  onSuccess: () => void 
}) {
  const { showError } = useToast();
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showError('Pick an image file (JPG or PNG).');
      return;
    }
    const sizeError = validateFileSize(file);
    if (sizeError) {
      showError(sizeError);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => setAvatarSrc(reader.result?.toString() || ''));
    reader.readAsDataURL(file);
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
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
          const compressed = await compressImage(croppedFile, { maxSizeMB: 0.2, maxWidthOrHeight: 800, useWebWorker: true });
          const { supabase } = await import("@/lib/supabase");
          // Extension + explicit contentType: without these, Supabase
          // serves the object as application/octet-stream, and Firefox's
          // OpaqueResponseBlocking refuses to render it inside <img>.
          const fileName = `${newTail.toUpperCase()}_${Date.now()}.jpg`;
          const { data } = await supabase.storage.from('aft_aircraft_avatars').upload(fileName, compressed, { contentType: 'image/jpeg' });
          if (data) {
            const { data: urlData } = supabase.storage.from('aft_aircraft_avatars').getPublicUrl(data.path);
            avatarUrl = urlData.publicUrl;
          }
        } catch (err) { console.error(err); }
      }
    }

    const setupAirframe = newAirframeTime !== '' ? parseFloat(newAirframeTime) : null;
    const setupEngine = parseFloat(newEngineTime) || 0;

    const payload = {
      tail_number: newTail.toUpperCase(), serial_number: newSerial, aircraft_type: newModel, engine_type: newType,
      total_airframe_time: setupAirframe != null ? setupAirframe : setupEngine,
      total_engine_time: setupEngine,
      setup_aftt: newType === 'Turbine' ? setupAirframe : null,
      setup_ftt: newType === 'Turbine' ? setupEngine : null,
      setup_hobbs: newType === 'Piston' ? setupAirframe : null,
      setup_tach: newType === 'Piston' ? setupEngine : null,
      home_airport: newHomeAirport, main_contact: newMainContact,
      main_contact_phone: newMainContactPhone, main_contact_email: newMainContactEmail,
      mx_contact: newMxContact, mx_contact_phone: newMxContactPhone, mx_contact_email: newMxContactEmail,
      avatar_url: avatarUrl, created_by: session.user.id
    };

    try {
      const res = await authFetch('/api/aircraft/create', {
        method: 'POST',
        body: JSON.stringify({ payload })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Couldn't create the aircraft.");
      }
      onSuccess();
    } catch (err: any) {
      showError(err.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col bg-neutral-100 min-h-[100dvh] w-full overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="bg-navy text-white shadow-md z-20 shrink-0 w-full">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center w-full min-h-[60px]">
          <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-white m-0 leading-none">Skyward Aircraft Manager</h1>
          <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0" title="Logout">
            <LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </header>
      <div className="flex-1 p-4 flex justify-center items-start pt-8 pb-20">
        <div className="bg-cream shadow-2xl rounded-sm w-full max-w-lg p-6 md:p-8 border-t-4 border-mxOrange animate-slide-up">
          <div className="text-center mb-8">
            <h2 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy mb-2">Set Up Your Aircraft</h2>
            <p className="text-sm text-gray-500 font-roboto">Start with the airplane&apos;s basics. Once it&apos;s set up, flight logs and maintenance tracking kick in.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              className={`border-2 border-dashed rounded p-4 text-center transition-colors ${isDragging ? 'border-mxOrange bg-orange-50' : 'border-gray-300 bg-gray-50'} ${!avatarSrc ? 'cursor-pointer' : ''}`}
              onDragOver={e => { e.preventDefault(); if (!avatarSrc) setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={!avatarSrc ? onDrop : undefined}
              onClick={() => { if (!avatarSrc) fileInputRef.current?.click(); }}
            >
              {!avatarSrc ? (
                <>
                  <Camera size={32} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-1">Add Aircraft Photo</p>
                  <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1"><Upload size={10} /> Click or drag & drop (Max {MAX_UPLOAD_SIZE_LABEL})</p>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={onSelectFile} className="hidden" />
                </>
              ) : (
                <>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Adjust Photo Alignment</label>
                  <div className="w-full flex justify-center bg-black rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    <AvatarCropper
                      ref={imageRef}
                      src={avatarSrc}
                      crop={crop}
                      onCropChange={c => setCrop(c)}
                      aspect={16 / 9}
                      imgClassName="max-h-[200px] object-contain"
                    />
                  </div>
                </>
              )}
              {avatarSrc && <button type="button" onClick={() => setAvatarSrc("")} className="text-[10px] uppercase text-red-500 font-bold mt-2 hover:underline">Choose Different Photo</button>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tail Number</label><input type="text" required value={newTail} onChange={e => setNewTail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Serial Num</label><input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Model Name</label><input type="text" required value={newModel} onChange={e => setNewModel(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Type</label><select value={newType} onChange={e => setNewType(e.target.value as any)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white"><option value="Piston">Piston</option><option value="Turbine">Turbine</option></select></div>
            </div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Home Airport</label><input type="text" value={newHomeAirport} onChange={e => setNewHomeAirport(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none bg-white" placeholder="ICAO" /></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Main Contact</label><input type="text" value={newMainContact} onChange={e => setNewMainContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Phone</label><input type="tel" value={newMainContactPhone} onChange={e => setNewMainContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label><input type="email" value={newMainContactEmail} onChange={e => setNewMainContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Contact</label><input type="text" value={newMxContact} onChange={e => setNewMxContact(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Phone</label><input type="tel" value={newMxContactPhone} onChange={e => setNewMxContactPhone(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Email</label><input type="email" value={newMxContactEmail} onChange={e => setNewMxContactEmail(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'} (Opt)</label><input type="number" inputMode="decimal" step="0.1" value={newAirframeTime} onChange={e => setNewAirframeTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" placeholder={`Leave blank if no ${newType === 'Turbine' ? 'AFTT' : 'Hobbs'} meter`} /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Current {newType === 'Turbine' ? 'FTT' : 'Tach'} *</label><input type="number" inputMode="decimal" step="0.1" required value={newEngineTime} onChange={e => setNewEngineTime(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none bg-white" /></div>
            </div>
            <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Save and start using Skyward"}</PrimaryButton></div>
          </form>
        </div>
      </div>
    </div>
  );
}
