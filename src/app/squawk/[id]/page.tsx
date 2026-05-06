"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useBodyScrollOverride } from "@/hooks/useBodyScrollOverride";
import { fetchSignedUrlsWithToken } from "@/hooks/useSignedUrls";
import { AlertTriangle, X, Image, MapPin } from "lucide-react";

export default function SquawkViewer() {
  const params = useParams();
  // The URL segment is the squawk's `access_token` (a random
  // 32-byte base64url string). Old URLs that embedded the row UUID
  // directly no longer resolve — a deliberate tradeoff so a leaked
  // UUID from any source (audit log, DB export) doesn't leak the
  // squawk. The token is what gets distributed in mechanic emails.
  const token = params.id as string;

  const [squawk, setSquawk] = useState<any>(null);
  const [aircraft, setAircraft] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  // Map of public-URL → signed-URL for the squawk's photos.
  // aft_squawk_images is a private bucket, so the stored public URL
  // returns 400 + ORB unless we sign it. This page has no Supabase
  // auth session — token-mode signing uses the squawk access_token
  // as the auth boundary.
  const [signedMap, setSignedMap] = useState<Map<string, string>>(new Map());

  // Replace dangerouslySetInnerHTML with hook-based style override
  useBodyScrollOverride();

  useEffect(() => {
    if (!token) return;
    const ac = new AbortController();
    fetchSquawk(ac.signal);
    return () => ac.abort();
  }, [token]);

  const fetchSquawk = async (signal: AbortSignal) => {
    // Defensive 12s ceiling on each query — the project-wide supabase
    // client wraps fetches with a deadline, but the public squawk page
    // is rendered without an authenticated session and a future
    // refactor that drops the wrapper would leave this fetch hanging
    // forever on iOS suspension. Token-gated routes are exactly the
    // ones a mechanic opens and walks away from.
    const PUBLIC_FETCH_DEADLINE_MS = 12_000;
    const deadlineSignal = AbortSignal.any([signal, AbortSignal.timeout(PUBLIC_FETCH_DEADLINE_MS)]);

    try {
      const { data: sqData } = await supabase
        .from('aft_squawks').select('*').eq('access_token', token).is('deleted_at', null).abortSignal(deadlineSignal).maybeSingle();

      if (sqData) {
        setSquawk(sqData);
        const { data: acData } = await supabase
          .from('aft_aircraft').select('tail_number, aircraft_type, serial_number, mx_contact, mx_contact_email, main_contact, main_contact_email').eq('id', sqData.aircraft_id).abortSignal(deadlineSignal).single();
        if (acData) setAircraft(acData);

        const pics: string[] = Array.isArray(sqData.pictures) ? sqData.pictures : [];
        if (pics.length > 0) {
          const map = await fetchSignedUrlsWithToken(pics, token);
          setSignedMap(map);
        }
      }
    } catch {
      // Either the user navigated away (signal aborted) or the
      // 12s ceiling elapsed. Either way we render the not-found
      // shell — the loading spinner clearing is the important part.
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">Loading Squawk Report...</div>
    );
  }

  if (!squawk) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center text-navy font-oswald tracking-widest uppercase text-xl">Squawk Report Not Found</div>
    );
  }

  const photos = squawk.pictures || [];
  const isGrounded = squawk.affects_airworthiness;
  const isResolved = squawk.status === 'resolved';

  return (
    <>
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
          <img src="/logo.png" alt="Skyward Society" className="mx-auto h-24 object-contain mb-2 opacity-80" />
          <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-navy text-center">Squawk Report</h1>
        </div>

        <div className="w-full max-w-2xl space-y-6 animate-slide-up">

          {/* HEADER */}
          <div className="bg-white shadow-2xl rounded-sm overflow-hidden border-t-4 border-danger">
            <div className={`${isGrounded ? 'bg-danger' : 'bg-[#091F3C]'} p-6 text-white flex justify-between items-center`}>
              <div>
                <h2 className="font-oswald text-3xl font-bold uppercase leading-none">{aircraft?.tail_number || 'N/A'}</h2>
                <p className="text-xs font-bold uppercase tracking-widest mt-1 opacity-90">{aircraft?.aircraft_type || ''}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-widest block mb-1">Status</span>
                <span className={`${isResolved ? 'bg-[#56B94A]' : isGrounded ? 'bg-white text-danger' : 'bg-mxOrange'} px-3 py-1 rounded text-xs font-bold uppercase tracking-widest`}>
                  {isResolved ? 'Resolved' : isGrounded ? 'AOG / Grounded' : 'Monitor'}
                </span>
              </div>
            </div>

            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Reported By</span>
                <span className="font-roboto font-bold text-navy">{squawk.reporter_initials || 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Date Reported</span>
                <span className="font-roboto font-bold text-navy">{new Date(squawk.created_at).toLocaleDateString()}</span>
              </div>
              {squawk.location && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Location</span>
                  <span className="font-roboto font-bold text-navy flex items-center gap-1"><MapPin size={14} className="text-danger" /> {squawk.location}</span>
                </div>
              )}
              {aircraft?.main_contact && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Primary Contact</span>
                  <span className="font-roboto font-bold text-navy">{aircraft.main_contact}</span>
                  {aircraft.main_contact_email && <a href={`mailto:${aircraft.main_contact_email}`} className="block text-xs text-info mt-1">{aircraft.main_contact_email}</a>}
                </div>
              )}
            </div>
          </div>

          {/* DESCRIPTION */}
          <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-danger">
            <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><AlertTriangle size={18} className="text-danger"/> Discrepancy</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{squawk.description}</p>
          </div>

          {/* PHOTOS */}
          {photos.length > 0 && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-gray-400">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4 flex items-center gap-2"><Image size={18} className="text-gray-500"/> Photos ({photos.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {photos.map((url: string, idx: number) => {
                  const signed = signedMap.get(url) || url;
                  return (
                    <button
                      key={idx}
                      onClick={() => setViewingPhoto(signed)}
                      className="aspect-square rounded border-2 border-gray-200 overflow-hidden hover:border-danger transition-colors active:scale-95"
                    >
                      <img src={signed} alt={`Squawk photo ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* DEFERRAL INFO */}
          {squawk.is_deferred && (
            <div className="bg-white shadow-lg rounded-sm p-6 border-t-4 border-mxOrange">
              <h3 className="font-oswald text-lg font-bold uppercase tracking-widest text-navy mb-4">Deferral Information</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {squawk.mel_number && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">MEL</span><span className="font-bold text-navy">{squawk.mel_number}</span></div>}
                {squawk.cdl_number && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">CDL</span><span className="font-bold text-navy">{squawk.cdl_number}</span></div>}
                {squawk.nef_number && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">NEF</span><span className="font-bold text-navy">{squawk.nef_number}</span></div>}
                {squawk.deferral_category && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Category</span><span className="font-bold text-navy">{squawk.deferral_category}</span></div>}
                {squawk.full_name && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Signed By</span><span className="font-bold text-navy">{squawk.full_name}</span></div>}
                {squawk.certificate_number && <div><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Certificate #</span><span className="font-bold text-navy">{squawk.certificate_number}</span></div>}
              </div>
            </div>
          )}

          {/* RESOLVED STATE */}
          {isResolved && (
            <div className="bg-green-50 border-2 border-green-200 rounded-sm p-6 text-center">
              <div className="w-12 h-12 bg-[#56B94A] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-2">Resolved</h3>
              <p className="text-sm text-gray-600">This squawk has been resolved.</p>
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
