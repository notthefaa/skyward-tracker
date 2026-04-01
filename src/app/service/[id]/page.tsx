"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBodyScrollOverride } from "@/hooks/useBodyScrollOverride";
import { validateFileSizes, MAX_UPLOAD_SIZE_LABEL, PORTAL_EXPIRY_DAYS } from "@/lib/constants";
import { 
  Wrench, AlertTriangle, CheckCircle, Clock, Send, 
  MessageSquare, Calendar, Sparkles, X, Plus, Image, ArrowLeft, XCircle, Plane,
  Upload, FileText, Paperclip, Loader2
} from "lucide-react";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function ServicePortal() {
  const params = useParams();
  const router = useRouter();
  const accessToken = params.id as string;

  const [event, setEvent] = useState<any>(null);
  const [aircraft, setAircraft] = useState<any>(null);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [squawkPhotos, setSquawkPhotos] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAppUser, setIsAppUser] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  const [showDateForm, setShowDateForm] = useState(false);
  const [proposedDate, setProposedDate] = useState("");
  const [serviceDurationDays, setServiceDurationDays] = useState("");
  const [commentText, setCommentText] = useState("");
  const [estimatedCompletion, setEstimatedCompletion] = useState("");
  const [mechanicNotes, setMechanicNotes] = useState("");
  const [availabilityNote, setAvailabilityNote] = useState("");

  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestDescription, setSuggestDescription] = useState("");

  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const [showReadyConfirm, setShowReadyConfirm] = useState(false);
  const [readyMessage, setReadyMessage] = useState("");

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadDescription, setUploadDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Confirm with duration
  const [showConfirmWithDuration, setShowConfirmWithDuration] = useState(false);
  const [confirmDurationDays, setConfirmDurationDays] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");

  // Replace dangerouslySetInnerHTML with hook-based style override
  useBodyScrollOverride();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAppUser(!!session);
    });
  }, []);

  useEffect(() => {
    if (accessToken) fetchEventData();
  }, [accessToken]);

  const fetchEventData = async () => {
    const { data: evData } = await supabase
      .from('aft_maintenance_events').select('*').eq('access_token', accessToken).single();

    if (evData) {
      if (evData.status === 'complete' && evData.completed_at) {
        const completedDate = new Date(evData.completed_at);
        const expiryDate = new Date(completedDate.getTime() + PORTAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        if (new Date() > expiryDate) {
          setIsExpired(true);
          setIsLoading(false);
          return;
        }
      }

      setEvent(evData);
      setEstimatedCompletion(evData.estimated_completion || "");
      setMechanicNotes(evData.mechanic_notes || "");

      const { data: acData } = await supabase
        .from('aft_aircraft').select('*').eq('id', evData.aircraft_id).single();
      if (acData) setAircraft(acData);

      const { data: liData } = await supabase
        .from('aft_event_line_items').select('*').eq('event_id', evData.id).order('created_at');
      if (liData) {
        setLineItems(liData);
        const squawkIds = liData.filter(li => li.squawk_id).map(li => li.squawk_id);
        if (squawkIds.length > 0) {
          const { data: squawksData } = await supabase
            .from('aft_squawks').select('id, pictures').in('id', squawkIds);
          if (squawksData) {
            const photoMap: Record<string, string[]> = {};
            for (const sq of squawksData) {
              if (sq.pictures && sq.pictures.length > 0) {
                photoMap[sq.id] = sq.pictures;
              }
            }
            setSquawkPhotos(photoMap);
          }
        }
      }

      const { data: msgData } = await supabase
        .from('aft_event_messages').select('*').eq('event_id', evData.id).order('created_at');
      if (msgData) setMessages(msgData);
    }
    setIsLoading(false);
  };

  const handleAction = async (action: string, payload: any = {}) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/mx-events/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, action, ...payload })
      });
      if (!res.ok) throw new Error('Request failed');
      await fetchEventData();
      setShowDateForm(false);
      setCommentText("");
      setAvailabilityNote("");
      setShowConfirmWithDuration(false);
      setConfirmDurationDays("");
      setConfirmMessage("");
    } catch (err) {
      alert("Something went wrong. Please try again.");
    }
    setIsSubmitting(false);
  };

  const handleLineStatusUpdate = async (lineId: string, newStatus: string) => {
    await handleAction('update_lines', {
      lineItemUpdates: [{ id: lineId, line_status: newStatus }]
    });
  };

  const handleFileUpload = async () => {
    if (uploadFiles.length === 0) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('accessToken', accessToken);
      formData.append('description', uploadDescription);
      for (const file of uploadFiles) {
        formData.append('files', file);
      }
      const res = await fetch('/api/mx-events/upload-attachment', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Upload failed');
      }
      await fetchEventData();
      setUploadFiles([]);
      setUploadDescription("");
      setShowUploadForm(false);
    } catch (err: any) {
      alert(err.message || "Upload failed. Please try again.");
    }
    setIsUploading(false);
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const isImageType = (type: string) => type.startsWith('image/');

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">Loading Service Portal...</div>
    );
  }

  if (!event || !aircraft) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">{isExpired ? 'This Service Portal Link Has Expired' : 'Service Event Not Found'}</div>
    );
  }

  const statusColor = event.status === 'complete' ? 'bg-[#56B94A]' : event.status === 'ready_for_pickup' ? 'bg-[#56B94A]' : event.status === 'confirmed' ? 'bg-[#3AB0FF]' : event.status === 'cancelled' ? 'bg-[#CE3732]' : 'bg-[#F08B46]';
  const statusLabel = event.status === 'ready_for_pickup' ? 'Ready for Pickup' : event.status;
  const mxLines = lineItems.filter(li => li.item_type === 'maintenance');
  const squawkLines = lineItems.filter(li => li.item_type === 'squawk');
  const addonLines = lineItems.filter(li => li.item_type === 'addon');

  return (
    <>
      {viewingPhoto && (
        <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewingPhoto(null)}>
          <button onClick={() => setViewingPhoto(null)} className="absolute top-4 right-4 text-white hover:text-gray-300"><X size={32}/></button>
          <img src={viewingPhoto} alt="Attachment" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      {isAppUser && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-navy" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <button onClick={() => router.push('/')} className="flex items-center gap-2 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:text-[#3AB0FF] active:scale-95 transition-all">
            <ArrowLeft size={14} /> Back to App
          </button>
        </div>
      )}

      <div className="min-h-screen bg-neutral-100 flex flex-col items-center p-4 md:p-8" style={{ paddingTop: isAppUser ? 'calc(3rem + env(safe-area-inset-top, 0px))' : 'env(safe-area-inset-top, 16px)' }}>

        <div className="mb-6 mt-4">
          <img src="/logo.png" alt="Skyward" className="mx-auto h-24 object-contain mb-2 opacity-80" />
          <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy text-center">Service Portal</h1>
        </div>

        <div className="w-full max-w-2xl space-y-6 animate-slide-up">

          {/* EVENT HEADER */}
          <div className="bg-white shadow-2xl rounded-sm overflow-hidden border-t-4 border-[#091F3C]">
            <div className="bg-[#091F3C] p-6 text-white flex justify-between items-center">
              <div>
                <h2 className="font-oswald text-3xl font-bold uppercase leading-none">{aircraft.tail_number}</h2>
                <p className="text-xs font-bold uppercase tracking-widest mt-1 opacity-90">{aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-widest block mb-1">Status</span>
                <span className={`${statusColor} px-3 py-1 rounded text-xs font-bold uppercase tracking-widest`}>{statusLabel}</span>
              </div>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Primary Contact</span>
                <span className="font-roboto font-bold text-navy">{event.primary_contact_name || 'N/A'}</span>
                {event.primary_contact_email && <a href={`mailto:${event.primary_contact_email}`} className="block text-xs text-[#3AB0FF] mt-1">{event.primary_contact_email}</a>}
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Current Times</span>
                <span className="font-roboto font-bold text-navy">
                  {aircraft.engine_type === 'Turbine' ? `AFTT: ${aircraft.total_airframe_time?.toFixed(1)} | FTT: ${aircraft.total_engine_time?.toFixed(1)}` : `Hobbs: ${aircraft.total_airframe_time?.toFixed(1)} | Tach: ${aircraft.total_engine_time?.toFixed(1)}`}
                </span>
              </div>
              {event.confirmed_date && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Confirmed Date</span>
                  <span className="font-roboto font-bold text-[#56B94A]">{event.confirmed_date}{event.service_duration_days ? ` (${event.service_duration_days} day${event.service_duration_days > 1 ? 's' : ''})` : ''}</span>
                </div>
              )}
              {event.proposed_date && !event.confirmed_date && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Proposed Date</span>
                  <span className="font-roboto font-bold text-[#F08B46]">{event.proposed_date}{event.service_duration_days ? ` (${event.service_duration_days} day${event.service_duration_days > 1 ? 's' : ''})` : ''} (by {event.proposed_by})</span>
                </div>
              )}
            </div>
          </div>

          {/* SCHEDULING ACTIONS */}
          {event.status === 'scheduling' && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#F08B46]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Calendar size={18} className="text-[#F08B46]"/> Scheduling</h3>
              
              {event.proposed_by === 'owner' && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {event.proposed_date 
                      ? <>The owner has proposed <strong>{event.proposed_date}</strong>. Does this date work for your shop?</>
                      : <>The owner has requested your availability. Please propose a service date below.</>
                    }
                  </p>
                  {event.proposed_date && (
                    <div className="space-y-3">
                      {!showConfirmWithDuration ? (
                        <div className="flex gap-3">
                          <button onClick={() => setShowConfirmWithDuration(true)} disabled={isSubmitting} className="flex-1 bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">Confirm Date</button>
                          <button onClick={() => setShowDateForm(true)} disabled={isSubmitting} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">Propose Different</button>
                        </div>
                      ) : (
                        <div className="p-4 bg-green-50 rounded border border-green-200 space-y-3 animate-fade-in">
                          <p className="text-sm font-bold text-navy">Confirming: {event.proposed_date}</p>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Estimated Duration (Days) *</label>
                            <input type="number" min="1" value={confirmDurationDays} onChange={e => setConfirmDurationDays(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none" placeholder="How many days will the aircraft be in your shop?" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Message (Optional)</label>
                            <textarea value={confirmMessage} onChange={e => setConfirmMessage(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#56B94A] outline-none min-h-[60px]" placeholder="Any notes about the service..." />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setShowConfirmWithDuration(false); setConfirmDurationDays(""); setConfirmMessage(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95">Cancel</button>
                            <button 
                              onClick={() => handleAction('confirm', { serviceDurationDays: parseInt(confirmDurationDays), message: confirmMessage || `Confirmed for ${event.proposed_date}. Estimated ${confirmDurationDays} day${parseInt(confirmDurationDays) > 1 ? 's' : ''}.` })} 
                              disabled={isSubmitting || !confirmDurationDays || parseInt(confirmDurationDays) < 1} 
                              className="flex-[2] bg-[#56B94A] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 disabled:opacity-50"
                            >
                              {isSubmitting ? "Confirming..." : "Confirm & Notify Owner"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!event.proposed_date && !showDateForm && (
                    <button onClick={() => setShowDateForm(true)} className="w-full bg-[#091F3C] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform">Propose a Date</button>
                  )}
                </div>
              )}

              {(event.proposed_by === 'mechanic' || (!event.proposed_date && event.proposed_by !== 'owner')) && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">{event.proposed_by === 'mechanic' ? 'Waiting for owner to confirm your proposed date.' : 'Please propose a service date.'}</p>
                  {!event.proposed_date && (
                    <button onClick={() => setShowDateForm(true)} className="w-full bg-[#091F3C] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform">Propose a Date</button>
                  )}
                </div>
              )}

              {showDateForm && (
                <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200 space-y-3 animate-fade-in">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Proposed Date *</label>
                    <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Estimated Duration (Days) *</label>
                    <input type="number" min="1" value={serviceDurationDays} onChange={e => setServiceDurationDays(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="How many days will the aircraft be in your shop?" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Shop Availability (Optional)</label>
                    <textarea value={availabilityNote} onChange={e => setAvailabilityNote(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[60px]" placeholder="e.g. We're booked through March 15. Earliest opening is March 17-21." />
                    <p className="text-[10px] text-gray-400 mt-1">Let the owner know about your upcoming availability so they can plan accordingly.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Additional Message (Optional)</label>
                    <textarea value={commentText} onChange={e => setCommentText(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[60px]" placeholder="Any other notes..." />
                  </div>
                  <button 
                    onClick={() => {
                      const fullMessage = [availabilityNote ? `Shop Availability: ${availabilityNote}` : '', commentText].filter(Boolean).join('\n\n');
                      handleAction('propose_date', { proposedDate, serviceDurationDays: parseInt(serviceDurationDays), message: fullMessage });
                    }} 
                    disabled={isSubmitting || !proposedDate || !serviceDurationDays || parseInt(serviceDurationDays) < 1} 
                    className="w-full bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {isSubmitting ? "Sending..." : "Send Proposal"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* WORK PACKAGE — MX ITEMS */}
          {mxLines.length > 0 && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#F08B46]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Wrench size={18} className="text-[#F08B46]"/> Maintenance Items</h3>
              <div className="space-y-3">
                {mxLines.map((li: any) => (
                  <div key={li.id} className={`p-4 border rounded ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : li.line_status === 'in_progress' ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-oswald font-bold uppercase text-sm text-navy">{li.item_name}</h4>
                        {li.item_description && <p className="text-xs text-gray-500 mt-1">{li.item_description}</p>}
                        {li.mechanic_comment && <p className="text-xs text-[#3AB0FF] mt-2 italic">Note: {li.mechanic_comment}</p>}
                      </div>
                      {event.status !== 'complete' && (
                        <select value={li.line_status} onChange={e => handleLineStatusUpdate(li.id, e.target.value)} style={whiteBg} className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 focus:border-[#F08B46] outline-none">
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="complete">Complete</option>
                          <option value="deferred">Deferred</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SQUAWKS WITH PHOTOS */}
          {squawkLines.length > 0 && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#CE3732]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><AlertTriangle size={18} className="text-[#CE3732]"/> Squawks</h3>
              <div className="space-y-3">
                {squawkLines.map((li: any) => {
                  const photos = li.squawk_id ? (squawkPhotos[li.squawk_id] || []) : [];
                  return (
                    <div key={li.id} className={`p-4 border rounded ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-oswald font-bold uppercase text-sm text-navy">{li.item_name}</h4>
                          {li.item_description && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{li.item_description}</p>}
                          {li.mechanic_comment && <p className="text-xs text-[#3AB0FF] mt-2 italic">Note: {li.mechanic_comment}</p>}
                          {photos.length > 0 && (
                            <div className="mt-3">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Image size={12} /> {photos.length} Photo{photos.length > 1 ? 's' : ''} Attached</p>
                              <div className="flex gap-2 flex-wrap">
                                {photos.map((url: string, idx: number) => (
                                  <button key={idx} onClick={() => setViewingPhoto(url)} className="w-20 h-20 rounded border-2 border-gray-200 overflow-hidden hover:border-[#CE3732] transition-colors active:scale-95">
                                    <img src={url} alt={`Squawk photo ${idx + 1}`} className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {event.status !== 'complete' && (
                          <select value={li.line_status} onChange={e => handleLineStatusUpdate(li.id, e.target.value)} style={whiteBg} className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 focus:border-[#CE3732] outline-none ml-3 shrink-0">
                            <option value="pending">Pending</option>
                            <option value="in_progress">In Progress</option>
                            <option value="complete">Complete</option>
                            <option value="deferred">Deferred</option>
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ADDITIONAL SERVICES */}
          {addonLines.length > 0 && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#3AB0FF]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Sparkles size={18} className="text-[#3AB0FF]"/> Additional Services</h3>
              <div className="space-y-3">
                {addonLines.map((li: any) => (
                  <div key={li.id} className={`p-4 border rounded ${li.line_status === 'complete' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-navy">{li.item_name}</span>
                      {event.status !== 'complete' && (
                        <select value={li.line_status} onChange={e => handleLineStatusUpdate(li.id, e.target.value)} style={whiteBg} className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 focus:border-[#3AB0FF] outline-none">
                          <option value="pending">Pending</option>
                          <option value="complete">Complete</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SUGGEST ADDITIONAL WORK */}
          {event.status !== 'complete' && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#F08B46]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Plus size={18} className="text-[#F08B46]"/> Suggest Additional Work</h3>
              {!showSuggestForm ? (
                <button onClick={() => setShowSuggestForm(true)} className="w-full border-2 border-dashed border-gray-300 text-gray-500 font-bold py-3 rounded hover:bg-gray-50 hover:border-[#F08B46] active:scale-95 transition-all text-sm uppercase tracking-widest">+ Add Discovered Item</button>
              ) : (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Item Name *</label>
                    <input type="text" value={suggestName} onChange={e => setSuggestName(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="e.g. Replace left main brake pads" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description / Reason (Optional)</label>
                    <textarea value={suggestDescription} onChange={e => setSuggestDescription(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[80px]" placeholder="Pads worn below minimum thickness during inspection..." />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowSuggestForm(false); setSuggestName(""); setSuggestDescription(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95">Cancel</button>
                    <button onClick={async () => { if (!suggestName.trim()) return alert("Item name is required."); await handleAction('suggest_item', { itemName: suggestName, itemDescription: suggestDescription, message: suggestName }); setSuggestName(""); setSuggestDescription(""); setShowSuggestForm(false); }} disabled={isSubmitting || !suggestName.trim()} className="flex-[2] bg-[#F08B46] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Adding..." : "Add & Notify Owner"}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* UPLOAD FILES / DOCUMENTS */}
          {event.status !== 'complete' && event.status !== 'cancelled' && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#3AB0FF]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Upload size={18} className="text-[#3AB0FF]"/> Upload Photos &amp; Documents</h3>
              {!showUploadForm ? (
                <button onClick={() => setShowUploadForm(true)} className="w-full border-2 border-dashed border-gray-300 text-gray-500 font-bold py-3 rounded hover:bg-gray-50 hover:border-[#3AB0FF] active:scale-95 transition-all text-sm uppercase tracking-widest">+ Attach Files</button>
              ) : (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2 mb-2"><Paperclip size={14}/> Select Files (Max 5, {MAX_UPLOAD_SIZE_LABEL} each)</label>
                    <input type="file" multiple accept="image/*,.pdf,.doc,.docx" onChange={(e) => { if (e.target.files) { const newFiles = Array.from(e.target.files); const sizeError = validateFileSizes(newFiles); if (sizeError) { alert(sizeError); e.target.value = ''; return; } const combined = [...uploadFiles, ...newFiles].slice(0, 5); setUploadFiles(combined); } }} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100 file:text-navy cursor-pointer w-full" />
                    <p className="text-[10px] text-gray-400 mt-1">Accepted: Photos (JPG, PNG, WebP, HEIC), PDFs, and Word documents.</p>
                  </div>
                  {uploadFiles.length > 0 && (
                    <div className="space-y-2">
                      {uploadFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded border border-gray-200">
                          {isImageType(file.type) ? (
                            <div className="w-10 h-10 rounded overflow-hidden shrink-0 border border-gray-200"><img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" /></div>
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center shrink-0"><FileText size={18} className="text-gray-500" /></div>
                          )}
                          <div className="flex-1 min-w-0"><p className="text-xs font-bold text-navy truncate">{file.name}</p><p className="text-[10px] text-gray-400">{formatFileSize(file.size)}</p></div>
                          <button onClick={() => removeUploadFile(idx)} className="text-gray-400 hover:text-red-500 shrink-0 active:scale-95"><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description (Optional)</label>
                    <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#3AB0FF] outline-none min-h-[60px]" placeholder="e.g. Photos of corroded exhaust gasket, work order estimate attached..." />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowUploadForm(false); setUploadFiles([]); setUploadDescription(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95">Cancel</button>
                    <button onClick={handleFileUpload} disabled={isUploading || uploadFiles.length === 0} className="flex-[2] bg-[#3AB0FF] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2">{isUploading ? <><Loader2 size={14} className="animate-spin" /> Uploading...</> : `Upload & Notify Owner`}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESTIMATED COMPLETION & NOTES */}
          {event.status !== 'complete' && event.status !== 'cancelled' && (event.status === 'confirmed' || event.status === 'in_progress' || event.status === 'ready_for_pickup') && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#091F3C]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Clock size={18} className="text-[#091F3C]"/> Estimated Completion</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Expected Ready Date</label>
                  <input type="date" value={estimatedCompletion} onChange={e => setEstimatedCompletion(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#091F3C] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Notes for Owner</label>
                  <textarea value={mechanicNotes} onChange={e => setMechanicNotes(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#091F3C] outline-none min-h-[80px]" placeholder="Parts on order, waiting for weather, etc." />
                </div>
                <button onClick={() => handleAction('update_estimate', { proposedDate: estimatedCompletion, message: mechanicNotes })} disabled={isSubmitting} className="w-full bg-[#091F3C] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Updating..." : "Save & Notify Owner"}</button>
              </div>
            </div>
          )}

          {/* MARK AIRCRAFT READY */}
          {event.status !== 'complete' && event.status !== 'cancelled' && event.status !== 'ready_for_pickup' && lineItems.length > 0 && lineItems.every(li => li.line_status === 'complete') && (
            <div className="bg-green-50 shadow-lg rounded-sm p-6 border-t-4 border-[#56B94A]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Plane size={18} className="text-[#56B94A]"/> All Work Complete</h3>
              <p className="text-sm text-gray-600 mb-4">All line items are marked complete. Notify the owner that the aircraft is ready for pickup.</p>
              {!showReadyConfirm ? (
                <button onClick={() => setShowReadyConfirm(true)} className="w-full bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform flex items-center justify-center gap-2"><CheckCircle size={18} /> Mark Aircraft Ready for Pickup</button>
              ) : (
                <div className="space-y-3 animate-fade-in">
                  <textarea value={readyMessage} onChange={e => setReadyMessage(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-[#56B94A] outline-none min-h-[60px]" placeholder="Any pickup notes for the owner (optional)..." />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowReadyConfirm(false); setReadyMessage(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95">Cancel</button>
                    <button onClick={() => handleAction('mark_ready', { message: readyMessage })} disabled={isSubmitting} className="flex-[2] bg-[#56B94A] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Notifying..." : "Confirm & Notify Owner"}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* READY FOR PICKUP BANNER */}
          {event.status === 'ready_for_pickup' && (
            <div className="bg-green-50 border-2 border-green-200 rounded-sm p-6 text-center">
              <Plane size={48} className="mx-auto text-[#56B94A] mb-4" />
              <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-2">Aircraft Ready</h3>
              <p className="text-sm text-gray-600">The owner has been notified that the aircraft is ready for pickup.</p>
            </div>
          )}

          {/* DECLINE SERVICE */}
          {event.status !== 'complete' && event.status !== 'cancelled' && event.status !== 'ready_for_pickup' && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-red-200">
              {!showDeclineConfirm ? (
                <button onClick={() => setShowDeclineConfirm(true)} className="w-full text-[10px] font-bold uppercase tracking-widest text-[#CE3732] border border-red-200 bg-red-50 rounded py-2.5 hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-1.5"><XCircle size={12} /> Unable to Accommodate — Decline Service</button>
              ) : (
                <div className="space-y-3 animate-fade-in">
                  <p className="text-sm font-bold text-navy">Are you sure you want to decline this service request?</p>
                  <p className="text-xs text-gray-500">The owner will be notified via email.</p>
                  <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} style={whiteBg} className="w-full border border-gray-300 rounded p-3 text-sm focus:border-[#CE3732] outline-none min-h-[60px]" placeholder="Reason (optional) — e.g. shop fully booked through Q2, recommend contacting..." />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowDeclineConfirm(false); setDeclineReason(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95">Keep Event</button>
                    <button onClick={() => handleAction('decline', { message: declineReason })} disabled={isSubmitting} className="flex-[2] bg-[#CE3732] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">{isSubmitting ? "Declining..." : "Decline & Notify Owner"}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CANCELLED STATE */}
          {event.status === 'cancelled' && (
            <div className="bg-red-50 border-2 border-red-200 rounded-sm p-6 text-center">
              <XCircle size={48} className="mx-auto text-[#CE3732] mb-4" />
              <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-2">Service Cancelled</h3>
              <p className="text-sm text-gray-600">This service event has been cancelled.</p>
            </div>
          )}

          {/* COMMUNICATION THREAD */}
          <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-gray-400">
            <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><MessageSquare size={18} className="text-gray-500"/> Communication</h3>
            <div className="space-y-3 mb-6 max-h-[400px] overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 italic py-4">No messages yet.</p>
              ) : (
                messages.map((msg: any) => (
                  <div key={msg.id} className={`p-3 rounded text-sm ${msg.sender === 'mechanic' ? 'bg-blue-50 border-l-4 border-[#3AB0FF]' : msg.sender === 'owner' ? 'bg-orange-50 border-l-4 border-[#F08B46]' : 'bg-gray-50 border-l-4 border-gray-300'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{msg.sender === 'mechanic' ? 'Maintenance' : msg.sender === 'owner' ? 'Owner' : 'System'}</span>
                      <span className="text-[10px] text-gray-400">{new Date(msg.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-navy whitespace-pre-wrap">{msg.message}</p>
                    {msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Paperclip size={10} /> {msg.attachments.length} Attachment{msg.attachments.length > 1 ? 's' : ''}</p>
                        <div className="flex gap-2 flex-wrap">
                          {msg.attachments.map((att: any, idx: number) => {
                            const isImg = att.type && att.type.startsWith('image/');
                            if (isImg) return (<button key={idx} onClick={() => setViewingPhoto(att.url)} className="w-20 h-20 rounded border-2 border-gray-200 overflow-hidden hover:border-[#3AB0FF] transition-colors active:scale-95"><img src={att.url} alt={att.filename} className="w-full h-full object-cover" /></button>);
                            return (<a key={idx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded hover:border-[#3AB0FF] transition-colors"><FileText size={16} className="text-gray-500 shrink-0" /><div className="min-w-0"><p className="text-xs font-bold text-navy truncate max-w-[120px]">{att.filename}</p>{att.size && <p className="text-[10px] text-gray-400">{att.size < 1024 * 1024 ? (att.size / 1024).toFixed(0) + ' KB' : (att.size / (1024 * 1024)).toFixed(1) + ' MB'}</p>}</div></a>);
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {event.status !== 'complete' && (
              <div className="flex gap-2">
                <textarea value={commentText} onChange={e => setCommentText(e.target.value)} style={whiteBg} className="flex-1 border border-gray-300 rounded p-3 text-sm focus:border-[#3AB0FF] outline-none min-h-[60px]" placeholder="Send a message..." />
                <button onClick={() => handleAction('comment', { message: commentText })} disabled={isSubmitting || !commentText.trim()} className="bg-[#3AB0FF] text-white px-4 rounded active:scale-95 transition-transform disabled:opacity-50"><Send size={18}/></button>
              </div>
            )}
          </div>

          {/* COMPLETED STATE */}
          {event.status === 'complete' && (
            <div className="bg-green-50 border-2 border-green-200 rounded-sm p-6 text-center">
              <CheckCircle size={48} className="mx-auto text-[#56B94A] mb-4" />
              <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-2">Service Complete</h3>
              <p className="text-sm text-gray-600">This maintenance event was completed on {new Date(event.completed_at).toLocaleDateString()}.</p>
            </div>
          )}

        </div>

        <div className="mt-8 mb-4 text-center">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Powered by Skyward Aircraft Manager</p>
        </div>
      </div>
    </>
  );
}
