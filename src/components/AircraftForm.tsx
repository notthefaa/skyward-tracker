"use client";

// =============================================================
// Shared aircraft form body.
//
// Used by:
//   - AircraftModal (modal chrome around it) — both create + edit
//   - PilotOnboarding (full-page chrome around it) — create only
//
// Owns ALL field state internally. Parent provides:
//   - mode + optional initialAircraft (edit prefill)
//   - submission callback that receives an `AircraftFormPayload`
//   - feature flags (showHowardButton, showEquipmentSection,
//     showDocumentsSection)
//   - optional callbacks (onCancel, onHowardSetup)
//
// The form yields a payload object on submit; the parent handles
// every side effect (avatar upload, API create/update, equipment +
// doc uploads). This keeps the form pure-UI and lets each consumer
// own its own business logic without duplicating field state.
//
// Validation lives here so both consumers reject the same bad
// inputs identically (missing tail, missing engine time, malformed
// emails). Time-field locking (edit-with-flight-logs) lives here
// too — parent supplies `hasFlightLogs` and the form disables the
// inputs + adds the info banner.
// =============================================================

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/components/ToastProvider";
import { validateFileSize, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { INPUT_WHITE_BG } from "@/lib/styles";
import type { AircraftWithMetrics } from "@/lib/types";
import { Info, Camera, Upload, Plus, Trash2, ChevronDown, ChevronUp, MessageSquare, FileText } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "@/components/AppButtons";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";
import { compressImage } from "@/lib/imageCompress";
import type { Crop } from "react-image-crop";

const AvatarCropper = dynamic(() => import("@/components/AvatarCropper"), { ssr: false });

const DOC_TYPES = ['POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Registration', 'Airworthiness Certificate', 'Weight and Balance', 'Other'] as const;
type DocType = typeof DOC_TYPES[number];

export interface EquipmentRow {
  name: string;
  make: string;
  serial: string;
}

export interface DocFile {
  file: File;
  docType: string;
}

export interface AircraftFormPayload {
  tailNumber: string;
  serialNumber: string;
  make: string;
  typeCertificate: string;
  aircraftType: string; // model name
  engineType: 'Piston' | 'Turbine';
  homeAirport: string;
  timeZone: string;
  isIfrEquipped: boolean;
  mainContact: string;
  mainContactPhone: string;
  mainContactEmail: string;
  mxContact: string;
  mxContactPhone: string;
  mxContactEmail: string;
  airframeTimeRaw: string; // raw input value — parent parseFloat's
  engineTimeRaw: string;
  /** Resolves to the cropped JPEG, or null if no new avatar selected. */
  getCroppedAvatar: () => Promise<File | null>;
  /** True when the user picked a new image during this form session. */
  avatarChanged: boolean;
  /** Only meaningful when showEquipmentSection=true. */
  equipmentRows: EquipmentRow[];
  /** Only meaningful when showDocumentsSection=true. */
  docFiles: DocFile[];
}

export interface AircraftFormProps {
  mode: 'create' | 'edit';
  /** Required for edit mode; ignored otherwise. */
  initialAircraft?: AircraftWithMetrics | null;
  /** Edit mode: locks time fields when the aircraft has at least one
   *  flight log (totals self-derive from those logs going forward). */
  hasFlightLogs?: boolean;
  /** Render the "Set up with Howard" button above the form. */
  showHowardButton?: boolean;
  /** Optional collapsible equipment section. Defaults to mode==='create'. */
  showEquipmentSection?: boolean;
  /** Optional collapsible documents section. Defaults to mode==='create'. */
  showDocumentsSection?: boolean;
  onSubmit: (payload: AircraftFormPayload) => Promise<void>;
  onCancel?: () => void;
  /** Wires the Howard handoff button at the top (close form, open chat). */
  onHowardSetup?: () => void;
  /** Default: "Save Aircraft" (edit/modal) / "Save and start using Skyward" (create/onboarding). */
  submitLabel?: string;
  submittingLabel?: string;
}

const TIME_ZONES: Array<{ value: string; label: string }> = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AircraftForm(props: AircraftFormProps) {
  const {
    mode,
    initialAircraft,
    hasFlightLogs = false,
    showHowardButton = false,
    showEquipmentSection,
    showDocumentsSection,
    onSubmit,
    onCancel,
    onHowardSetup,
    submitLabel,
    submittingLabel,
  } = props;
  const isEditing = mode === 'edit';
  const { showError, showWarning } = useToast();

  // Default the optional sections to "show on create, hide on edit" —
  // matches AircraftModal's existing behavior (those sections are
  // create-only because edit has dedicated Equipment / Documents tabs).
  const renderEquipmentSection = showEquipmentSection ?? (mode === 'create');
  const renderDocumentsSection = showDocumentsSection ?? (mode === 'create');

  // ── Field state ────────────────────────────────────────────
  const [newTail, setNewTail] = useState(initialAircraft?.tail_number || "");
  const [newSerial, setNewSerial] = useState(initialAircraft?.serial_number || "");
  const [newMake, setNewMake] = useState(initialAircraft?.make || "");
  const [newTypeCert, setNewTypeCert] = useState(initialAircraft?.type_certificate || "");
  const [newModel, setNewModel] = useState(initialAircraft?.aircraft_type || "");
  const [newType, setNewType] = useState<'Piston' | 'Turbine'>(initialAircraft?.engine_type || 'Piston');
  const [newAirframeTime, setNewAirframeTime] = useState<string>(() => {
    if (!initialAircraft) return "";
    if (initialAircraft.engine_type === 'Turbine') {
      return initialAircraft.setup_aftt != null ? String(initialAircraft.setup_aftt) : "";
    }
    return initialAircraft.setup_hobbs != null ? String(initialAircraft.setup_hobbs) : "";
  });
  const [newEngineTime, setNewEngineTime] = useState<string>(() => {
    if (!initialAircraft) return "";
    if (initialAircraft.engine_type === 'Turbine') {
      return initialAircraft.setup_ftt != null
        ? String(initialAircraft.setup_ftt)
        : String(initialAircraft.total_engine_time || "");
    }
    return initialAircraft.setup_tach != null
      ? String(initialAircraft.setup_tach)
      : String(initialAircraft.total_engine_time || "");
  });
  const [newHomeAirport, setNewHomeAirport] = useState(initialAircraft?.home_airport || "");
  // For new aircraft, default to the browser's resolved timezone so
  // MX reminders + "today" checks fire at the pilot's local cutover,
  // not UTC midnight. Edit mode preserves the stored value.
  const [newTimeZone, setNewTimeZone] = useState<string>(() => {
    if (initialAircraft?.time_zone) return initialAircraft.time_zone;
    if (typeof Intl === 'undefined') return 'UTC';
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [newMainContact, setNewMainContact] = useState(initialAircraft?.main_contact || "");
  const [newMainContactPhone, setNewMainContactPhone] = useState(initialAircraft?.main_contact_phone || "");
  const [newMainContactEmail, setNewMainContactEmail] = useState(initialAircraft?.main_contact_email || "");
  const [newMxContact, setNewMxContact] = useState(initialAircraft?.mx_contact || "");
  const [newMxContactPhone, setNewMxContactPhone] = useState(initialAircraft?.mx_contact_phone || "");
  const [newMxContactEmail, setNewMxContactEmail] = useState(initialAircraft?.mx_contact_email || "");
  const [newIsIfrEquipped, setNewIsIfrEquipped] = useState<boolean>(!!initialAircraft?.is_ifr_equipped);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Avatar state. avatarSrc is a data URL while cropping; cleared when
  // the user picks "Choose Different Photo". imageRef points at the
  // <img> the cropper renders so canvas can read the source dimensions.
  const [avatarSrc, setAvatarSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>({ unit: '%', width: 100, height: 56.25, x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Equipment + Documents (create-only by default).
  const [equipmentRows, setEquipmentRows] = useState<EquipmentRow[]>([]);
  const [showEquipment, setShowEquipment] = useState(false);
  const addEquipmentRow = () => setEquipmentRows(prev => [...prev, { name: '', make: '', serial: '' }]);
  const removeEquipmentRow = (i: number) => setEquipmentRows(prev => prev.filter((_, idx) => idx !== i));
  const updateEquipmentRow = (i: number, field: keyof EquipmentRow, value: string) => {
    setEquipmentRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  const [showDocuments, setShowDocuments] = useState(false);
  const [docFiles, setDocFiles] = useState<DocFile[]>([]);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Re-prefill on initialAircraft change (modal reopens for a different aircraft).
  useEffect(() => {
    if (!initialAircraft) return;
    setNewTail(initialAircraft.tail_number);
    setNewSerial(initialAircraft.serial_number || "");
    setNewMake(initialAircraft.make || "");
    setNewTypeCert(initialAircraft.type_certificate || "");
    setNewModel(initialAircraft.aircraft_type);
    setNewType(initialAircraft.engine_type);
    if (initialAircraft.engine_type === 'Turbine') {
      setNewAirframeTime(initialAircraft.setup_aftt != null ? String(initialAircraft.setup_aftt) : "");
      setNewEngineTime(initialAircraft.setup_ftt != null ? String(initialAircraft.setup_ftt) : String(initialAircraft.total_engine_time || ""));
    } else {
      setNewAirframeTime(initialAircraft.setup_hobbs != null ? String(initialAircraft.setup_hobbs) : "");
      setNewEngineTime(initialAircraft.setup_tach != null ? String(initialAircraft.setup_tach) : String(initialAircraft.total_engine_time || ""));
    }
    setNewHomeAirport(initialAircraft.home_airport || "");
    setNewTimeZone(initialAircraft.time_zone || "UTC");
    setNewMainContact(initialAircraft.main_contact || "");
    setNewMainContactPhone(initialAircraft.main_contact_phone || "");
    setNewMainContactEmail(initialAircraft.main_contact_email || "");
    setNewMxContact(initialAircraft.mx_contact || "");
    setNewMxContactPhone(initialAircraft.mx_contact_phone || "");
    setNewMxContactEmail(initialAircraft.mx_contact_email || "");
    setNewIsIfrEquipped(!!initialAircraft.is_ifr_equipped);
  }, [initialAircraft]);

  // ── Avatar handling ────────────────────────────────────────
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
      canvas.height,
    );
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg'),
    );
    if (!blob) return null;
    const raw = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    // Compress so the upload races against UPLOAD_TIMEOUT_MS cleanly
    // even on cellular — same defaults the modal used.
    try {
      return await compressImage(raw, { maxSizeMB: 0.2, maxWidthOrHeight: 800, useWebWorker: true });
    } catch {
      return raw; // fall back to uncompressed if compress lib fails
    }
  };

  // ── Derived time-field state ───────────────────────────────
  const timeFieldsLocked = isEditing && hasFlightLogs;
  const airframeMeterMissing = isEditing && initialAircraft != null && (
    newType === 'Turbine'
      ? (initialAircraft.setup_aftt == null)
      : (initialAircraft.setup_hobbs == null)
  );

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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

    // Sync state with the values we're actually saving (covers autofill drift).
    if (tailValue !== newTail) setNewTail(tailValue);
    if (modelValue !== newModel) setNewModel(modelValue);

    // Engine time is required: leaving it blank previously coerced to
    // 0 hours and the flight-log derive anchored against 0 forever
    // after. Reject blank/non-finite values up front.
    if (!timeFieldsLocked) {
      const parsedEngineTime = parseFloat(newEngineTime);
      if (newEngineTime.trim() === '' || !Number.isFinite(parsedEngineTime) || parsedEngineTime < 0) {
        showError(newType === 'Turbine'
          ? 'Engine time (FTT) is required. Use 0 only if the aircraft is brand-new.'
          : 'Tach time is required. Use 0 only if the engine is brand-new.');
        return;
      }
    }

    // Contact emails: noValidate disables the browser's `type="email"`
    // format check, so an unguarded "not-an-email" string would land in
    // the row and break MX-reminder sends downstream. Validate here.
    if (newMainContactEmail.trim() && !EMAIL_RE.test(newMainContactEmail.trim())) {
      showError("Main contact email doesn't look right.");
      return;
    }
    if (newMxContactEmail.trim() && !EMAIL_RE.test(newMxContactEmail.trim())) {
      showError("MX contact email doesn't look right.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        tailNumber: tailValue,
        serialNumber: newSerial,
        make: newMake,
        typeCertificate: newTypeCert,
        aircraftType: modelValue,
        engineType: newType,
        homeAirport: newHomeAirport,
        timeZone: newTimeZone,
        isIfrEquipped: newIsIfrEquipped,
        mainContact: newMainContact,
        mainContactPhone: newMainContactPhone,
        mainContactEmail: newMainContactEmail,
        mxContact: newMxContact,
        mxContactPhone: newMxContactPhone,
        mxContactEmail: newMxContactEmail,
        airframeTimeRaw: newAirframeTime,
        engineTimeRaw: newEngineTime,
        getCroppedAvatar: getCroppedImg,
        avatarChanged: !!avatarSrc,
        equipmentRows,
        docFiles,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const effectiveSubmitLabel = submitLabel || (isEditing ? 'Save Aircraft' : 'Save Aircraft');
  const effectiveSubmittingLabel = submittingLabel || 'Saving...';

  return (
    <>
      {/* Howard handoff button — create-mode only, optional. */}
      {showHowardButton && !isEditing && onHowardSetup && (
        <button
          type="button"
          onClick={onHowardSetup}
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

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Avatar dropzone */}
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

        {/* Tail + Serial */}
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

        {/* Make + Type Cert */}
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

        {/* Model + Engine Type */}
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

        {/* Home Airport + Time Zone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Home Airport</label>
            <input type="text" value={newHomeAirport} onChange={e => setNewHomeAirport(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 uppercase focus:border-mxOrange outline-none" placeholder="ICAO" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Time Zone</label>
            {/* Affects server-generated MX-reminder emails and Howard
                airworthiness verdicts when computing "today". Client
                displays already use the pilot's browser TZ. */}
            <select value={newTimeZone} onChange={e => setNewTimeZone(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none">
              {TIME_ZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>
        </div>

        {/* IFR-equipped */}
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

        {/* Main Contact */}
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

        {/* MX Contact */}
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

        {/* Times */}
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

        {/* Equipment section (optional, default create-only) */}
        {renderEquipmentSection && (
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

        {/* Documents section (optional, default create-only) */}
        {renderDocumentsSection && (
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
                    <button
                      type="button"
                      onClick={() => setDocFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-danger p-0.5 shrink-0"
                    >
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
                      setDocFiles(prev => [...prev, ...pdfs.map(f => ({ file: f, docType: 'Other' as DocType }))]);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit (+ optional cancel) */}
        <div className="pt-4 flex gap-3">
          {onCancel && (
            <SecondaryButton
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </SecondaryButton>
          )}
          <div className={onCancel ? 'flex-1' : 'w-full'}>
            <PrimaryButton disabled={isSubmitting}>
              {isSubmitting ? effectiveSubmittingLabel : effectiveSubmitLabel}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </>
  );
}
