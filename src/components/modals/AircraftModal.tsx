"use client";

import { useState, useEffect, useRef } from "react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/components/ToastProvider";
import { validateFileSize, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { friendlyPgError } from "@/lib/pgErrors";
import { INPUT_WHITE_BG } from "@/lib/styles";
import type { AircraftWithMetrics } from "@/lib/types";
import { X, Info, Camera, Upload, Plus, Trash2, ChevronDown, ChevronUp, MessageSquare, FileText } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";
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
  existingAircraft: AircraftWithMetrics | null, 
  onClose: () => void, 
  onSuccess: (newTail: string) => void
}) {
  useModalScrollLock();
  const { showError, showWarning } = useToast();
  const [newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const [newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const [newHomeAirport, setNewHomeAirport] = useState("");
  // IANA timezone for pilot-local date math. Default UTC keeps
  // server-side behavior identical for aircraft that don't set it.
  const [newTimeZone, setNewTimeZone] = useState<string>("UTC");
  const [newMainContact, setNewMainContact] = useState("");
  const [newMainContactPhone, setNewMainContactPhone] = useState(""); 
  const [newMainContactEmail, setNewMainContactEmail] = useState(""); 
  const [newMxContact, setNewMxContact] = useState("");
  const [newMxContactPhone, setNewMxContactPhone] = useState("");
  const [newMxContactEmail, setNewMxContactEmail] = useState("");
  const [newIsIfrEquipped, setNewIsIfrEquipped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Track whether the aircraft has flight logs (affects time field editability)
  const [hasFlightLogs, setHasFlightLogs] = useState(false);

  // ── Equipment rows (optional, only for new aircraft) ───
  type EquipmentRow = { name: string; make: string; serial: string };
  const [equipmentRows, setEquipmentRows] = useState<EquipmentRow[]>([]);
  const [showEquipment, setShowEquipment] = useState(false);
  const addEquipmentRow = () => setEquipmentRows(prev => [...prev, { name: '', make: '', serial: '' }]);
  const removeEquipmentRow = (i: number) => setEquipmentRows(prev => prev.filter((_, idx) => idx !== i));
  const updateEquipmentRow = (i: number, field: keyof EquipmentRow, value: string) => {
    setEquipmentRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  // ── Document uploads (optional, only for new aircraft) ───
  const DOC_TYPES = ['POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Registration', 'Airworthiness Certificate', 'Weight and Balance', 'Other'] as const;
  const [showDocuments, setShowDocuments] = useState(false);
  const [docFiles, setDocFiles] = useState<Array<{ file: File; docType: string }>>([]);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existingAircraft) {
      setNewTail(existingAircraft.tail_number); 
      setNewSerial(existingAircraft.serial_number || ""); 
      setNewModel(existingAircraft.aircraft_type); 
      setNewType(existingAircraft.engine_type); 

      if (existingAircraft.engine_type === 'Turbine') {
        setNewAirframeTime(existingAircraft.setup_aftt != null ? String(existingAircraft.setup_aftt) : "");
        setNewEngineTime(existingAircraft.setup_ftt != null ? String(existingAircraft.setup_ftt) : String(existingAircraft.total_engine_time || ""));
      } else {
        setNewAirframeTime(existingAircraft.setup_hobbs != null ? String(existingAircraft.setup_hobbs) : "");
        setNewEngineTime(existingAircraft.setup_tach != null ? String(existingAircraft.setup_tach) : String(existingAircraft.total_engine_time || ""));
      }

      setNewHomeAirport(existingAircraft.home_airport || "");
      setNewTimeZone(existingAircraft.time_zone || "UTC");
      setNewMainContact(existingAircraft.main_contact || ""); 
      setNewMainContactPhone(existingAircraft.main_contact_phone || ""); 
      setNewMainContactEmail(existingAircraft.main_contact_email || ""); 
      setNewMxContact(existingAircraft.mx_contact || "");
      setNewMxContactPhone(existingAircraft.mx_contact_phone || "");
      setNewMxContactEmail(existingAircraft.mx_contact_email || "");
      setNewIsIfrEquipped(!!existingAircraft.is_ifr_equipped);

      // Check if flight logs exist for this aircraft
      checkForFlightLogs(existingAircraft.id);
    }
  }, [existingAircraft]);

  const checkForFlightLogs = async (aircraftId: string) => {
    const { count } = await supabase
      .from('aft_flight_logs')
      .select('id', { count: 'exact', head: true })
      .eq('aircraft_id', aircraftId);
    setHasFlightLogs((count || 0) > 0);
  };

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
          console.error('Avatar upload failed:', err); 
          showWarning("Photo upload didn't work. Aircraft saved without it — you can add a photo later.");
        }
      }
    }

    const basePayload: Record<string, any> = {
      tail_number: newTail.toUpperCase(),
      serial_number: newSerial,
      aircraft_type: newModel,
      engine_type: newType,
      home_airport: newHomeAirport,
      time_zone: newTimeZone || 'UTC',
      main_contact: newMainContact,
      main_contact_phone: newMainContactPhone,
      main_contact_email: newMainContactEmail,
      mx_contact: newMxContact,
      mx_contact_phone: newMxContactPhone,
      mx_contact_email: newMxContactEmail,
      is_ifr_equipped: newIsIfrEquipped,
      avatar_url: avatarUrl
    };
    
    if (existingAircraft) {
      const newSetupAirframe = newAirframeTime !== '' ? parseFloat(newAirframeTime) : null;
      const newSetupEngine = parseFloat(newEngineTime) || 0;

      Object.assign(basePayload, {
        setup_aftt: newType === 'Turbine' ? newSetupAirframe : null,
        setup_ftt: newType === 'Turbine' ? newSetupEngine : null,
        setup_hobbs: newType === 'Piston' ? newSetupAirframe : null,
        setup_tach: newType === 'Piston' ? newSetupEngine : null,
      });

      if (hasFlightLogs) {
        // Flight logs exist — the latest log holds the true current times.
        // Setup changes don't affect totals when there's real flight data.
        const { data: latestLog } = await supabase
          .from('aft_flight_logs')
          .select('aftt, ftt, hobbs, tach')
          .eq('aircraft_id', existingAircraft.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (latestLog && latestLog.length > 0) {
          const log = latestLog[0] as any;
          if (newType === 'Turbine') {
            basePayload.total_airframe_time = newSetupAirframe != null
              ? (log.aftt != null ? log.aftt : newSetupAirframe)
              : (log.ftt ?? existingAircraft.total_engine_time ?? 0);
            basePayload.total_engine_time = log.ftt ?? existingAircraft.total_engine_time ?? 0;
          } else {
            basePayload.total_airframe_time = newSetupAirframe != null
              ? (log.hobbs != null ? log.hobbs : newSetupAirframe)
              : (log.tach ?? existingAircraft.total_engine_time ?? 0);
            basePayload.total_engine_time = log.tach ?? existingAircraft.total_engine_time ?? 0;
          }
        }
      } else {
        // No flight logs — setup values are the starting point, so totals = setup.
        // If no airframe meter, airframe time tracks the engine time.
        basePayload.total_airframe_time = newSetupAirframe != null ? newSetupAirframe : newSetupEngine;
        basePayload.total_engine_time = newSetupEngine;
      }

      const { error: updateError } = await supabase.from('aft_aircraft').update(basePayload).eq('id', existingAircraft.id);
      if (updateError) {
        console.error('[AircraftModal] Update failed:', updateError);
        showError("Couldn't update the aircraft: " + friendlyPgError(updateError));
        setIsSubmitting(false);
        return;
      }
    } else {
      const setupAirframe = newAirframeTime !== '' ? parseFloat(newAirframeTime) : null;
      const setupEngine = parseFloat(newEngineTime) || 0;

      Object.assign(basePayload, {
        total_airframe_time: setupAirframe != null ? setupAirframe : setupEngine,
        total_engine_time: setupEngine,
        setup_aftt: newType === 'Turbine' ? setupAirframe : null,
        setup_ftt: newType === 'Turbine' ? setupEngine : null,
        setup_hobbs: newType === 'Piston' ? setupAirframe : null,
        setup_tach: newType === 'Piston' ? setupEngine : null,
        created_by: session.user.id
      });

      let newAircraftId: string | null = null;
      try {
        const res = await authFetch('/api/aircraft/create', {
          method: 'POST',
          body: JSON.stringify({ payload: basePayload })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Couldn't create the aircraft.");
        }
        const result = await res.json();
        newAircraftId = result.aircraft?.id || null;
      } catch (err: any) {
        showError(err.message);
        setIsSubmitting(false);
        return;
      }

      // ── Save equipment rows (best-effort after aircraft create) ──
      if (newAircraftId && equipmentRows.length > 0) {
        const validRows = equipmentRows.filter(r => r.name.trim());
        if (validRows.length > 0) {
          try {
            const res = await authFetch('/api/equipment', {
              method: 'POST',
              body: JSON.stringify({
                aircraftId: newAircraftId,
                bulk: validRows.map(r => ({
                  name: r.name.trim(),
                  category: 'avionics',
                  make: r.make.trim() || null,
                  serial: r.serial.trim() || null,
                })),
              }),
            });
            if (!res.ok) showWarning('Aircraft saved but some equipment failed to save.');
          } catch {
            showWarning('Aircraft saved but equipment entries could not be saved.');
          }
        }
      }

      // ── Upload documents (best-effort after aircraft create) ──
      if (newAircraftId && docFiles.length > 0) {
        setIsUploadingDocs(true);
        let uploadFailed = 0;
        for (const df of docFiles) {
          try {
            const formData = new FormData();
            formData.append('file', df.file);
            formData.append('aircraftId', newAircraftId);
            formData.append('docType', df.docType);
            const res = await authFetch('/api/documents', { method: 'POST', body: formData });
            if (!res.ok) uploadFailed++;
          } catch {
            uploadFailed++;
          }
        }
        setIsUploadingDocs(false);
        if (uploadFailed > 0) showWarning(`Aircraft saved. ${uploadFailed} document(s) failed to upload — you can retry from the Documents tab.`);
      }
    }

    onSuccess(newTail.toUpperCase());
    setIsSubmitting(false);
  };

  const isEditing = !!existingAircraft;
  const timeFieldsLocked = isEditing && hasFlightLogs;
  const airframeMeterMissing = isEditing && existingAircraft != null && (
    newType === 'Turbine'
      ? (existingAircraft.setup_aftt == null)
      : (existingAircraft.setup_hobbs == null)
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#F08B46] animate-slide-up">
        
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-oswald text-2xl font-bold uppercase text-[#1B4869]">
            {isEditing ? 'Edit Aircraft' : 'Add Aircraft'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors">
            <X size={24}/>
          </button>
        </div>

        {/* "Set up with Howard" — only on new aircraft, above the form.
            Opens the launcher popup with a pre-seeded prompt for
            aircraft setup. Howard can gather info conversationally. */}
        {!isEditing && (
          <button
            type="button"
            onClick={() => {
              onClose();
              try {
                sessionStorage.setItem(
                  'aft_howard_prefill',
                  JSON.stringify({
                    prompt: "I want to add a new aircraft to my fleet. Walk me through it.",
                    autoSend: true,
                    followUps: [
                      { label: 'Equipment setup', prompt: "Help me add the installed equipment on this aircraft." },
                      { label: 'Upload documents', prompt: "What documents should I upload for this aircraft?" },
                    ],
                    kind: null,
                  })
                );
              } catch {}
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('aft:navigate-howard'));
              }, 100);
            }}
            className="w-full mb-4 flex items-center gap-3 bg-[#e6651b]/5 hover:bg-[#e6651b]/10 border border-[#e6651b]/30 rounded-lg px-4 py-3 active:scale-[0.98] transition-colors"
          >
            <div className="w-9 h-9 rounded-full overflow-hidden border border-[#e6651b]/30 shrink-0">
              <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Set up with Howard</p>
              <p className="text-[10px] font-roboto text-gray-500 leading-snug">Chat through it — Howard asks the right questions</p>
            </div>
            <MessageSquare size={16} className="text-[#e6651b] shrink-0" />
          </button>
        )}
        
        <form onSubmit={handleSaveAircraft} className="space-y-4">
          <div
            className={`border-2 border-dashed rounded p-4 text-center transition-colors ${isDragging ? 'border-[#F08B46] bg-orange-50' : 'border-gray-300 bg-gray-50'} ${!avatarSrc ? 'cursor-pointer' : ''}`}
            onDragOver={e => { e.preventDefault(); if (!avatarSrc) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={!avatarSrc ? onDrop : undefined}
            onClick={() => { if (!avatarSrc) fileInputRef.current?.click(); }}
          >
            {!avatarSrc ? (
              <>
                <Camera size={32} className="mx-auto text-gray-400 mb-2" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-1">
                  Add Aircraft Photo
                </p>
                <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1">
                  <Upload size={10} /> Click or drag & drop (Max {MAX_UPLOAD_SIZE_LABEL})
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onSelectFile}
                  className="hidden"
                />
              </>
            ) : (
              <>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">
                  Adjust Photo Alignment
                </label>
                <div className="w-full flex justify-center bg-black rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={16 / 9}>
                    <img ref={imageRef} src={avatarSrc} alt="Crop preview" className="max-h-[200px] object-contain" />
                  </ReactCrop>
                </div>
              </>
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
              <input type="text" required value={newTail} onChange={e => setNewTail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Serial Num</label>
              <input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Model Name</label>
              <input type="text" required value={newModel} onChange={e => setNewModel(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Engine Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value as 'Piston'|'Turbine')} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none">
                <option value="Piston">Piston</option>
                <option value="Turbine">Turbine</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Home Airport</label>
              <input type="text" value={newHomeAirport} onChange={e => setNewHomeAirport(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-[#F08B46] outline-none" placeholder="ICAO" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Time Zone</label>
              {/* Affects how server-generated MX-reminder emails and
                  Howard airworthiness verdicts compute "today". Client
                  displays already use the pilot's browser TZ. */}
              <select value={newTimeZone} onChange={e => setNewTimeZone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none">
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern (New York)</option>
                <option value="America/Chicago">Central (Chicago)</option>
                <option value="America/Denver">Mountain (Denver)</option>
                <option value="America/Phoenix">Arizona (no DST)</option>
                <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                <option value="America/Anchorage">Alaska</option>
                <option value="Pacific/Honolulu">Hawaii</option>
                <option value="America/Toronto">Eastern (Toronto)</option>
                <option value="America/Vancouver">Pacific (Vancouver)</option>
                <option value="America/Mexico_City">Mexico City</option>
                <option value="Europe/London">London</option>
                <option value="Europe/Paris">Central Europe (Paris)</option>
                <option value="Asia/Tokyo">Tokyo</option>
                <option value="Australia/Sydney">Sydney</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer group bg-gray-50 border border-gray-200 rounded p-3">
            <input
              type="checkbox"
              checked={newIsIfrEquipped}
              onChange={e => setNewIsIfrEquipped(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-[#F08B46] focus:ring-[#F08B46] cursor-pointer mt-0.5 shrink-0"
            />
            <div>
              <span className="text-xs font-bold text-navy block group-hover:text-[#F08B46] transition-colors">
                IFR-equipped
              </span>
              <span className="text-[10px] text-gray-500 leading-tight">
                Certified for instrument flight (pitot-static + transponder + altimeter current, IFR GPS/nav installed). Howard uses this to shape briefings.
              </span>
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Main Contact</label>
              <input type="text" value={newMainContact} onChange={e => setNewMainContact(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Phone</label>
              <input type="tel" value={newMainContactPhone} onChange={e => setNewMainContactPhone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">Email</label>
              <input type="email" value={newMainContactEmail} onChange={e => setNewMainContactEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Contact</label>
              <input type="text" value={newMxContact} onChange={e => setNewMxContact(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Phone</label>
              <input type="tel" value={newMxContactPhone} onChange={e => setNewMxContactPhone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">MX Email</label>
              <input type="email" value={newMxContactEmail} onChange={e => setNewMxContactEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                {timeFieldsLocked && !airframeMeterMissing ? 'Setup' : 'Current'} {newType === 'Turbine' ? 'AFTT' : 'Hobbs'} (Opt)
              </label>
              <input
                type="number"
                step="0.1"
                value={newAirframeTime}
                onChange={e => setNewAirframeTime(e.target.value)}
                disabled={timeFieldsLocked && !airframeMeterMissing}
                style={INPUT_WHITE_BG}
                className={`w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none ${timeFieldsLocked && !airframeMeterMissing ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                placeholder={airframeMeterMissing ? `No ${newType === 'Turbine' ? 'AFTT' : 'Hobbs'} meter — leave blank or add one` : ''}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869]">
                {timeFieldsLocked ? 'Setup' : 'Current'} {newType === 'Turbine' ? 'FTT' : 'Tach'} *
              </label>
              <input
                type="number"
                step="0.1"
                required={!timeFieldsLocked}
                value={newEngineTime}
                onChange={e => setNewEngineTime(e.target.value)}
                disabled={timeFieldsLocked}
                style={INPUT_WHITE_BG}
                className={`w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none ${timeFieldsLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
              />
            </div>
            {timeFieldsLocked && (
              <div className="col-span-2 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded p-3">
                <Info size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" />
                <p className="text-[10px] text-gray-600 leading-tight">
                  {airframeMeterMissing
                    ? `This aircraft has no ${newType === 'Turbine' ? 'AFTT' : 'Hobbs'} meter. You can add one by entering the current reading above — flight logs will use it going forward.`
                    : 'Current times are driven by flight logs and cannot be edited here. The setup values above are preserved as your initial baseline. To correct current times, edit or delete the latest flight log from the Times tab.'}
                </p>
              </div>
            )}
          </div>

          {/* ── EQUIPMENT SECTION (new aircraft only) ─────────── */}
          {!isEditing && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <button
                type="button"
                onClick={() => setShowEquipment(!showEquipment)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Equipment & Avionics</span>
                  <span className="text-[10px] text-gray-500 block">Optional — add installed equipment now or later</span>
                </div>
                {showEquipment ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>

              {showEquipment && (
                <div className="mt-3 space-y-2">
                  {equipmentRows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          placeholder="Name *"
                          value={row.name}
                          onChange={e => updateEquipmentRow(i, 'name', e.target.value)}
                          style={INPUT_WHITE_BG}
                          className="border border-gray-300 rounded p-2 text-xs focus:border-[#F08B46] outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Manufacturer"
                          value={row.make}
                          onChange={e => updateEquipmentRow(i, 'make', e.target.value)}
                          style={INPUT_WHITE_BG}
                          className="border border-gray-300 rounded p-2 text-xs focus:border-[#F08B46] outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Serial"
                          value={row.serial}
                          onChange={e => updateEquipmentRow(i, 'serial', e.target.value)}
                          style={INPUT_WHITE_BG}
                          className="border border-gray-300 rounded p-2 text-xs focus:border-[#F08B46] outline-none"
                        />
                      </div>
                      <button type="button" onClick={() => removeEquipmentRow(i)} className="text-gray-400 hover:text-[#CE3732] p-1 mt-1 shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEquipmentRow}
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#3AB0FF] hover:text-[#0EA5E9] active:scale-95 py-1"
                  >
                    <Plus size={12} /> Add equipment
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── DOCUMENTS SECTION (new aircraft only) ─────────── */}
          {!isEditing && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <button
                type="button"
                onClick={() => setShowDocuments(!showDocuments)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <span className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Documents</span>
                  <span className="text-[10px] text-gray-500 block">Optional — upload POH, registration, W&B, etc.</span>
                </div>
                {showDocuments ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>

              {showDocuments && (
                <div className="mt-3 space-y-2">
                  {docFiles.map((df, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2">
                      <FileText size={14} className="text-[#56B94A] shrink-0" />
                      <span className="text-xs text-navy truncate flex-1">{df.file.name}</span>
                      <select
                        value={df.docType}
                        onChange={e => setDocFiles(prev => prev.map((d, idx) => idx === i ? { ...d, docType: e.target.value } : d))}
                        className="text-[10px] border border-gray-300 rounded px-2 py-1 bg-white focus:border-[#F08B46] outline-none"
                      >
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button type="button" onClick={() => setDocFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-[#CE3732] p-0.5 shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <div
                    className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition-colors ${docFiles.length > 0 ? 'border-gray-200' : 'border-gray-300'} hover:border-[#56B94A] hover:bg-green-50`}
                    onClick={() => docInputRef.current?.click()}
                  >
                    <Upload size={16} className="mx-auto text-gray-400 mb-1" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-navy">Add PDF</p>
                    <p className="text-[9px] text-gray-400">Max 20MB per file</p>
                    <input
                      ref={docInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const pdfs = files.filter(f => f.type === 'application/pdf' && f.size <= 20 * 1024 * 1024);
                        if (pdfs.length < files.length) showWarning('Some files were skipped (only PDFs under 20MB accepted).');
                        setDocFiles(prev => [...prev, ...pdfs.map(f => ({ file: f, docType: 'Other' as string }))]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-4">
            <PrimaryButton disabled={isSubmitting || isUploadingDocs}>
              {isUploadingDocs ? "Uploading documents..." : isSubmitting ? "Saving..." : "Save Aircraft"}
            </PrimaryButton>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
