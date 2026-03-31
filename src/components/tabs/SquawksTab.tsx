import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { validateFileSizes, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import type { AircraftWithMetrics } from "@/lib/types";
import useSWR from "swr";
import { AlertTriangle, Plus, X, Upload, Mail, Edit2, ChevronLeft, ChevronRight, Download, CheckSquare, Trash2, CheckCircle, Link2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import SignatureCanvas from "react-signature-canvas";
import imageCompression from "browser-image-compression";
import Toast from "@/components/Toast";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function SquawksTab({ 
  aircraft, session, role, userInitials, onGroundedStatusChange 
}: { 
  aircraft: AircraftWithMetrics | null, session: any, role: string, userInitials: string, onGroundedStatusChange: () => void 
}) {
  const { data: squawks = [], mutate } = useSWR(
    aircraft ? `squawks-${aircraft.id}` : null,
    async () => {
      const { data } = await supabase
        .from('aft_squawks').select('*').eq('aircraft_id', aircraft!.id)
        .order('created_at', { ascending: false });

      // For resolved squawks with a service event reference, fetch event dates
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

  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const showSuccess = (msg: string) => { setToastMessage(msg); setShowToast(true); };

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

  const isTurbine = aircraft?.engine_type === 'Turbine';

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
    setShowModal(true);
  };

  const handleImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const sizeError = validateFileSizes(files);
    if (sizeError) { alert(sizeError); e.target.value = ''; return; }
    setSelectedImages(files);
  };

  const uploadImages = async (): Promise<string[]> => {
    let uploadedPaths: string[] = [];
    const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
    for (const file of selectedImages) {
      try {
        const compressedFile = await imageCompression(file, options);
        const fileName = `${aircraft!.tail_number}_${Date.now()}_${compressedFile.name}`;
        const { data } = await supabase.storage.from('aft_squawk_images').upload(fileName, compressedFile);
        if (data) { const { data: publicUrlData } = supabase.storage.from('aft_squawk_images').getPublicUrl(data.path); uploadedPaths.push(publicUrlData.publicUrl); }
      } catch (error) { console.error("Image compression/upload failed:", error); }
    }
    return uploadedPaths;
  };

  const submitSquawk = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    const uploadedUrls = await uploadImages(); 
    const allPictures = [...existingImages, ...uploadedUrls];
    let signatureData = null; let sigDate = null;
    if (isDeferred && sigCanvas.current && !sigCanvas.current.isEmpty()) { 
      signatureData = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png'); 
      sigDate = new Date().toISOString().split('T')[0]; 
    }

    const squawkData = {
      aircraft_id: aircraft!.id, reported_by: session.user.id, reporter_initials: userInitials, 
      location, description, affects_airworthiness: affectsAirworthiness, status, pictures: allPictures, 
      is_deferred: isDeferred, mel_number: mel, cdl_number: cdl, nef_number: nef, mdl_number: mdl, 
      mel_control_number: melControl, deferral_category: category || null, deferral_procedures_completed: procCompleted, 
      full_name: fullName, certificate_number: certNum, 
      ...(signatureData && { signature_data: signatureData, signature_date: sigDate })
    };

    if (editingId) {
      await supabase.from('aft_squawks').update(squawkData).eq('id', editingId);
    } else {
      const { data: newSquawk } = await supabase.from('aft_squawks').insert(squawkData).select().single();
      if (newSquawk) {
        try { await authFetch('/api/emails/squawk-notify', { method: 'POST', body: JSON.stringify({ squawk: newSquawk, aircraft, notifyMx }) }); } catch (err) { console.error("Failed to send squawk email", err); }
      }
    }

    await mutate(); onGroundedStatusChange(); setShowModal(false); setIsSubmitting(false);
    showSuccess(editingId ? "Squawk updated" : "Squawk reported");
  };

  const deleteSquawk = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this squawk?")) return;
    await supabase.from('aft_squawks').delete().eq('id', id);
    await mutate(); onGroundedStatusChange();
  };

  const resolveSquawk = async (sq: any) => {
    if (!confirm("Mark this squawk as resolved?")) return;
    await supabase.from('aft_squawks').update({ status: 'resolved', affects_airworthiness: false }).eq('id', sq.id);
    await mutate(); onGroundedStatusChange();
    showSuccess("Squawk resolved");
  };

  const handleShareMx = (sq: any) => { 
    const targetEmail = aircraft?.mx_contact_email || "";
    const subject = encodeURIComponent(`${aircraft!.tail_number}: ${sq.location}`);
    let body = `Aircraft: ${aircraft!.tail_number} (Serial: ${aircraft!.serial_number || 'N/A'})\n`;
    body += `Reported Date: ${new Date(sq.created_at).toLocaleDateString()}\nStatus: ${sq.status.toUpperCase()}\n`;
    body += `Airworthiness Affected: ${sq.affects_airworthiness ? 'YES (GROUNDED)' : 'NO'}\n\nLocation: ${sq.location}\nDescription: ${sq.description}\n\n`;
    if (sq.is_deferred) { body += `--- DEFERRAL DETAILS ---\nCategory: ${sq.deferral_category}\nMEL/CDL/NEF/MDL: ${sq.mel_number} / ${sq.cdl_number} / ${sq.nef_number} / ${sq.mdl_number}\n\n`; }
    body += `--- VIEW FULL DETAILS & PHOTOS ---\nSecure Link:\n${window.location.origin}/squawk/${sq.id}\n\n---\n`;
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
        doc.text(`Date: ${new Date(sq.created_at).toLocaleDateString()} | Location: ${sq.location}`, 14, y); y += 6;
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); 
        doc.text(`Status: ${sq.status.toUpperCase()} | Airworthiness: ${sq.affects_airworthiness ? 'GROUNDED' : 'Monitor'}`, 14, y); y += 6;
        if (sq.is_deferred) { doc.text(`Deferred (${sq.deferral_category}): MEL/CDL/NEF: ${sq.mel_number||'-'} / ${sq.cdl_number||'-'} / ${sq.nef_number||'-'}`, 14, y); y += 6; }
        if (sq._resolving_event) {
          const evDate = sq._resolving_event.completed_at ? new Date(sq._resolving_event.completed_at).toLocaleDateString() : sq._resolving_event.confirmed_date || 'Unknown';
          doc.text(`Resolved by Service Event on ${evDate}`, 14, y); y += 6;
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
    } catch (error) { console.error("Error generating PDF:", error); alert("There was an error generating the PDF."); }
    setIsExportingPdf(false); setShowExportModal(false);
  };

  const toggleExportSelection = (id: string) => { setSelectedForExport(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  /** Renders the cross-reference badge for a resolved squawk */
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
      <Toast message={toastMessage} show={showToast} onDismiss={() => setShowToast(false)} />

      <div className="mb-2">
        <PrimaryButton onClick={() => openForm()}><Plus size={18} /> Report New Squawk</PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#CE3732] mb-6">
        <div className="flex justify-between items-end mb-6">
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Active Squawks</h2>
          <button onClick={() => { setSelectedForExport([]); setShowExportModal(true); }} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#CE3732] hover:opacity-80 transition-colors active:scale-95">
            <Download size={14} /> Export PDF
          </button>
        </div>
        <div className="space-y-4">
          {activeSquawks.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No active squawks!</p>) : (
            activeSquawks.map(sq => (
              <div key={sq.id} className={`p-4 border rounded ${sq.affects_airworthiness ? 'border-[#CE3732]/30 bg-[#CE3732]/10' : 'border-[#F08B46]/30 bg-[#F08B46]/10'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${sq.affects_airworthiness ? 'bg-[#CE3732]' : 'bg-[#F08B46]'}`}>
                      {sq.affects_airworthiness ? 'AOG / GROUNDED' : 'OPEN'}
                    </span>
                    {sq.is_deferred && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-blue-600 text-white">DEFERRED ({sq.deferral_category})</span>}
                  </div>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => handleShareMx(sq)} className="text-gray-500 hover:text-[#CE3732] active:scale-95" title="Email MX"><Mail size={16}/></button>
                    <button onClick={() => openForm(sq)} className="text-gray-500 hover:text-[#CE3732] active:scale-95" title="Edit"><Edit2 size={16}/></button>
                    {role === 'admin' && (
                      <>
                        <button onClick={() => resolveSquawk(sq)} className="text-gray-500 hover:text-green-600 active:scale-95" title="Mark Resolved"><CheckCircle size={16}/></button>
                        <button onClick={() => deleteSquawk(sq.id)} className="text-gray-500 hover:text-red-600 active:scale-95" title="Delete"><Trash2 size={16}/></button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{new Date(sq.created_at).toLocaleDateString()} | {sq.location} {sq.reporter_initials ? `| ${sq.reporter_initials}` : ''}</p>
                  <p className="text-sm text-navy mt-1 font-roboto whitespace-pre-wrap">{sq.description}</p>
                </div>
                {sq.pictures && sq.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {sq.pictures.map((pic: string, i: number) => (
                      <button key={i} onClick={() => { setPreviewImages(sq.pictures); setPreviewIndex(i); }} className="active:scale-95 transition-transform shrink-0">
                        <img src={pic} loading="lazy" alt="Squawk" className="h-16 w-16 object-cover rounded border border-gray-300 shadow-sm" />
                      </button>
                    ))}
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
              <div key={sq.id} className="p-4 border border-gray-300 bg-white rounded opacity-70 hover:opacity-100 transition-opacity">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white bg-gray-500">RESOLVED</span>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => openForm(sq)} className="text-gray-500 hover:text-gray-700 active:scale-95" title="View/Edit"><Edit2 size={16}/></button>
                    {role === 'admin' && <button onClick={() => deleteSquawk(sq.id)} className="text-gray-500 hover:text-red-600 active:scale-95" title="Delete"><Trash2 size={16}/></button>}
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{new Date(sq.created_at).toLocaleDateString()} | {sq.location} {sq.reporter_initials ? `| ${sq.reporter_initials}` : ''}</p>
                  <p className="text-sm text-gray-700 mt-1 font-roboto whitespace-pre-wrap">{sq.description}</p>
                  {renderResolvedBy(sq)}
                </div>
                {sq.pictures && sq.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {sq.pictures.map((pic: string, i: number) => (
                      <button key={i} onClick={() => { setPreviewImages(sq.pictures); setPreviewIndex(i); }} className="active:scale-95 transition-transform shrink-0">
                        <img src={pic} loading="lazy" alt="Archived Squawk Photo" className="h-16 w-16 object-cover rounded border border-gray-300 shadow-sm" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          {resolvedSquawks.length > visibleArchivedCount && (
            <div className="pt-4 text-center">
              <button onClick={() => setVisibleArchivedCount(prev => prev + 10)} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-navy transition-colors underline active:scale-95">Load More Archived</button>
            </div>
          )}
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-5 border-t-4 border-[#CE3732] max-h-[90vh] overflow-y-auto animate-slide-up flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><CheckSquare size={20} className="text-[#CE3732]" /> Export to PDF</h2>
              <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={24}/></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Select the squawks you wish to include in the formal PDF report.</p>
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200">
              <button onClick={() => setSelectedForExport(squawks.map(s => s.id))} className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] hover:opacity-80">Select All</button>
              <button onClick={() => setSelectedForExport([])} className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600">Clear All</button>
            </div>
            <div className="space-y-2 mb-6 overflow-y-auto flex-1 max-h-[40vh]">
              {squawks.map(sq => (
                <label key={sq.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50 transition-colors">
                  <input type="checkbox" checked={selectedForExport.includes(sq.id)} onChange={() => toggleExportSelection(sq.id)} className="mt-1 w-4 h-4 text-[#CE3732] border-gray-300 rounded focus:ring-[#CE3732]" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-navy">{new Date(sq.created_at).toLocaleDateString()} - {sq.location}</p>
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
      )}

      {previewImages && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center animate-fade-in" onClick={() => setPreviewImages(null)}>
          <button className="absolute top-4 right-4 text-gray-400 hover:text-white z-50 p-2"><X size={32}/></button>
          {previewImages.length > 1 && <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === 0 ? previewImages.length - 1 : prev - 1); }} className="absolute left-4 text-gray-400 hover:text-white z-50 p-2"><ChevronLeft size={48}/></button>}
          <div className="max-w-full max-h-full p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}><img src={previewImages[previewIndex]} className="max-h-[85vh] max-w-full object-contain rounded shadow-2xl" /></div>
          {previewImages.length > 1 && <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === previewImages.length - 1 ? 0 : prev + 1); }} className="absolute right-4 text-gray-400 hover:text-white z-50 p-2"><ChevronRight size={48}/></button>}
          <div className="absolute bottom-6 text-gray-400 font-oswald tracking-widest text-sm uppercase">Image {previewIndex + 1} of {previewImages.length}</div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-[#CE3732] max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Squawk' : 'Report Squawk'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button>
            </div>
            <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-4 grid grid-cols-2 gap-2 text-xs">
              <div><span className="font-bold text-gray-500 uppercase">Date:</span> {new Date().toLocaleDateString()}</div>
              <div><span className="font-bold text-gray-500 uppercase">Tail:</span> {aircraft.tail_number}</div>
            </div>
            <form onSubmit={submitSquawk} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Status</label><select value={status} onChange={e=>setStatus(e.target.value as any)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#CE3732] font-bold outline-none"><option value="open">Open</option><option value="resolved">Resolved</option></select></div>
                <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Affects Airworthiness?</label><select value={affectsAirworthiness ? "yes" : "no"} onChange={e=>setAffectsAirworthiness(e.target.value === "yes")} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-red-500 font-bold outline-none"><option value="no">No (Monitor)</option><option value="yes">YES (GROUNDED)</option></select></div>
              </div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Location (Airport) *</label><input type="text" required value={location} onChange={e=>setLocation(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#CE3732] outline-none" placeholder="e.g. KDFW" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description *</label><textarea required value={description} onChange={e=>setDescription(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 min-h-[100px] focus:border-[#CE3732] outline-none" /></div>
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
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MEL #</label><input type="text" value={mel} onChange={e=>setMel(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">CDL #</label><input type="text" value={cdl} onChange={e=>setCdl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">NEF #</label><input type="text" value={nef} onChange={e=>setNef(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MDL #</label><input type="text" value={mdl} onChange={e=>setMdl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Control #</label><input type="text" value={melControl} onChange={e=>setMelControl(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Category</label><select value={category} onChange={e=>setCategory(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-[#CE3732] outline-none"><option value="">Select...</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="NA">N/A</option></select></div>
                      </div>
                      <div className="pt-2">
                        <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                          <input type="checkbox" required checked={procCompleted} onChange={e=>setProcCompleted(e.target.checked)} className="mt-0.5 w-4 h-4 cursor-pointer" /> I have completed the related deferral procedures as required by the MEL, CDL, NEF, or MDL.
                        </label>
                      </div>
                      <div className="pt-4 border-t border-gray-200">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Signature *</label>
                        <div className="border border-gray-300 rounded bg-white"><SignatureCanvas ref={sigCanvas} penColor="black" canvasProps={{ className: 'w-full h-32 rounded' }} /></div>
                        <button type="button" onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-bold uppercase text-gray-500 mt-1 hover:text-red-500">Clear Signature</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Name (Full Name) *</label><input type="text" required value={fullName} onChange={e=>setFullName(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Certificate Number *</label><input type="text" required value={certNum} onChange={e=>setCertNum(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#CE3732] outline-none" /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!editingId && (
                <div className="pt-2 pb-2">
                  <label className="flex items-start gap-2 text-xs font-bold text-navy cursor-pointer">
                    <input type="checkbox" checked={notifyMx} onChange={e=>setNotifyMx(e.target.checked)} className="mt-0.5 w-4 h-4 text-[#CE3732] border-gray-300 rounded focus:ring-[#CE3732] cursor-pointer" />
                    Notify MX? (Emails squawk details to maintenance contact)
                  </label>
                </div>
              )}
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Squawk"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
