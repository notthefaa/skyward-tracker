"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { X } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";
import ReactCrop, { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

export default function AircraftModal({ 
  session, 
  existingAircraft, 
  onClose, 
  onSuccess 
}: { 
  session: any, 
  existingAircraft: any | null, 
  onClose: () => void, 
  onSuccess: (newTail: string) => void 
}) {
  const [newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newModel, setNewModel] = useState("");
  const[newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const[newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const[newHomeAirport, setNewHomeAirport] = useState("");
  const[newMainContact, setNewMainContact] = useState("");
  const[newMainContactPhone, setNewMainContactPhone] = useState(""); 
  const[newMainContactEmail, setNewMainContactEmail] = useState(""); 
  const[newMxContact, setNewMxContact] = useState(""); 
  const [newMxContactPhone, setNewMxContactPhone] = useState(""); 
  const[newMxContactEmail, setNewMxContactEmail] = useState(""); 
  const[isSubmitting, setIsSubmitting] = useState(false);

  const [avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  // Pre-fill form if editing
  useEffect(() => {
    if (existingAircraft) {
      setNewTail(existingAircraft.tail_number); 
      setNewSerial(existingAircraft.serial_number || ""); 
      setNewModel(existingAircraft.aircraft_type); 
      setNewType(existingAircraft.engine_type); 

      if (existingAircraft.engine_type === 'Turbine') {
        setNewAirframeTime(existingAircraft.setup_aftt !== null && existingAircraft.setup_aftt !== undefined ? existingAircraft.setup_aftt : (existingAircraft.total_airframe_time || ""));
        setNewEngineTime(existingAircraft.setup_ftt !== null && existingAircraft.setup_ftt !== undefined ? existingAircraft.setup_ftt : (existingAircraft.total_engine_time || ""));
      } else {
        setNewAirframeTime(existingAircraft.setup_hobbs !== null && existingAircraft.setup_hobbs !== undefined ? existingAircraft.setup_hobbs : (existingAircraft.total_airframe_time || ""));
        setNewEngineTime(existingAircraft.setup_tach !== null && existingAircraft.setup_tach !== undefined ? existingAircraft.setup_tach : (existingAircraft.total_engine_time || ""));
      }

      setNewHomeAirport(existingAircraft.home_airport || ""); 
      setNewMainContact(existingAircraft.main_contact || ""); 
      setNewMainContactPhone(existingAircraft.main_contact_phone || ""); 
      setNewMainContactEmail(existingAircraft.main_contact_email || ""); 
      setNewMxContact(existingAircraft.mx_contact || ""); 
      setNewMxContactPhone(existingAircraft.mx_contact_phone || ""); 
      setNewMxContactEmail(existingAircraft.mx_contact_email || ""); 
    }
  }, [existingAircraft]);

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

  const handleSaveAircraft = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsSubmitting(true);
    let avatarUrl = existingAircraft?.avatar_url || null;

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
          console.error(err); 
        }
      }
    }

    const basePayload: any = { 
      tail_number: newTail.toUpperCase(), 
      serial_number: newSerial, 
      aircraft_type: newModel, 
      engine_type: newType, 
      home_airport: newHomeAirport, 
      main_contact: newMainContact, 
      main_contact_phone: newMainContactPhone, 
      main_contact_email: newMainContactEmail, 
      mx_contact: newMxContact, 
      mx_contact_phone: newMxContactPhone, 
      mx_contact_email: newMxContactEmail, 
      avatar_url: avatarUrl
    };
    
    if (existingAircraft) {
      Object.assign(basePayload, {
        setup_aftt: newType === 'Turbine' ? (parseFloat(newAirframeTime) || 0) : 0,
        setup_ftt: newType === 'Turbine' ? (parseFloat(newEngineTime) || 0) : 0,
        setup_hobbs: newType === 'Piston' ? (parseFloat(newAirframeTime) || 0) : 0,
        setup_tach: newType === 'Piston' ? (parseFloat(newEngineTime) || 0) : 0,
      });
      await supabase.from('aft_aircraft').update(basePayload).eq('id', existingAircraft.id);
    } else {
      Object.assign(basePayload, {
        total_airframe_time: parseFloat(newAirframeTime) || 0,
        total_engine_time: parseFloat(newEngineTime) || 0,
        setup_aftt: newType === 'Turbine' ? (parseFloat(newAirframeTime) || 0) : 0,
        setup_ftt: newType === 'Turbine' ? (parseFloat(newEngineTime) || 0) : 0,
        setup_hobbs: newType === 'Piston' ? (parseFloat(newAirframeTime) || 0) : 0,
        setup_tach: newType === 'Piston' ? (parseFloat(newEngineTime) || 0) : 0,
        created_by: session.user.id
      });
      await supabase.from('aft_aircraft').insert(basePayload);
    }
    
    onSuccess(newTail.toUpperCase());
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] max-h-[90vh] overflow-y-auto animate-slide-up">
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-oswald text-2xl font-bold uppercase text-[#1B4869]">
            {existingAircraft ? 'Edit Aircraft' : 'Add Aircraft'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors">
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
                className="text-xs text-gray-500 w-full cursor-pointer bg-white" 
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
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Tail Number
              </label>
              <input 
                type="text" 
                required 
                value={newTail} 
                onChange={e => setNewTail(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Serial Num
              </label>
              <input 
                type="text" 
                value={newSerial} 
                onChange={e => setNewSerial(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Model Name
              </label>
              <input 
                type="text" 
                required 
                value={newModel} 
                onChange={e => setNewModel(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Engine Type
              </label>
              <select 
                value={newType} 
                onChange={e => setNewType(e.target.value as 'Piston'|'Turbine')} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white"
              >
                <option value="Piston">Piston</option>
                <option value="Turbine">Turbine</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
              Home Airport
            </label>
            <input 
              type="text" 
              value={newHomeAirport} 
              onChange={e => setNewHomeAirport(e.target.value)} 
              className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none bg-white" 
              placeholder="ICAO" 
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Main Contact
              </label>
              <input 
                type="text" 
                value={newMainContact} 
                onChange={e => setNewMainContact(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Phone
              </label>
              <input 
                type="tel" 
                value={newMainContactPhone} 
                onChange={e => setNewMainContactPhone(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Email
              </label>
              <input 
                type="email" 
                value={newMainContactEmail} 
                onChange={e => setNewMainContactEmail(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                MX Contact
              </label>
              <input 
                type="text" 
                value={newMxContact} 
                onChange={e => setNewMxContact(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                MX Phone
              </label>
              <input 
                type="tel" 
                value={newMxContactPhone} 
                onChange={e => setNewMxContactPhone(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                MX Email
              </label>
              <input 
                type="email" 
                value={newMxContactEmail} 
                onChange={e => setNewMxContactEmail(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Current {newType === 'Turbine' ? 'AFTT' : 'Hobbs'} *
              </label>
              <input 
                type="number" 
                step="0.1" 
                required 
                value={newAirframeTime} 
                onChange={e => setNewAirframeTime(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                Current {newType === 'Turbine' ? 'FTT' : 'Tach'} *
              </label>
              <input 
                type="number" 
                step="0.1" 
                required 
                value={newEngineTime} 
                onChange={e => setNewEngineTime(e.target.value)} 
                className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none bg-white" 
              />
            </div>
          </div>

          <div className="pt-4">
            <PrimaryButton disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Aircraft"}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}