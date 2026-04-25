import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { validateFileSizes, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { AlertTriangle, Plus, X, Upload, Mail, MailWarning, Edit2, ChevronLeft, ChevronRight, Download, CheckSquare, Trash2, CheckCircle, Link2, Clock, MapPin, User, Send } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import SignatureCanvas from "react-signature-canvas";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import imageCompression from "browser-image-compression";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { ModalPortal } from "@/components/ModalPortal";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function SquawksTab({ 
  aircraft, session, role, aircraftRole, userInitials, onGroundedStatusChange 
}: { 
  aircraft: AircraftWithMetrics | null, session: any, role: string, aircraftRole: AircraftRole | null, userInitials: string, onGroundedStatusChange: () => void 
}) {
  const { data: squawks = [], mutate } = useSWR(
    aircraft ? swrKeys.squawks(aircraft.id) : null,
    async () => {
      const { data } = await supabase
        .from('aft_squawks').select('*').eq('aircraft_id', aircraft!.id)
        .is('deleted_at', null)
        // occurred_at first so offline-queued squawks (stamped with
        // the pilot's local report time) thread into the timeline
        // correctly; created_at as tiebreaker.
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false });

      const resolved = (data || []).filter((s: any) => s.resolved_by_event_id);
      if (resolved.length > 0) {
        const eventIds = resolved.map((s: any) => s.resolved_by_event_id);
        const { data: events } = await supabase
          .from('aft_maintenance_events')
          .select('id, completed_at, confirmed_date')
          .in('id', eventIds);
        
        if (events) {
          const eventMap: Record<string, any> = {};
          for (const ev of events) { eventMap[ev.id] = ev; }
          for (const sq of (data || [])) {
            if (sq.resolved_by_event_id && eventMap[sq.resolved_by_event_id]) {
              sq._resolving_event = eventMap[sq.resolved_by_event_id];
            }
          }
        }
      }

      return data || [];
    }
  );

  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedForExport, setSelectedForExport] = useState<string[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [visibleArchivedCount, setVisibleArchivedCount] = useState(10);

  const { showSuccess, showError, showWarning } = useToast();
  const resolve = useSignedUrls();
  const confirm = useConfirm();

  // Detail modal state
  const [detailSquawk, setDetailSquawk] = useState<any>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [resolveNote, setResolveNote] = useState("");

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [affectsAirworthiness, setAffectsAirworthiness] = useState(false);
  const [isDeferred, setIsDeferred] = useState(false);
  const [status, setStatus] = useState<'open'|'resolved'>('open');
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [mel, setMel] = useState(""); const [cdl, setCdl] = useState(""); const [nef, setNef] = useState(""); const [mdl, setMdl] = useState("");
  const [melControl, setMelControl] = useState(""); const [category, setCategory] = useState("");
  const [procCompleted, setProcCompleted] = useState(false); const [fullName, setFullName] = useState(""); const [certNum, setCertNum] = useState("");
  const [notifyMx, setNotifyMx] = useState(false);

  // When the pilot switches aircraft, close any open squawk modal
  // and clear per-squawk editing state — otherwise a "Resolve"
  // click in the stale detail view would hit the squawk from the
  // prior aircraft.
  useEffect(() => {
    setShowModal(false);
    setDetailSquawk(null);
    setShowResolveForm(false);
    setResolveNote('');
    setEditingId(null);
    setPreviewImages(null);
    setShowExportModal(false);
    setSelectedForExport([]);
    setResendingId(null);
    setLocation(''); setDescription('');
    setAffectsAirworthiness(false); setIsDeferred(false);
    setStatus('open');
    setSelectedImages([]); setExistingImages([]);
    setMel(''); setCdl(''); setNef(''); setMdl(''); setMelControl(''); setCategory('');
    setProcCompleted(false); setFullName(''); setCertNum('');
    setNotifyMx(false);
  }, [aircraft?.id]);

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const isAdmin = role === 'admin' || aircraftRole === 'admin';

  // ─── Lock body scroll when any modal is open ───
  const anyModalOpen = !!detailSquawk || showModal || showExportModal || !!previewImages;
  useModalScrollLock(anyModalOpen);

  /** Check if the current user can modify a given squawk */
  const canModify = (sq: any) => {
    if (isAdmin) return true;
    return sq.reported_by === session?.user?.id;
  };

  const openDetailModal = (sq: any) => {
    setDetailSquawk(sq);
    setShowResolveForm(false);
    setResolveNote("");
  };

  const closeDetailModal = () => {
    setDetailSquawk(null);
    setShowResolveForm(false);
    setResolveNote("");
  };

  const openForm = (squawk: any = null) => {
    if (squawk) {
      setEditingId(squawk.id); setLocation(squawk.location || ""); setDescription(squawk.description || ""); 
      setAffectsAirworthiness(squawk.affects_airworthiness || false); setIsDeferred(squawk.is_deferred || false); 
      setStatus(squawk.status || 'open'); setExistingImages(squawk.pictures || []); 
      setMel(squawk.mel_number || ""); setCdl(squawk.cdl_number || ""); setNef(squawk.nef_number || ""); setMdl(squawk.mdl_number || ""); 
      setMelControl(squawk.mel_control_number || ""); setCategory(squawk.deferral_category || ""); 
      setProcCompleted(squawk.deferral_procedures_completed || false); setFullName(squawk.full_name || ""); setCertNum(squawk.certificate_number || "");
      setNotifyMx(false);
    } else {
      setEditingId(null); setLocation(""); setDescription(""); setAffectsAirworthiness(false); setIsDeferred(false); 
      setStatus('open'); setExistingImages([]); setSelectedImages([]); 
      setMel(""); setCdl(""); setNef(""); setMdl(""); setMelControl(""); setCategory(""); 
      setProcCompleted(false); setFullName(""); setCertNum(""); setNotifyMx(false);
      if (sigCanvas.current) sigCanvas.current.clear();
    }
    closeDetailModal();
    setShowModal(true);
  };

  const handleImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const sizeError = validateFileSizes(files);
    if (sizeError) { showError(sizeError); e.target.value = ''; return; }
    setSelectedImages(files);
  };

  // Returns both the public URL (for storing in the squawk row) AND the
  // storage path (for undoing the upload if the squawk insert later
  // fails). Tracking the path separately avoids fragile URL parsing in
  // the cleanup path.
  const uploadImages = async (): Promise<{ url: string; path: string }[]> => {
    const uploaded: { url: string; path: string }[] = [];
    const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
    for (const file of selectedImages) {
      try {
        const compressedFile = await imageCompression(file, options);
        const fileName = `${aircraft!.tail_number}_${Date.now()}_${compressedFile.name}`;
        const { data } = await supabase.storage.from('aft_squawk_images').upload(fileName, compressedFile);
        if (data) {
          const { data: publicUrlData } = supabase.storage.from('aft_squawk_images').getPublicUrl(data.path);
          uploaded.push({ url: publicUrlData.publicUrl, path: data.path });
        }
      } catch (error) {
        console.error("Image compression/upload failed:", error);
      }
    }
    return uploaded;
  };

  // Fire-and-forget orphan cleanup. Used when the squawk insert fails
  // after images already landed in storage — without this, the blobs
  // would stay forever with no row referencing them.
  const cleanupUploadedImages = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      await supabase.storage.from('aft_squawk_images').remove(paths);
    } catch (err) {
      // Non-blocking — a future orphan-sweep could still catch these.
      console.error("Failed to clean up orphaned squawk images:", err);
    }
  };

  const submitSquawk = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    // Wrap the whole write in try/catch/finally — prior to this, a
    // failed save left the submit button stuck in "Saving…" forever
    // because the throw skipped over setIsSubmitting(false).
    // Track the freshly-uploaded storage paths so the catch branch
    // can clean them up if the squawk insert fails.
    const uploadedThisSubmit = await uploadImages();
    const uploadedPathsToRollback = uploadedThisSubmit.map(u => u.path);
    try {
      const allPictures = [...existingImages, ...uploadedThisSubmit.map(u => u.url)];
      let signatureData = null; let sigDate = null;
      if (isDeferred && sigCanvas.current && !sigCanvas.current.isEmpty()) {
        signatureData = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
        sigDate = new Date().toISOString().split('T')[0];
      }

      const squawkData: any = {
        aircraft_id: aircraft!.id, reported_by: session.user.id, reporter_initials: userInitials,
        location, description, affects_airworthiness: affectsAirworthiness, status, pictures: allPictures,
        is_deferred: isDeferred, mel_number: mel, cdl_number: cdl, nef_number: nef, mdl_number: mdl,
        mel_control_number: melControl, deferral_category: category || null, deferral_procedures_completed: procCompleted,
        full_name: fullName, certificate_number: certNum,
        ...(signatureData && { signature_data: signatureData, signature_date: sigDate })
      };

      // notifyMxFailed tracks the email side-effect so we can warn the
      // pilot that MX wasn't actually notified, instead of silently
      // swallowing the error the way this used to.
      let notifyMxFailed = false;

      if (editingId) {
        squawkData.edited_at = new Date().toISOString();
        squawkData.edited_by_initials = userInitials;
        const res = await authFetch('/api/squawks', {
          method: 'PUT',
          body: JSON.stringify({ squawkId: editingId, aircraftId: aircraft!.id, squawkData })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't update the squawk"); }
      } else {
        const res = await authFetch('/api/squawks', {
          method: 'POST',
          body: JSON.stringify({ aircraftId: aircraft!.id, squawkData })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't create the squawk"); }
        const { squawk: newSquawk } = await res.json();
        if (newSquawk && notifyMx) {
          try {
            const emailRes = await authFetch('/api/emails/squawk-notify', {
              method: 'POST',
              body: JSON.stringify({ squawk: newSquawk, aircraft, notifyMx }),
            });
            if (!emailRes.ok) notifyMxFailed = true;
          } catch (err) {
            console.error("Failed to send squawk email", err);
            notifyMxFailed = true;
          }
          // Persist the notify-failed state so the squawk card can show
          // a "MX not notified — resend?" badge until the pilot retries.
          // Await this: fire-and-forget lost the signal entirely when
          // the PUT failed, leaving a squawk that claimed all was well
          // while the mechanic was never reached.
          if (notifyMxFailed) {
            try {
              const flagRes = await authFetch('/api/squawks', {
                method: 'PUT',
                body: JSON.stringify({ squawkId: newSquawk.id, aircraftId: aircraft!.id, squawkData: { mx_notify_failed: true } }),
              });
              if (!flagRes.ok) throw new Error('PUT failed');
            } catch (flagErr) {
              // Couldn't store the badge state. Keep the louder
              // "email didn't send" warning below, but also mention
              // the badge won't appear so the pilot doesn't assume
              // the app will remind them later.
              console.error('Failed to persist mx_notify_failed flag', flagErr);
              showWarning("The email to MX didn't send, and we couldn't set the resend reminder either. Reach out to your mechanic directly — and if you want the reminder badge to show, edit the squawk to try the email again.");
              notifyMxFailed = false; // already warned above; suppress duplicate toast
            }
          }
        }
      }

      await mutate(); onGroundedStatusChange(); setShowModal(false);
      if (notifyMxFailed) {
        // Squawk saved but the mechanic notification didn't go out —
        // tell the pilot so they can follow up manually.
        showWarning("Squawk saved, but the email to MX didn't go through. Reach out to your mechanic directly.");
      } else {
        showSuccess(editingId ? "Squawk updated" : "Squawk reported");
      }
    } catch (err: any) {
      // Squawk row never landed — remove the images we just uploaded
      // so they don't sit in storage forever with no referencing row.
      await cleanupUploadedImages(uploadedPathsToRollback);
      showError(err?.message || "Couldn't save the squawk.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendMxNotify = async (sq: any, e: React.MouseEvent) => {
    // Stop the click from bubbling into the parent card's detail modal.
    e.stopPropagation();
    if (!aircraft || resendingId) return;
    setResendingId(sq.id);
    try {
      const emailRes = await authFetch('/api/emails/squawk-notify', {
        method: 'POST',
        body: JSON.stringify({ squawk: sq, aircraft, notifyMx: true }),
      });
      if (!emailRes.ok) {
        const d = await emailRes.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't send the email");
      }
      // Clear the persistent flag so the badge disappears.
      await authFetch('/api/squawks', {
        method: 'PUT',
        body: JSON.stringify({ squawkId: sq.id, aircraftId: aircraft.id, squawkData: { mx_notify_failed: false } }),
      });
      await mutate();
      showSuccess('Email sent to MX.');
    } catch (err: any) {
      showError(err?.message || 'Still couldn\u2019t reach MX. Contact them directly.');
    } finally {
      setResendingId(null);
    }
  };

  const deleteSquawk = async (id: string) => {
    const ok = await confirm({
      title: "Delete Squawk?",
      message: "We'll delete this squawk and any attached photos. No undo.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/squawks', {
        method: 'DELETE',
        body: JSON.stringify({ squawkId: id, aircraftId: aircraft!.id })
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't delete the squawk"); }
      await mutate(); onGroundedStatusChange();
      closeDetailModal();
      showSuccess("Squawk deleted");
    } catch (err: any) {
      showError(err?.message || "Couldn't delete the squawk.");
    }
  };

  const resolveSquawk = async (sq: any) => {
    setIsSubmitting(true);
    // Try/catch/finally — before this, a failed PUT left isSubmitting
    // stuck true and the detail modal open with a frozen button.
    try {
      const res = await authFetch('/api/squawks', {
        method: 'PUT',
        body: JSON.stringify({
          squawkId: sq.id,
          aircraftId: aircraft!.id,
          squawkData: {
            status: 'resolved',
            affects_airworthiness: false,
            resolved_note: resolveNote.trim() || null,
            edited_at: new Date().toISOString(),
            edited_by_initials: userInitials,
          }
        })
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't resolve the squawk"); }
      await mutate(); onGroundedStatusChange();
      closeDetailModal();
      showSuccess("Squawk resolved");
    } catch (err: any) {
      showError(err?.message || "Couldn't resolve the squawk.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareMx = (sq: any) => { 
    const targetEmail = aircraft?.mx_contact_email || "";
    const subject = encodeURIComponent(`${aircraft!.tail_number}: ${sq.location}`);
    let body = `Aircraft: ${aircraft!.tail_number} (Serial: ${aircraft!.serial_number || 'N/A'})\n`;
    body += `Reported Date: ${new Date(sq.occurred_at ?? sq.created_at).toLocaleDateString()}\nStatus: ${sq.status.toUpperCase()}\n`;
    body += `Airworthiness Affected: ${sq.affects_airworthiness ? 'YES (GROUNDED)' : 'NO'}\n\nLocation: ${sq.location}\nDescription: ${sq.description}\n\n`;
    if (sq.is_deferred) { body += `--- DEFERRAL DETAILS ---\nCategory: ${sq.deferral_category}\nMEL/CDL/NEF/MDL: ${sq.mel_number} / ${sq.cdl_number} / ${sq.nef_number} / ${sq.mdl_number}\n\n`; }
    body += `--- VIEW FULL DETAILS & PHOTOS ---\nSecure Link:\n${window.location.origin}/squawk/${sq.access_token}\n\n---\n`;
    window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${encodeURIComponent(body)}`;
  };

  const generatePDF = async () => {
    setIsExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const itemsToExport = squawks.filter(s => selectedForExport.includes(s.id));
      let y = 20; 
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); 
      doc.text(`Squawk Report - ${aircraft!.tail_number}`, 14, y); y += 8; 
      doc.setFontSize(10); doc.setFont("helvetica", "normal"); 
      doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, y); y += 15;
      for (const sq of itemsToExport) {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFontSize(12); doc.setFont("helvetica", "bold"); 
        doc.text(`Date: ${new Date(sq.occurred_at ?? sq.created_at).toLocaleDateString()} | Location: ${sq.location}`, 14, y); y += 6;
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); 
        doc.text(`Status: ${sq.status.toUpperCase()} | Airworthiness: ${sq.affects_airworthiness ? 'GROUNDED' : 'Monitor'}`, 14, y); y += 6;
        if (sq.is_deferred) { doc.text(`Deferred (${sq.deferral_category}): MEL/CDL/NEF: ${sq.mel_number||'-'} / ${sq.cdl_number||'-'} / ${sq.nef_number||'-'}`, 14, y); y += 6; }
        if (sq._resolving_event) {
          const evDate = sq._resolving_event.completed_at ? new Date(sq._resolving_event.completed_at).toLocaleDateString() : sq._resolving_event.confirmed_date || 'Unknown';
          doc.text(`Resolved by Service Event on ${evDate}`, 14, y); y += 6;
        }
        if (sq.resolved_note) {
          const splitNote = doc.splitTextToSize(`Resolution Note: ${sq.resolved_note}`, 180);
          doc.text(splitNote, 14, y); y += (splitNote.length * 5) + 2;
        }
        const splitDesc = doc.splitTextToSize(`Description: ${sq.description}`, 180); 
        doc.text(splitDesc, 14, y); y += (splitDesc.length * 5) + 4;
        if (sq.pictures && sq.pictures.length > 0) {
          for (const picUrl of sq.pictures) {
            if (y > 200) { doc.addPage(); y = 20; }
            try { const img = new Image(); img.crossOrigin = "Anonymous"; img.src = picUrl; await new Promise((resolve) => { img.onload = resolve; }); const maxW = 150; const maxH = 100; const ratio = Math.min(maxW / img.width, maxH / img.height); doc.addImage(img, 'JPEG', 14, y, img.width * ratio, img.height * ratio); y += (img.height * ratio) + 8; } catch (e) { doc.text("[Image failed to load]", 14, y); y += 6; }
          }
        }
        y += 5; doc.setDrawColor(200); doc.line(14, y, 196, y); y += 10;
      }
      doc.save(`${aircraft!.tail_number}_Squawk_Report.pdf`); 
    } catch (error) { console.error("Error generating PDF:", error); showError("Couldn't build the PDF. Try again."); }
    setIsExportingPdf(false); setShowExportModal(false);
  };

  const toggleExportSelection = (id: string) => { setSelectedForExport(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  const renderResolvedBy = (sq: any) => {
    if (!sq._resolving_event) return null;
    const evDate = sq._resolving_event.completed_at 
      ? new Date(sq._resolving_event.completed_at).toLocaleDateString()
      : sq._resolving_event.confirmed_date || '';
    return (
      <p className="text-[10px] text-[#56B94A] mt-2 flex items-center gap-1 font-bold">
        <Link2 size={10} /> Resolved by Service Event{evDate ? ` on ${evDate}` : ''}
      </p>
    );
  };

  if (!aircraft) return null;

  const activeSquawks = squawks.filter(sq => sq.status === 'open');
  const resolvedSquawks = squawks.filter(sq => sq.status === 'resolved');
  const displayedResolved = resolvedSquawks.slice(0, visibleArchivedCount);

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={() => openForm()}><Plus size={18} /> Report New Squawk</PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-danger mb-6">
        <div className="flex justify-between items-end mb-6">
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Active Squawks</h2>
          <button onClick={() => { setSelectedForExport([]); setShowExportModal(true); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-danger hover:opacity-80 transition-colors active:scale-95">
            <Download size={14} /> Export PDF
          </button>
        </div>
        <div className="space-y-4">
          {activeSquawks.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No active squawks.</p>) : (
            activeSquawks.map(sq => (
              <div key={sq.id} className="relative">
                <button onClick={() => openDetailModal(sq)} className={`w-full text-left p-4 border rounded transition-colors active:scale-[0.98] ${sq.affects_airworthiness ? 'border-danger/30 bg-danger/10 hover:bg-danger/15' : 'border-mxOrange/30 bg-mxOrange/10 hover:bg-mxOrange/15'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white flex items-center gap-1 ${sq.affects_airworthiness ? 'bg-danger' : 'bg-mxOrange'}`}>
                      {sq.affects_airworthiness && <AlertTriangle size={10} />}
                      {sq.affects_airworthiness ? 'AOG / GROUNDED' : 'OPEN'}
                    </span>
                    {sq.is_deferred && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-blue-600 text-white">DEFERRED ({sq.deferral_category})</span>}
                    {sq.mx_notify_failed && (
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                        <MailWarning size={10} /> MX not notified
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{new Date(sq.occurred_at ?? sq.created_at).toLocaleDateString()} | {sq.location} {sq.reporter_initials ? `| ${sq.reporter_initials}` : ''}</p>
                  <p className="text-sm text-navy mt-1 font-roboto whitespace-pre-wrap line-clamp-2">{sq.description}</p>
                  {sq.edited_at && <p className="text-[9px] text-gray-400 mt-2 font-bold uppercase tracking-widest">Edited {new Date(sq.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{sq.edited_by_initials ? ` by ${sq.edited_by_initials}` : ''}</p>}
                </div>
                {sq.pictures && sq.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {sq.pictures.slice(0, 4).map((pic: string, i: number) => (
                      <div key={i} className="shrink-0">
                        <img src={resolve(pic) || pic} loading="lazy" alt="Squawk" className="h-16 w-16 object-cover rounded border border-gray-300 shadow-sm" />
                      </div>
                    ))}
                    {sq.pictures.length > 4 && <div className="h-16 w-16 rounded bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">+{sq.pictures.length - 4}</div>}
                  </div>
                )}
                </button>
                {sq.mx_notify_failed && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-amber-800 leading-tight flex-1">Mechanic email didn&apos;t go out — they may not know about this squawk.</p>
                    <button
                      onClick={(e) => resendMxNotify(sq, e)}
                      disabled={resendingId === sq.id}
                      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded bg-amber-600 text-white flex items-center gap-1 shrink-0 active:scale-95 disabled:opacity-50"
                    >
                      <Send size={10} /> {resendingId === sq.id ? 'Sending…' : 'Resend'}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-gray-100 shadow-inner rounded-sm p-4 md:p-6 border-t-4 border-gray-400 mb-6">
        <h2 className="font-oswald text-xl md:text-2xl font-bold uppercase text-gray-500 m-0 mb-6 leading-none">Archived History</h2>
        <div className="space-y-4">
          {displayedResolved.length === 0 ? (
            <p className="text-center text-sm text-gray-400 italic py-4">No archived history.</p>
          ) : (
            displayedResolved.map(sq => (
              <button key={sq.id} onClick={() => openDetailModal(sq)} className="w-full text-left p-4 border border-gray-300 bg-white rounded opacity-70 hover:opacity-100 transition-all active:scale-[0.98]">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white bg-gray-500">RESOLVED</span>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{new Date(sq.occurred_at ?? sq.created_at).toLocaleDateString()} | {sq.location} {sq.reporter_initials ? `| ${sq.reporter_initials}` : ''}</p>
                  <p className="text-sm text-gray-700 mt-1 font-roboto whitespace-pre-wrap line-clamp-2">{sq.description}</p>
                  {sq.resolved_note && <p className="text-xs text-[#56B94A] mt-2 italic">Resolution: {sq.resolved_note}</p>}
                  {renderResolvedBy(sq)}
                  {sq.edited_at && <p className="text-[9px] text-gray-400 mt-2 font-bold uppercase tracking-widest">Edited {new Date(sq.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{sq.edited_by_initials ? ` by ${sq.edited_by_initials}` : ''}</p>}
                </div>
              </button>
            ))
          )}
          {resolvedSquawks.length > visibleArchivedCount && (
            <div className="pt-4 text-center">
              <button onClick={() => setVisibleArchivedCount(prev => prev + 10)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy transition-colors underline active:scale-95">Load More Archived</button>
            </div>
          )}
        </div>
      </div>

      {/* ─── SQUAWK DETAIL MODAL ─── */}
      {detailSquawk && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={closeDetailModal}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-danger animate-slide-up" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">Squawk Detail</h2>
              <button onClick={closeDetailModal} className="text-gray-400 hover:text-danger"><X size={24}/></button>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${detailSquawk.status === 'resolved' ? 'bg-[#56B94A]' : detailSquawk.affects_airworthiness ? 'bg-danger' : 'bg-mxOrange'}`}>
                {detailSquawk.status === 'resolved' ? 'RESOLVED' : detailSquawk.affects_airworthiness ? 'AOG / GROUNDED' : 'OPEN'}
              </span>
              {detailSquawk.is_deferred && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-blue-600 text-white">DEFERRED ({detailSquawk.deferral_category})</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="flex items-start gap-2"><MapPin size={14} className="text-danger shrink-0 mt-0.5" /><div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Location</span><span className="font-bold text-navy">{detailSquawk.location}</span></div></div>
              <div className="flex items-start gap-2"><User size={14} className="text-gray-500 shrink-0 mt-0.5" /><div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Reported By</span><span className="font-bold text-navy">{detailSquawk.reporter_initials || 'Unknown'}</span></div></div>
              <div className="flex items-start gap-2"><Clock size={14} className="text-gray-500 shrink-0 mt-0.5" /><div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Date</span><span className="font-bold text-navy">{new Date(detailSquawk.occurred_at ?? detailSquawk.created_at).toLocaleDateString()}</span></div></div>
              {detailSquawk.edited_at && (
                <div className="flex items-start gap-2"><Edit2 size={14} className="text-mxOrange shrink-0 mt-0.5" /><div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Last Edited</span><span className="font-bold text-navy">{new Date(detailSquawk.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{detailSquawk.edited_by_initials ? ` by ${detailSquawk.edited_by_initials}` : ''}</span></div></div>
              )}
            </div>

            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Description</span>
              <p className="text-sm text-navy font-roboto whitespace-pre-wrap">{detailSquawk.description}</p>
            </div>

            {detailSquawk.status === 'resolved' && detailSquawk.resolved_note && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#56B94A] block mb-1">Resolution Note</span>
                <p className="text-sm text-navy font-roboto whitespace-pre-wrap">{detailSquawk.resolved_note}</p>
              </div>
            )}

            {detailSquawk._resolving_event && (
              <div className="mb-4">{renderResolvedBy(detailSquawk)}</div>
            )}

            {detailSquawk.is_deferred && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 block mb-2">Deferral Details</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {detailSquawk.mel_number && <div><span className="text-gray-400 font-bold">MEL:</span> {detailSquawk.mel_number}</div>}
                  {detailSquawk.cdl_number && <div><span className="text-gray-400 font-bold">CDL:</span> {detailSquawk.cdl_number}</div>}
                  {detailSquawk.nef_number && <div><span className="text-gray-400 font-bold">NEF:</span> {detailSquawk.nef_number}</div>}
                  {detailSquawk.full_name && <div><span className="text-gray-400 font-bold">Signed:</span> {detailSquawk.full_name}</div>}
                  {detailSquawk.certificate_number && <div><span className="text-gray-400 font-bold">Cert #:</span> {detailSquawk.certificate_number}</div>}
                </div>
              </div>
            )}

            {detailSquawk.pictures && detailSquawk.pictures.length > 0 && (
              <div className="mb-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">{detailSquawk.pictures.length} Photo{detailSquawk.pictures.length > 1 ? 's' : ''}</span>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {detailSquawk.pictures.map((pic: string, i: number) => (
                    <button key={i} onClick={() => { setPreviewImages(detailSquawk.pictures); setPreviewIndex(i); }} className="active:scale-95 transition-transform shrink-0">
                      <img src={resolve(pic) || pic} loading="lazy" alt="Squawk" className="h-20 w-20 object-cover rounded border border-gray-300 shadow-sm" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showResolveForm && detailSquawk.status === 'open' && (
              <div className="mb-4 p-4 bg-green-50 border-2 border-green-200 rounded animate-fade-in">
                <p className="text-sm font-bold text-navy mb-3">Resolve this squawk?</p>
                <div className="mb-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Resolution Note (Optional)</label>
                  <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[80px]" placeholder="What was done to resolve this issue..." />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowResolveForm(false)} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95">Cancel</button>
                  <button onClick={() => resolveSquawk(detailSquawk)} disabled={isSubmitting} className="flex-[2] bg-[#56B94A] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 disabled:opacity-50">{isSubmitting ? "Resolving..." : "Confirm Resolve"}</button>
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 pt-4 space-y-2">
              {canModify(detailSquawk) && (
                <div className="flex gap-2">
                  <button onClick={() => openForm(detailSquawk)} className="flex-1 bg-navy text-white font-bold py-3 rounded text-xs uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"><Edit2 size={14} /> Edit</button>
                  {detailSquawk.status === 'open' && (
                    <button onClick={() => setShowResolveForm(true)} className="flex-1 bg-[#56B94A] text-white font-bold py-3 rounded text-xs uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"><CheckCircle size={14} /> Resolve</button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { handleShareMx(detailSquawk); closeDetailModal(); }} className="flex-1 border border-gray-300 text-navy font-bold py-2.5 rounded text-xs uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"><Mail size={14} /> Email MX</button>
                {canModify(detailSquawk) && (
                  <button onClick={() => deleteSquawk(detailSquawk.id)} className="flex-1 border border-danger text-danger font-bold py-2.5 rounded text-xs uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showExportModal && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-danger animate-slide-up flex flex-col" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><CheckSquare size={20} className="text-danger" /> Export to PDF</h2>
              <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-danger transition-colors"><X size={24}/></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Pick the squawks to include in the PDF report.</p>
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200">
              <button onClick={() => setSelectedForExport(squawks.map(s => s.id))} className="text-[10px] font-bold uppercase tracking-widest text-danger hover:opacity-80">Select All</button>
              <button onClick={() => setSelectedForExport([])} className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600">Clear All</button>
            </div>
            <div className="space-y-2 mb-6 overflow-y-auto flex-1 max-h-[40vh]">
              {squawks.map(sq => (
                <label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50 transition-colors">
                  <input type="checkbox" checked={selectedForExport.includes(sq.id)} onChange={() => toggleExportSelection(sq.id)} className="mt-1 w-4 h-4 text-danger border-gray-300 rounded focus:ring-danger" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-navy">{new Date(sq.occurred_at ?? sq.created_at).toLocaleDateString()} - {sq.location}</p>
                    <p className="text-[10px] text-gray-500 line-clamp-1">{sq.description}</p>
                  </div>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${sq.status === 'resolved' ? 'bg-gray-200 text-gray-700' : 'bg-orange-100 text-orange-700'}`}>{sq.status}</span>
                </label>
              ))}
            </div>
            <PrimaryButton onClick={generatePDF} disabled={selectedForExport.length === 0 || isExportingPdf}>
              {isExportingPdf ? "Generating Report..." : `Export ${selectedForExport.length} Items to PDF`}
            </PrimaryButton>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {previewImages && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10001] bg-black/95 overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setPreviewImages(null)}>
          <div className="flex min-h-full items-center justify-center">
          <button className="absolute top-4 right-4 text-gray-400 hover:text-white z-50 p-2"><X size={32}/></button>
          {previewImages.length > 1 && <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === 0 ? previewImages.length - 1 : prev - 1); }} className="absolute left-4 text-gray-400 hover:text-white z-50 p-2"><ChevronLeft size={48}/></button>}
          <div className="max-w-full max-h-full p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}><img src={resolve(previewImages[previewIndex]) || previewImages[previewIndex]} className="max-h-[85vh] max-w-full object-contain rounded shadow-2xl" /></div>
          {previewImages.length > 1 && <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === previewImages.length - 1 ? 0 : prev + 1); }} className="absolute right-4 text-gray-400 hover:text-white z-50 p-2"><ChevronRight size={48}/></button>}
          <div className="absolute bottom-6 text-gray-400 font-oswald tracking-widest text-sm uppercase">Image {previewIndex + 1} of {previewImages.length}</div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showModal && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-3">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-danger animate-slide-up" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Squawk' : 'Report Squawk'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-danger"><X size={24}/></button>
            </div>
            <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-4 grid grid-cols-2 gap-2 text-xs">
              <div><span className="font-bold text-gray-500 uppercase">Date:</span> {new Date().toLocaleDateString()}</div>
              <div><span className="font-bold text-gray-500 uppercase">Tail:</span> {aircraft.tail_number}</div>
            </div>
            <form onSubmit={submitSquawk} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Status</label><select value={status} onChange={e=>setStatus(e.target.value as any)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-danger font-bold outline-none"><option value="open">Open</option><option value="resolved">Resolved</option></select></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Affects Airworthiness?</label><select value={affectsAirworthiness ? "yes" : "no"} onChange={e=>setAffectsAirworthiness(e.target.value === "yes")} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-red-500 font-bold outline-none"><option value="no">No (Monitor)</option><option value="yes">YES (GROUNDED)</option></select></div>
              </div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Location (Airport) *</label><input type="text" required value={location} onChange={e=>setLocation(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-danger outline-none" placeholder="e.g. KDFW" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description *</label><textarea required value={description} onChange={e=>setDescription(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 min-h-[100px] focus:border-danger outline-none" /></div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2 mb-2"><Upload size={14}/> Attach Photos (Max {MAX_UPLOAD_SIZE_LABEL} each)</label>
                <input type="file" multiple accept="image/*" onChange={handleImageSelection} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100 file:text-navy cursor-pointer" />
              </div>

              {isTurbine && status === 'open' && (
                <div className="border border-blue-200 rounded p-4 bg-blue-50/30">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy mb-4 cursor-pointer">
                    <input type="checkbox" checked={isDeferred} onChange={e=>setIsDeferred(e.target.checked)} className="w-4 h-4 cursor-pointer" /> Defer Item
                  </label>
                  {isDeferred && (
                    <div className="space-y-4 animate-fade-in">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MEL #</label><input type="text" value={mel} onChange={e=>setMel(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">CDL #</label><input type="text" value={cdl} onChange={e=>setCdl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">NEF #</label><input type="text" value={nef} onChange={e=>setNef(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MDL #</label><input type="text" value={mdl} onChange={e=>setMdl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Control #</label><input type="text" value={melControl} onChange={e=>setMelControl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Category</label><select value={category} onChange={e=>setCategory(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-danger outline-none"><option value="">Select...</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="NA">N/A</option></select></div>
                      </div>
                      <div className="pt-2">
                        <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                          <input type="checkbox" required checked={procCompleted} onChange={e=>setProcCompleted(e.target.checked)} className="mt-0.5 w-4 h-4 cursor-pointer" /> I have completed the related deferral procedures as required by the MEL, CDL, NEF, or MDL.
                        </label>
                      </div>
                      <div className="pt-4 border-t border-gray-200">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Signature *</label>
                        <div className="border border-gray-300 rounded bg-white"><SignatureCanvas ref={sigCanvas} penColor="black" canvasProps={{ className: 'w-full h-32 rounded' }} /></div>
                        <button type="button" onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-bold uppercase text-gray-500 mt-1 hover:text-danger">Clear Signature</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Name (Full Name) *</label><input type="text" required value={fullName} onChange={e=>setFullName(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-danger outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Certificate Number *</label><input type="text" required value={certNum} onChange={e=>setCertNum(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-danger outline-none" /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!editingId && (
                <div className="pt-2 pb-2">
                  <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                    <input type="checkbox" checked={notifyMx} onChange={e=>setNotifyMx(e.target.checked)} className="mt-0.5 w-4 h-4 text-danger border-gray-300 rounded focus:ring-danger cursor-pointer" />
                    Notify MX? (Emails squawk details to maintenance contact)
                  </label>
                </div>
              )}
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Squawk"}</PrimaryButton></div>
            </form>
          </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
