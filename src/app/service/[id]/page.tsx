"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { 
  Wrench, AlertTriangle, CheckCircle, Clock, Send, 
  MessageSquare, Calendar, Sparkles, X, Plus, Image
} from "lucide-react";

export default function ServicePortal() {
  const params = useParams();
  const accessToken = params.id as string;

  const [event, setEvent] = useState<any>(null);
  const [aircraft, setAircraft] = useState<any>(null);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [squawkPhotos, setSquawkPhotos] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Forms
  const [showDateForm, setShowDateForm] = useState(false);
  const [proposedDate, setProposedDate] = useState("");
  const [commentText, setCommentText] = useState("");
  const [estimatedCompletion, setEstimatedCompletion] = useState("");
  const [mechanicNotes, setMechanicNotes] = useState("");

  // Availability indicator
  const [availabilityNote, setAvailabilityNote] = useState("");

  // Suggest item form
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestDescription, setSuggestDescription] = useState("");

  // Photo viewer
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken) fetchEventData();
  }, [accessToken]);

  const fetchEventData = async () => {
    const { data: evData } = await supabase
      .from('aft_maintenance_events').select('*').eq('access_token', accessToken).single();

    if (evData) {
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
        // Fetch photos for squawk line items
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

  if (isLoading) {
    return (
      <>
        <style dangerouslySetInnerHTML={{__html: `html, body { overflow: auto !important; touch-action: auto !important; height: auto !important; }` }} />
        <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">Loading Service Portal...</div>
      </>
    );
  }

  if (!event || !aircraft) {
    return (
      <>
        <style dangerouslySetInnerHTML={{__html: `html, body { overflow: auto !important; touch-action: auto !important; height: auto !important; }` }} />
        <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">Service Event Not Found</div>
      </>
    );
  }

  const statusColor = event.status === 'complete' ? 'bg-[#56B94A]' : event.status === 'confirmed' ? 'bg-[#3AB0FF]' : 'bg-[#F08B46]';
  const mxLines = lineItems.filter(li => li.item_type === 'maintenance');
  const squawkLines = lineItems.filter(li => li.item_type === 'squawk');
  const addonLines = lineItems.filter(li => li.item_type === 'addon');

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `html, body { overflow: auto !important; touch-action: auto !important; height: auto !important; }` }} />

      {/* PHOTO LIGHTBOX */}
      {viewingPhoto && (
        <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setViewingPhoto(null)}>
          <button onClick={() => setViewingPhoto(null)} className="absolute top-4 right-4 text-white hover:text-gray-300"><X size={32}/></button>
          <img src={viewingPhoto} alt="Squawk photo" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}

      <div className="min-h-screen bg-neutral-100 flex flex-col items-center p-4 md:p-8">

        {/* BRANDING */}
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
                <span className={`${statusColor} px-3 py-1 rounded text-xs font-bold uppercase tracking-widest`}>
                  {event.status}
                </span>
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
                  <span className="font-roboto font-bold text-[#56B94A]">{event.confirmed_date}</span>
                </div>
              )}
              {event.proposed_date && !event.confirmed_date && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Proposed Date</span>
                  <span className="font-roboto font-bold text-[#F08B46]">{event.proposed_date} (by {event.proposed_by})</span>
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
                  <p className="text-sm text-gray-600">The owner has proposed <strong>{event.proposed_date}</strong>. Does this date work for your shop?</p>
                  <div className="flex gap-3">
                    <button onClick={() => handleAction('confirm')} disabled={isSubmitting} className="flex-1 bg-[#56B94A] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">
                      Confirm Date
                    </button>
                    <button onClick={() => setShowDateForm(true)} disabled={isSubmitting} className="flex-1 bg-[#F08B46] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">
                      Propose Different
                    </button>
                  </div>
                </div>
              )}

              {(event.proposed_by === 'mechanic' || !event.proposed_date) && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">{event.proposed_by === 'mechanic' ? 'Waiting for owner to confirm your proposed date.' : 'Please propose a service date.'}</p>
                  {!event.proposed_date && (
                    <button onClick={() => setShowDateForm(true)} className="w-full bg-[#091F3C] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform">
                      Propose a Date
                    </button>
                  )}
                </div>
              )}

              {showDateForm && (
                <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200 space-y-3 animate-fade-in">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Proposed Date</label>
                    <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
                  </div>

                  {/* AVAILABILITY INDICATOR */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Shop Availability (Optional)</label>
                    <textarea 
                      value={availabilityNote} 
                      onChange={e => setAvailabilityNote(e.target.value)} 
                      className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[60px]" 
                      placeholder="e.g. We're booked through March 15. Earliest opening is March 17-21. Also available the week of April 1." 
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Let the owner know about your upcoming availability so they can plan accordingly.</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Additional Message (Optional)</label>
                    <textarea value={commentText} onChange={e => setCommentText(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[60px]" placeholder="Any other notes..." />
                  </div>

                  <button 
                    onClick={() => {
                      const fullMessage = [availabilityNote ? `Shop Availability: ${availabilityNote}` : '', commentText].filter(Boolean).join('\n\n');
                      handleAction('propose_date', { proposedDate, message: fullMessage });
                    }} 
                    disabled={isSubmitting || !proposedDate} 
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
                        <select 
                          value={li.line_status} 
                          onChange={e => handleLineStatusUpdate(li.id, e.target.value)}
                          className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 bg-white focus:border-[#F08B46] outline-none"
                        >
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
                          
                          {/* SQUAWK PHOTOS */}
                          {photos.length > 0 && (
                            <div className="mt-3">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Image size={12} /> {photos.length} Photo{photos.length > 1 ? 's' : ''} Attached</p>
                              <div className="flex gap-2 flex-wrap">
                                {photos.map((url: string, idx: number) => (
                                  <button 
                                    key={idx} 
                                    onClick={() => setViewingPhoto(url)} 
                                    className="w-20 h-20 rounded border-2 border-gray-200 overflow-hidden hover:border-[#CE3732] transition-colors active:scale-95"
                                  >
                                    <img src={url} alt={`Squawk photo ${idx + 1}`} className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {event.status !== 'complete' && (
                          <select 
                            value={li.line_status}
                            onChange={e => handleLineStatusUpdate(li.id, e.target.value)}
                            className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 bg-white focus:border-[#CE3732] outline-none ml-3 shrink-0"
                          >
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
                        <select 
                          value={li.line_status}
                          onChange={e => handleLineStatusUpdate(li.id, e.target.value)}
                          className="text-[10px] font-bold uppercase border border-gray-300 rounded px-2 py-1 bg-white focus:border-[#3AB0FF] outline-none"
                        >
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
                <button onClick={() => setShowSuggestForm(true)} className="w-full border-2 border-dashed border-gray-300 text-gray-500 font-bold py-3 rounded hover:bg-gray-50 hover:border-[#F08B46] active:scale-95 transition-all text-sm uppercase tracking-widest">
                  + Add Discovered Item
                </button>
              ) : (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Item Name *</label>
                    <input type="text" value={suggestName} onChange={e => setSuggestName(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" placeholder="e.g. Replace left main brake pads" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description / Reason (Optional)</label>
                    <textarea value={suggestDescription} onChange={e => setSuggestDescription(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none min-h-[80px]" placeholder="Pads worn below minimum thickness during inspection..." />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowSuggestForm(false); setSuggestName(""); setSuggestDescription(""); }} className="flex-1 border border-gray-300 text-gray-600 font-bold py-2 rounded text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-95">Cancel</button>
                    <button 
                      onClick={async () => {
                        if (!suggestName.trim()) return alert("Item name is required.");
                        await handleAction('suggest_item', { itemName: suggestName, itemDescription: suggestDescription, message: suggestName });
                        setSuggestName(""); setSuggestDescription(""); setShowSuggestForm(false);
                      }} 
                      disabled={isSubmitting || !suggestName.trim()} 
                      className="flex-[2] bg-[#F08B46] text-white font-bold py-2 rounded text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {isSubmitting ? "Adding..." : "Add & Notify Owner"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESTIMATED COMPLETION & NOTES */}
          {event.status !== 'complete' && (event.status === 'confirmed' || event.status === 'in_progress') && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-[#091F3C]">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Clock size={18} className="text-[#091F3C]"/> Estimated Completion</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Expected Ready Date</label>
                  <input type="date" value={estimatedCompletion} onChange={e => setEstimatedCompletion(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#091F3C] outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Notes for Owner</label>
                  <textarea value={mechanicNotes} onChange={e => setMechanicNotes(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#091F3C] outline-none min-h-[80px]" placeholder="Parts on order, waiting for weather, etc." />
                </div>
                <button onClick={() => handleAction('update_estimate', { proposedDate: estimatedCompletion, message: mechanicNotes })} disabled={isSubmitting} className="w-full bg-[#091F3C] text-white font-oswald font-bold uppercase tracking-widest py-3 rounded active:scale-95 transition-transform disabled:opacity-50">
                  {isSubmitting ? "Updating..." : "Save & Notify Owner"}
                </button>
              </div>
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
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        {msg.sender === 'mechanic' ? 'Maintenance' : msg.sender === 'owner' ? 'Owner' : 'System'}
                      </span>
                      <span className="text-[10px] text-gray-400">{new Date(msg.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-navy whitespace-pre-wrap">{msg.message}</p>
                  </div>
                ))
              )}
            </div>

            {event.status !== 'complete' && (
              <div className="flex gap-2">
                <textarea value={commentText} onChange={e => setCommentText(e.target.value)} className="flex-1 border border-gray-300 rounded p-3 text-sm focus:border-[#3AB0FF] outline-none min-h-[60px]" placeholder="Send a message..." />
                <button onClick={() => handleAction('comment', { message: commentText })} disabled={isSubmitting || !commentText.trim()} className="bg-[#3AB0FF] text-white px-4 rounded active:scale-95 transition-transform disabled:opacity-50">
                  <Send size={18}/>
                </button>
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
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Powered by Skyward Fleet Management</p>
        </div>
      </div>
    </>
  );
}
