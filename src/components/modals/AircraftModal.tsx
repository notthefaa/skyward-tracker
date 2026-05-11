"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { supabase } from "@/lib/supabase";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { idempotencyHeader } from "@/lib/idempotencyClient";
import { useToast } from "@/components/ToastProvider";
import { validateFileSize, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { friendlyPgError } from "@/lib/pgErrors";
import { INPUT_WHITE_BG } from "@/lib/styles";
import type { AircraftWithMetrics } from "@/lib/types";
import { X, Info, Camera, Upload, Plus, Trash2, ChevronDown, ChevronUp, MessageSquare, FileText } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/AppButtons";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";
import { compressImage } from "@/lib/imageCompress";
import type { Crop } from "react-image-crop";

const AvatarCropper = dynamic(() => import("@/components/AvatarCropper"), { ssr: false });

export default function AircraftModal({ 
  session, 
  existingAircraft, 
  onClose, 
  onSuccess 
}: { 
  session: any, 
  existingAircraft: AircraftWithMetrics | null, 
  onClose: () => void, 
  onSuccess: (newTail: string) => void | Promise<void>
}) {
  useModalScrollLock();
  useEscapeKey(onClose);
  const { showError, showWarning } = useToast();
  const [newTail, setNewTail] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newMake, setNewMake] = useState("");
  const [newTypeCert, setNewTypeCert] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>('Piston');
  const [newAirframeTime, setNewAirframeTime] = useState("");
  const [newEngineTime, setNewEngineTime] = useState("");
  const [newHomeAirport, setNewHomeAirport] = useState("");
  // IANA timezone for pilot-local date math. New aircraft default to
  // the browser's resolved timezone so MX reminders and "today"
  // checks fire at the pilot's local cutover, not at UTC midnight.
  // Falls back to UTC if Intl is unavailable for any reason.
  const [newTimeZone, setNewTimeZone] = useState<string>(() => {
    if (typeof Intl === 'undefined') return 'UTC';
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
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
      setNewMake(existingAircraft.make || "");
      setNewTypeCert(existingAircraft.type_certificate || "");
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

  const handleSaveAircraft = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Read straight from the form's DOM rather than React state. On iOS
    // Safari, autofill / password-manager extensions can write into a
    // controlled input without dispatching the React-recognized event,
    // leaving newTail = "" while the user sees their tail in the field.
    // FormData reflects what's actually in the DOM at submit time.
    const fd = new FormData(e.currentTarget);
    const tailValue = ((fd.get('tail_number') as string) || '').trim();
    const modelValue = ((fd.get('aircraft_type') as string) || '').trim();

    if (!tailValue) {
      showError('Tail number is required.');
      return;
    }
    if (!modelValue) {
      showError('Model name is required.');
      return;
    }

    // Sync state so any subsequent render reflects the value we're
    // actually saving (covers the autofill-drift case above).
    if (tailValue !== newTail) setNewTail(tailValue);
    if (modelValue !== newModel) setNewModel(modelValue);

    // Engine time is required: leaving it blank previously coerced to
    // 0 hours and the flight-log derive anchored against 0 forever
    // after. Reject blank/non-finite values up front.
    const parsedEngineTime = parseFloat(newEngineTime);
    if (newEngineTime.trim() === '' || !Number.isFinite(parsedEngineTime) || parsedEngineTime < 0) {
      showError(newType === 'Turbine'
        ? 'Engine time (FTT) is required. Use 0 only if the aircraft is brand-new.'
        : 'Tach time is required. Use 0 only if the engine is brand-new.');
      return;
    }

    // Contact emails: noValidate disables the browser's `type="email"`
    // format check, so an unguarded "not-an-email" string would land in
    // the row and break MX-reminder sends downstream. Validate here.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (newMainContactEmail.trim() && !EMAIL_RE.test(newMainContactEmail.trim())) {
      showError("Main contact email doesn't look right.");
      return;
    }
    if (newMxContactEmail.trim() && !EMAIL_RE.test(newMxContactEmail.trim())) {
      showError("MX contact email doesn't look right.");
      return;
    }

    setIsSubmitting(true);
    let avatarUrl = existingAircraft?.avatar_url || null;

    if (avatarSrc) {
      const croppedFile = await getCroppedImg();
      if (croppedFile) {
        try {
          const compressed = await compressImage(croppedFile, { maxSizeMB: 0.2, maxWidthOrHeight: 800, useWebWorker: true });
          // Extension + explicit contentType: without these, Supabase
          // serves the object as application/octet-stream, and Firefox's
          // OpaqueResponseBlocking refuses to render it inside <img>.
          const safeTail = tailValue.toUpperCase().replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${safeTail}_${Date.now()}.jpg`;
          const { data } = await supabase.storage.from('aft_aircraft_avatars').upload(fileName, compressed, { contentType: 'image/jpeg' });
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
      tail_number: tailValue.toUpperCase(),
      serial_number: newSerial,
      make: newMake.trim() || null,
      type_certificate: newTypeCert.trim() || null,
      aircraft_type: modelValue,
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
      // Blank engine field is rejected up-front (the validation block
      // earlier in handleSave catches it). parseFloat is safe here.
      const newSetupEngine = parseFloat(newEngineTime);

      Object.assign(basePayload, {
        setup_aftt: newType === 'Turbine' ? newSetupAirframe : null,
        setup_ftt: newType === 'Turbine' ? newSetupEngine : null,
        setup_hobbs: newType === 'Piston' ? newSetupAirframe : null,
        setup_tach: newType === 'Piston' ? newSetupEngine : null,
      });

      if (hasFlightLogs) {
        // Flight logs exist — the latest log holds the true current times.
        // Setup changes don't affect totals when there's real flight data.
        const { data: latestLog, error: latestLogErr } = await supabase
          .from('aft_flight_logs')
          .select('aftt, ftt, hobbs, tach')
          .eq('aircraft_id', existingAircraft.id)
          .is('deleted_at', null)
          .order('occurred_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1);

        // Without this the engine-type switch would silently skip the
        // total-time recompute on a transient failure and ship a save
        // that doesn't reflect actual flight history.
        if (latestLogErr) {
          showError("Couldn't read latest flight log to recompute totals. Try saving again.");
          setIsSubmitting(false);
          return;
        }

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
      const setupEngine = parseFloat(newEngineTime);

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
            // Per-file idempotency key — a retry of the same upload
            // returns the cached document row without re-charging
            // OpenAI embeddings.
            const idemKey = crypto.randomUUID();
            const res = await authFetch('/api/documents', { method: 'POST', body: formData, headers: idempotencyHeader(idemKey), timeoutMs: UPLOAD_TIMEOUT_MS });
            if (!res.ok) uploadFailed++;
          } catch {
            uploadFailed++;
          }
        }
        setIsUploadingDocs(false);
        if (uploadFailed > 0) showWarning(`Aircraft saved. ${uploadFailed} document(s) failed to upload — you can retry from the Documents tab.`);
      }
    }

    // Await onSuccess so the "Saving..." spinner stays through the
    // parent's fleet refetch + activeTail flip. Without the await,
    // the button un-disables and a quick second tap surfaces a
    // duplicate-tail error against the user's own freshly-created
    // aircraft.
    await onSuccess(tailValue.toUpperCase());
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
      <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-mxOrange animate-slide-up">
        
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy">
            {isEditing ? 'Edit Aircraft' : 'Add Aircraft'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-danger transition-colors">
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
                    prompt: "I want to add a new aircraft to my hangar. Walk me through it.",
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
            className="w-full mb-4 flex items-center gap-3 bg-brandOrange/5 hover:bg-brandOrange/10 border border-brandOrange/30 rounded-lg px-4 py-3 active:scale-[0.98] transition-colors"
          >
            <div className="w-9 h-9 rounded-full overflow-hidden border border-brandOrange/30 shrink-0">
              <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="font-oswald text-sm font-bold uppercase tracking-widest text-navy">Set up with Howard</p>
              <p className="text-[10px] font-roboto text-gray-500 leading-snug">Chat through it — Howard asks the right questions</p>
            </div>
            <MessageSquare size={16} className="text-brandOrange shrink-0" />
          </button>
        )}
        
        <form onSubmit={handleSaveAircraft} noValidate className="space-y-4">
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
            {avatarSrc && (
              <button type="button" onClick={() => setAvatarSrc("")} className="text-[10px] uppercase text-red-500 font-bold mt-2 hover:underline">
                Choose Different Photo
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Tail Number</label>
              <input name="tail_number" type="text" required value={newTail} onChange={e => setNewTail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Serial Num</label>
              <input type="text" value={newSerial} onChange={e => setNewSerial(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Make</label>
              <input type="text" value={newMake} onChange={e => setNewMake(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" placeholder="Cessna, Piper, ..." />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Type Cert</label>
              <input type="text" value={newTypeCert} onChange={e => setNewTypeCert(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none" placeholder="A13WE (optional)" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Model Name</label>
              <input name="aircraft_type" type="text" required value={newModel} onChange={e => setNewModel(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Engine Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value as 'Piston'|'Turbine')} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none">
                <option value="Piston">Piston</option>
                <option value="Turbine">Turbine</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Home Airport</label>
              <input type="text" value={newHomeAirport} onChange={e => setNewHomeAirport(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none" placeholder="ICAO" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Time Zone</label>
              {/* Affects how server-generated MX-reminder emails and
                  Howard airworthiness verdicts compute "today". Client
                  displays already use the pilot's browser TZ. */}
              <select value={newTimeZone} onChange={e => setNewTimeZone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none">
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
              className="w-5 h-5 rounded border-gray-300 text-mxOrange focus:ring-mxOrange cursor-pointer mt-0.5 shrink-0"
            />
            <div>
              <span className="text-xs font-bold text-navy block group-hover:text-mxOrange transition-colors">
                IFR-equipped
              </span>
              <span className="text-[10px] text-gray-500 leading-tight">
                Certified for instrument flight (pitot-static + transponder + altimeter current, IFR GPS/nav installed). Howard uses this to shape briefings.
              </span>
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Main Contact</label>
              <input type="text" value={newMainContact} onChange={e => setNewMainContact(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Phone</label>
              <input type="tel" value={newMainContactPhone} onChange={e => setNewMainContactPhone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Email</label>
              <input type="email" value={newMainContactEmail} onChange={e => setNewMainContactEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Contact</label>
              <input type="text" value={newMxContact} onChange={e => setNewMxContact(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Phone</label>
              <input type="tel" value={newMxContactPhone} onChange={e => setNewMxContactPhone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">MX Email</label>
              <input type="email" value={newMxContactEmail} onChange={e => setNewMxContactEmail(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mt-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                {timeFieldsLocked && !airframeMeterMissing ? 'Setup' : 'Current'} {newType === 'Turbine' ? 'AFTT' : 'Hobbs'} (Opt)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={newAirframeTime}
                onChange={e => setNewAirframeTime(e.target.value)}
                disabled={timeFieldsLocked && !airframeMeterMissing}
                style={INPUT_WHITE_BG}
                className={`w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none ${timeFieldsLocked && !airframeMeterMissing ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                placeholder={airframeMeterMissing ? `No ${newType === 'Turbine' ? 'AFTT' : 'Hobbs'} meter — leave blank or add one` : ''}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-navy">
                {timeFieldsLocked ? 'Setup' : 'Current'} {newType === 'Turbine' ? 'FTT' : 'Tach'} *
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                required={!timeFieldsLocked}
                value={newEngineTime}
                onChange={e => setNewEngineTime(e.target.value)}
                disabled={timeFieldsLocked}
                style={INPUT_WHITE_BG}
                className={`w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none ${timeFieldsLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
              />
            </div>
            {timeFieldsLocked && (
              <div className="col-span-2 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded p-3">
                <Info size={16} className="text-info shrink-0 mt-0.5" />
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
                          className="border border-gray-300 rounded p-2 text-xs focus:border-mxOrange outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Manufacturer"
                          value={row.make}
                          onChange={e => updateEquipmentRow(i, 'make', e.target.value)}
                          style={INPUT_WHITE_BG}
                          className="border border-gray-300 rounded p-2 text-xs focus:border-mxOrange outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Serial"
                          value={row.serial}
                          onChange={e => updateEquipmentRow(i, 'serial', e.target.value)}
                          style={INPUT_WHITE_BG}
                          className="border border-gray-300 rounded p-2 text-xs focus:border-mxOrange outline-none"
                        />
                      </div>
                      <button type="button" onClick={() => removeEquipmentRow(i)} className="text-gray-400 hover:text-danger p-1 mt-1 shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEquipmentRow}
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-info hover:text-[#0EA5E9] active:scale-95 py-1"
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
                        className="text-[10px] border border-gray-300 rounded px-2 py-1 bg-white focus:border-mxOrange outline-none"
                      >
                        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button type="button" onClick={() => setDocFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-danger p-0.5 shrink-0">
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

          <div className="pt-4 flex gap-3">
            <SecondaryButton
              onClick={onClose}
              disabled={isSubmitting || isUploadingDocs}
              className="flex-1"
            >
              Cancel
            </SecondaryButton>
            <div className="flex-1">
              <PrimaryButton disabled={isSubmitting || isUploadingDocs}>
                {isUploadingDocs ? "Uploading..." : isSubmitting ? "Saving..." : "Save Aircraft"}
              </PrimaryButton>
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
