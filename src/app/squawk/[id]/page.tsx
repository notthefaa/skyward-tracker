"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PlaneTakeoff, AlertTriangle, X, ChevronLeft, ChevronRight, CheckCircle } from "lucide-react";

export default function SquawkViewer() {
  const params = useParams();
  const squawkId = params.id as string;

  const [squawk, setSquawk] = useState<any>(null);
  const[aircraft, setAircraft] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Lightbox State
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  useEffect(() => {
    if (squawkId) fetchSquawkDetails();
  }, [squawkId]);

  const fetchSquawkDetails = async () => {
    // Fetch Squawk
    const { data: sqData } = await supabase.from('aft_squawks').select('*').eq('id', squawkId).single();
    if (sqData) {
      setSquawk(sqData);
      // Fetch Aircraft associated with this squawk
      const { data: acData } = await supabase.from('aft_aircraft').select('*').eq('id', sqData.aircraft_id).single();
      if (acData) setAircraft(acData);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return <div className="min-h-screen bg-slateGray flex items-center justify-center text-white font-oswald tracking-widest uppercase">Loading Report...</div>;
  }

  if (!squawk || !aircraft) {
    return <div className="min-h-screen bg-slateGray flex items-center justify-center text-white font-oswald tracking-widest uppercase">Squawk Not Found</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col items-center p-4 md:p-8">
      
      {/* BRANDING */}
      <div className="mb-6 mt-4">
        <img src="/logo.png" alt="Alis Grave Nil" className="mx-auto h-24 object-contain mb-2 opacity-80" />
        <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy text-center">Maintenance Portal</h1>
      </div>

      <div className="bg-cream shadow-2xl rounded-sm w-full max-w-2xl border-t-4 border-[#CE3732] overflow-hidden animate-slide-up">
        
        {/* HEADER */}
        <div className={`p-6 text-white flex justify-between items-center ${squawk.status === 'resolved' ? 'bg-success' : (squawk.affects_airworthiness ? 'bg-[#CE3732]' : 'bg-[#F08B46]')}`}>
          <div>
            <h2 className="font-oswald text-3xl font-bold uppercase leading-none">{aircraft.tail_number}</h2>
            <p className="text-xs font-bold uppercase tracking-widest mt-1 opacity-90">{aircraft.aircraft_type} • SN: {aircraft.serial_number || 'N/A'}</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-widest block mb-1">Status</span>
            <span className="bg-white/20 px-3 py-1 rounded text-xs font-bold uppercase tracking-widest">
              {squawk.status === 'resolved' ? 'RESOLVED' : (squawk.affects_airworthiness ? 'GROUNDED' : 'OPEN')}
            </span>
          </div>
        </div>

        <div className="p-6 md:p-8">
          
          <div className="grid grid-cols-2 gap-6 mb-8 pb-6 border-b border-gray-200">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Reported Date</span>
              <span className="font-roboto font-bold text-navy">{new Date(squawk.created_at).toLocaleDateString()}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Location</span>
              <span className="font-roboto font-bold text-navy">{squawk.location}</span>
            </div>
          </div>

          <div className="mb-8">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Description</span>
            <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{squawk.description}</p>
          </div>

          {/* DEFERRAL DATA */}
          {squawk.is_deferred && (
            <div className="mb-8 bg-blue-50 border border-blue-200 rounded p-4">
              <h4 className="font-oswald text-sm font-bold uppercase tracking-widest text-navy mb-4">Deferral Information</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">Category</span><span className="font-bold text-navy">{squawk.deferral_category || '-'}</span></div>
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">MEL #</span><span className="font-bold text-navy">{squawk.mel_number || '-'}</span></div>
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">CDL #</span><span className="font-bold text-navy">{squawk.cdl_number || '-'}</span></div>
                <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">Control #</span><span className="font-bold text-navy">{squawk.mel_control_number || '-'}</span></div>
              </div>
              <div className="pt-4 border-t border-blue-200 flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">Authorized By</span>
                  <span className="font-bold text-navy text-sm">{squawk.full_name} (Cert: {squawk.certificate_number})</span>
                </div>
                {squawk.signature_data && (
                  <img src={squawk.signature_data} alt="Signature" className="h-12 object-contain" />
                )}
              </div>
            </div>
          )}

          {/* PHOTO GALLERY */}
          {squawk.pictures && squawk.pictures.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-3">Attached Photos ({squawk.pictures.length})</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {squawk.pictures.map((pic: string, i: number) => (
                  <button key={i} onClick={() => { setPreviewImages(squawk.pictures); setPreviewIndex(i); }} className="w-full aspect-square active:scale-95 transition-transform">
                    <img src={pic} className="w-full h-full object-cover rounded shadow-md border border-gray-300" alt={`Squawk photo ${i+1}`} />
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* FULLSCREEN LIGHTBOX */}
      {previewImages && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center animate-fade-in" onClick={() => setPreviewImages(null)}>
          <button className="absolute top-4 right-4 text-gray-400 hover:text-white z-50 p-2"><X size={32}/></button>
          {previewImages.length > 1 && (<button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === 0 ? previewImages.length - 1 : prev - 1); }} className="absolute left-4 text-gray-400 hover:text-white z-50 p-2"><ChevronLeft size={48}/></button>)}
          <div className="max-w-full max-h-full p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}><img src={previewImages[previewIndex]} className="max-h-[85vh] max-w-full object-contain rounded shadow-2xl" /></div>
          {previewImages.length > 1 && (<button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === previewImages.length - 1 ? 0 : prev + 1); }} className="absolute right-4 text-gray-400 hover:text-white z-50 p-2"><ChevronRight size={48}/></button>)}
          <div className="absolute bottom-6 text-gray-400 font-oswald tracking-widest text-sm uppercase">Image {previewIndex + 1} of {previewImages.length}</div>
        </div>
      )}

    </div>
  );
}