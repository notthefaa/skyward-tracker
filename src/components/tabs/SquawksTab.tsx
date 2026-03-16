import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, Plus, X, Upload, Mail, Edit2, CheckCircle2 } from "lucide-react";
import { PrimaryButton, AddButton } from "@/components/AppButtons";
import SignatureCanvas from "react-signature-canvas";

export default function SquawksTab({ aircraft, session, onGroundedStatusChange }: { aircraft: any, session: any, onGroundedStatusChange: () => void }) {
  const[squawks, setSquawks] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sigCanvas = useRef<SignatureCanvas>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const[description, setDescription] = useState("");
  const [affectsAirworthiness, setAffectsAirworthiness] = useState(false);
  const [isDeferred, setIsDeferred] = useState(false);
  const[status, setStatus] = useState<'open'|'resolved'>('open');
  
  // Images
  const[selectedImages, setSelectedImages] = useState<File[]>([]);
  const[existingImages, setExistingImages] = useState<string[]>([]);
  
  // Deferral Fields
  const[mel, setMel] = useState("");
  const [cdl, setCdl] = useState("");
  const[nef, setNef] = useState("");
  const [mdl, setMdl] = useState("");
  const [melControl, setMelControl] = useState("");
  const [category, setCategory] = useState("");
  const [procCompleted, setProcCompleted] = useState(false);
  const[fullName, setFullName] = useState("");
  const [certNum, setCertNum] = useState("");

  const isTurbine = aircraft?.engine_type === 'Turbine';
  const reporterEmail = session?.user?.email || "Unknown Pilot";

  useEffect(() => {
    if (aircraft) fetchSquawks();
  },[aircraft?.id]);

  const fetchSquawks = async () => {
    const { data } = await supabase.from('aft_squawks').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false });
    if (data) setSquawks(data);
  };

  const openForm = (squawk: any = null) => {
    if (squawk) {
      setEditingId(squawk.id);
      setLocation(squawk.location || "");
      setDescription(squawk.description || "");
      setAffectsAirworthiness(squawk.affects_airworthiness || false);
      setIsDeferred(squawk.is_deferred || false);
      setStatus(squawk.status || 'open');
      setExistingImages(squawk.pictures ||[]);
      setMel(squawk.mel_number || "");
      setCdl(squawk.cdl_number || "");
      setNef(squawk.nef_number || "");
      setMdl(squawk.mdl_number || "");
      setMelControl(squawk.mel_control_number || "");
      setCategory(squawk.deferral_category || "");
      setProcCompleted(squawk.deferral_procedures_completed || false);
      setFullName(squawk.full_name || "");
      setCertNum(squawk.certificate_number || "");
    } else {
      setEditingId(null); setLocation(""); setDescription(""); setAffectsAirworthiness(false); setIsDeferred(false); setStatus('open');
      setExistingImages([]); setSelectedImages([]); setMel(""); setCdl(""); setNef(""); setMdl(""); setMelControl(""); setCategory("");
      setProcCompleted(false); setFullName(""); setCertNum("");
      if (sigCanvas.current) sigCanvas.current.clear();
    }
    setShowModal(true);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setSelectedImages(Array.from(e.target.files));
  };

  const uploadImages = async (): Promise<string[]> => {
    let uploadedPaths: string[] =[];
    for (const file of selectedImages) {
      const fileName = `${aircraft.tail_number}_${Date.now()}_${file.name}`;
      const { data } = await supabase.storage.from('aft_squawk_images').upload(fileName, file);
      if (data) {
        const { data: publicUrlData } = supabase.storage.from('aft_squawk_images').getPublicUrl(data.path);
        uploadedPaths.push(publicUrlData.publicUrl);
      }
    }
    return uploadedPaths;
  };

  const submitSquawk = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const uploadedUrls = await uploadImages();
    const allPictures =[...existingImages, ...uploadedUrls];

    let signatureData = null;
    let sigDate = null;

    if (isDeferred && sigCanvas.current && !sigCanvas.current.isEmpty()) {
      signatureData = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
      sigDate = new Date().toISOString().split('T')[0];
    }

    const squawkData = {
      aircraft_id: aircraft.id,
      reported_by: session.user.id,
      location,
      description,
      affects_airworthiness: affectsAirworthiness,
      status,
      pictures: allPictures,
      is_deferred: isDeferred,
      mel_number: mel,
      cdl_number: cdl,
      nef_number: nef,
      mdl_number: mdl,
      mel_control_number: melControl,
      deferral_category: category || null,
      deferral_procedures_completed: procCompleted,
      full_name: fullName,
      certificate_number: certNum,
      ...(signatureData && { signature_data: signatureData, signature_date: sigDate })
    };

    if (editingId) {
      await supabase.from('aft_squawks').update(squawkData).eq('id', editingId);
    } else {
      await supabase.from('aft_squawks').insert(squawkData);
    }

    await fetchSquawks();
    onGroundedStatusChange(); 
    setShowModal(false);
    setIsSubmitting(false);
  };

  const handleShareMx = (sq: any) => {
    const subject = encodeURIComponent(`Squawk Report: ${aircraft.tail_number}`);
    let body = `Aircraft: ${aircraft.tail_number} (Serial: ${aircraft.serial_number || 'N/A'})\n`;
    body += `Reported Date: ${new Date(sq.created_at).toLocaleDateString()}\n`;
    body += `Status: ${sq.status.toUpperCase()}\n`;
    body += `Airworthiness Affected: ${sq.affects_airworthiness ? 'YES (GROUNDED)' : 'NO'}\n\n`;
    body += `Location: ${sq.location}\n`;
    body += `Description: ${sq.description}\n\n`;
    if (sq.is_deferred) {
      body += `--- DEFERRAL DETAILS ---\n`;
      body += `Category: ${sq.deferral_category}\n`;
      body += `MEL/CDL/NEF/MDL: ${sq.mel_number} / ${sq.cdl_number} / ${sq.nef_number} / ${sq.mdl_number}\n`;
    }
    if (sq.pictures && sq.pictures.length > 0) body += `\nImage Links attached in portal.`;
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
  };

  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={() => openForm()}>
          <Plus size={18} /> Report New Squawk
        </PrimaryButton>
      </div>

      {/* CHANGED border-red-600 TO border-brandOrange HERE */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-brandOrange mb-6">
        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 mb-6 leading-none">Active Squawks</h2>
        
        <div className="space-y-4">
          {squawks.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No squawks on file.</p>) : (
            squawks.map(sq => (
              <div key={sq.id} className={`p-4 border rounded ${sq.status === 'resolved' ? 'border-green-200 bg-green-50' : (sq.affects_airworthiness ? 'border-red-400 bg-red-50' : 'border-orange-200 bg-orange-50')}`}>
                
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded text-white ${sq.status === 'resolved' ? 'bg-success' : (sq.affects_airworthiness ? 'bg-red-600' : 'bg-brandOrange')}`}>
                      {sq.status === 'resolved' ? 'RESOLVED' : (sq.affects_airworthiness ? 'AOG / GROUNDED' : 'OPEN')}
                    </span>
                    {sq.is_deferred && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-blue-600 text-white">DEFERRED ({sq.deferral_category})</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleShareMx(sq)} className="text-gray-500 hover:text-brandOrange active:scale-95" title="Email MX"><Mail size={16}/></button>
                    <button onClick={() => openForm(sq)} className="text-gray-500 hover:text-brandOrange active:scale-95" title="Edit"><Edit2 size={16}/></button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{new Date(sq.created_at).toLocaleDateString()} | {sq.location}</p>
                  <p className="text-sm text-navy mt-1 font-roboto">{sq.description}</p>
                </div>

                {sq.pictures && sq.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {sq.pictures.map((pic: string, i: number) => (
                      <a key={i} href={pic} target="_blank" rel="noreferrer">
                        <img src={pic} alt="Squawk" className="h-16 w-16 object-cover rounded border border-gray-300 shadow-sm" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-brandOrange max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy">{editingId ? 'Edit Squawk' : 'Report Squawk'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button>
            </div>

            <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-4 grid grid-cols-2 gap-2 text-xs">
              <div><span className="font-bold text-gray-500 uppercase">Date:</span> {new Date().toLocaleDateString()}</div>
              <div><span className="font-bold text-gray-500 uppercase">Tail:</span> {aircraft.tail_number}</div>
              <div><span className="font-bold text-gray-500 uppercase">Serial:</span> {aircraft.serial_number || 'N/A'}</div>
              <div className="truncate"><span className="font-bold text-gray-500 uppercase">By:</span> {reporterEmail}</div>
            </div>
            
            <form onSubmit={submitSquawk} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Status</label>
                  <select value={status} onChange={e=>setStatus(e.target.value as any)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-brandOrange bg-white font-bold">
                    <option value="open">Open</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Affects Airworthiness?</label>
                  <select value={affectsAirworthiness ? "yes" : "no"} onChange={e=>setAffectsAirworthiness(e.target.value === "yes")} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-red-500 bg-white font-bold">
                    <option value="no">No (Monitor)</option>
                    <option value="yes">YES (GROUNDED)</option>
                  </select>
                </div>
              </div>

              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Location on Aircraft <span className="text-red-500">*</span></label><input type="text" required value={location} onChange={e=>setLocation(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-brandOrange" placeholder="e.g. Left Main Gear" /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Description <span className="text-red-500">*</span></label><textarea required value={description} onChange={e=>setDescription(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-brandOrange min-h-[100px]" placeholder="Detailed description..." /></div>
              <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2 mb-2"><Upload size={14}/> Attach Photos</label><input type="file" multiple accept="image/*" onChange={handleImageSelect} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-bold file:bg-gray-100 file:text-navy hover:file:bg-gray-200 cursor-pointer" /></div>

              {isTurbine && status === 'open' && (
                <div className="border border-blue-200 rounded p-4 bg-blue-50/30">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy mb-4"><input type="checkbox" checked={isDeferred} onChange={e=>setIsDeferred(e.target.checked)} className="w-4 h-4" /> Item Deferred</label>
                  {isDeferred && (
                    <div className="space-y-4 animate-fade-in">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MEL #</label><input type="text" value={mel} onChange={e=>setMel(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">CDL #</label><input type="text" value={cdl} onChange={e=>setCdl(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">NEF #</label><input type="text" value={nef} onChange={e=>setNef(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">MDL #</label><input type="text" value={mdl} onChange={e=>setMdl(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Control #</label><input type="text" value={melControl} onChange={e=>setMelControl(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Category</label><select value={category} onChange={e=>setCategory(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1 bg-white"><option value="">Select...</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="NA">N/A</option></select></div>
                      </div>
                      <div className="pt-2"><label className="flex items-start gap-2 text-xs font-bold text-navy"><input type="checkbox" required checked={procCompleted} onChange={e=>setProcCompleted(e.target.checked)} className="mt-1" /> I have completed the related deferral procedures as required by the MEL, CDL, NEF, or MDL.</label></div>
                      <div className="pt-4 border-t border-gray-200">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-navy block mb-2">Signature <span className="text-red-500">*</span></label>
                        <div className="border border-gray-300 rounded bg-white"><SignatureCanvas ref={sigCanvas} penColor="black" canvasProps={{ className: 'w-full h-32 rounded' }} /></div>
                        <button type="button" onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-bold uppercase text-gray-500 mt-1 hover:text-red-500">Clear Signature</button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Full Name <span className="text-red-500">*</span></label><input type="text" required value={fullName} onChange={e=>setFullName(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                        <div><label className="text-[10px] font-bold uppercase tracking-widest text-navy">Certificate # <span className="text-red-500">*</span></label><input type="text" required value={certNum} onChange={e=>setCertNum(e.target.value)} className="w-full border border-gray-300 rounded p-2 text-sm mt-1" /></div>
                      </div>
                    </div>
                  )}
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