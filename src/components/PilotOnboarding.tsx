"use client";

import { useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { idempotencyHeader } from "@/lib/idempotencyClient";
import { registerPendingUpload } from "@/hooks/useDocStatusWatcher";
import { useToast } from "@/components/ToastProvider";
import { LogOut } from "lucide-react";
import AircraftForm, { type AircraftFormPayload } from "@/components/AircraftForm";

export default function PilotOnboarding({
  session,
  handleLogout,
  onSuccess,
}: {
  session: any;
  handleLogout: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { showError, showWarning } = useToast();

  // Per-file sticky idempotency keys for the doc-upload loop. See
  // AircraftModal for the rationale — same shape applies here for
  // pilots who upload POH/AFM/etc. during onboarding.
  const docIdemKeys = useRef<Map<File, string>>(new Map());

  const handleSubmit = async (payload: AircraftFormPayload) => {
    const tailUpper = payload.tailNumber.toUpperCase();
    let avatarUrl: string | null = null;

    // 1. Avatar upload (best-effort — same shape as AircraftModal).
    if (payload.avatarChanged) {
      const croppedFile = await payload.getCroppedAvatar();
      if (croppedFile) {
        try {
          const safeTail = tailUpper.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${safeTail}_${Date.now()}.jpg`;
          const uploadRes = await Promise.race([
            supabase.storage.from('aft_aircraft_avatars').upload(fileName, croppedFile, { contentType: 'image/jpeg' }),
            new Promise<{ data: null; error: Error }>(resolve =>
              setTimeout(() => resolve({ data: null, error: new Error('avatar_upload_timeout') }), UPLOAD_TIMEOUT_MS),
            ),
          ]);
          if (uploadRes.error) throw uploadRes.error;
          if (uploadRes.data) {
            const { data: urlData } = supabase.storage.from('aft_aircraft_avatars').getPublicUrl(uploadRes.data.path);
            avatarUrl = urlData.publicUrl;
          }
        } catch (err) {
          console.error('Avatar upload failed:', err);
          showWarning("Photo upload didn't work. Aircraft saved without it — you can add a photo later.");
        }
      }
    }

    // 2. Create the aircraft via /api/aircraft/create.
    const setupAirframe = payload.airframeTimeRaw !== '' ? parseFloat(payload.airframeTimeRaw) : null;
    // AircraftForm rejects blank/non-finite engineTimeRaw before
    // onSubmit fires, so parseFloat here is safe (no NaN fallback).
    const setupEngine = parseFloat(payload.engineTimeRaw);

    const apiPayload = {
      tail_number: tailUpper,
      serial_number: payload.serialNumber,
      aircraft_type: payload.aircraftType,
      engine_type: payload.engineType,
      total_airframe_time: setupAirframe != null ? setupAirframe : setupEngine,
      total_engine_time: setupEngine,
      setup_aftt: payload.engineType === 'Turbine' ? setupAirframe : null,
      setup_ftt: payload.engineType === 'Turbine' ? setupEngine : null,
      setup_hobbs: payload.engineType === 'Piston' ? setupAirframe : null,
      setup_tach: payload.engineType === 'Piston' ? setupEngine : null,
      home_airport: payload.homeAirport,
      main_contact: payload.mainContact,
      main_contact_phone: payload.mainContactPhone,
      main_contact_email: payload.mainContactEmail,
      mx_contact: payload.mxContact,
      mx_contact_phone: payload.mxContactPhone,
      mx_contact_email: payload.mxContactEmail,
      avatar_url: avatarUrl,
      make: payload.make.trim() || null,
      time_zone: payload.timeZone || 'UTC',
      is_ifr_equipped: payload.isIfrEquipped,
      created_by: session.user.id,
    };

    let newAircraftId: string | null = null;
    try {
      const res = await authFetch('/api/aircraft/create', {
        method: 'POST',
        body: JSON.stringify({ payload: apiPayload }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Couldn't create the aircraft.");
      }
      const result = await res.json();
      newAircraftId = result.aircraft?.id || null;
    } catch (err: any) {
      showError(err.message);
      return;
    }

    // 3. Best-effort equipment save (skip empty rows).
    if (newAircraftId && payload.equipmentRows.length > 0) {
      const validRows = payload.equipmentRows.filter(r => r.name.trim());
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

    // 4. Best-effort docs upload (same direct-to-storage flow as the
    //    modal — bypasses Vercel's 4.5 MB inbound body cap).
    if (newAircraftId && payload.docFiles.length > 0) {
      const failures: string[] = [];
      for (const df of payload.docFiles) {
        try {
          const signRes = await authFetch('/api/documents/signed-upload-url', {
            method: 'POST',
            body: JSON.stringify({
              aircraftId: newAircraftId,
              filename: df.file.name,
              size: df.file.size,
            }),
          });
          if (!signRes.ok) { failures.push(df.file.name); continue; }
          const { token, storagePath } = await signRes.json();

          const uploadRes = await Promise.race([
            supabase.storage
              .from('aft_aircraft_documents')
              .uploadToSignedUrl(storagePath, token, df.file, { contentType: 'application/pdf' }),
            new Promise<{ data: null; error: Error }>(resolve =>
              setTimeout(() => resolve({ data: null, error: new Error('storage_upload_timeout') }), UPLOAD_TIMEOUT_MS),
            ),
          ]);
          if (uploadRes.error) { failures.push(df.file.name); continue; }

          let idemKey = docIdemKeys.current.get(df.file);
          if (!idemKey) {
            idemKey = crypto.randomUUID();
            docIdemKeys.current.set(df.file, idemKey);
          }
          const res = await authFetch('/api/documents', {
            method: 'POST',
            body: JSON.stringify({
              aircraftId: newAircraftId,
              docType: df.docType,
              storagePath,
              filename: df.file.name,
            }),
            headers: idempotencyHeader(idemKey),
            timeoutMs: UPLOAD_TIMEOUT_MS,
          });
          if (!res.ok) { failures.push(df.file.name); continue; }
          try {
            const body = await res.json();
            if (body?.document?.id) registerPendingUpload(body.document.id);
          } catch { /* swallow — toast lifecycle is best-effort */ }
        } catch (err: any) {
          console.error('[onboarding] doc upload threw:', df.file.name, err?.message || err);
          failures.push(df.file.name);
        }
      }
      if (failures.length > 0) {
        const total = payload.docFiles.length;
        const succeeded = total - failures.length;
        const failedList = failures.join(', ');
        if (succeeded === 0) {
          showWarning(`Aircraft saved, but none of the ${total} document(s) uploaded (${failedList}). Retry from the Documents tab.`);
        } else {
          showWarning(`Aircraft saved with ${succeeded}/${total} document(s). Failed: ${failedList}. Retry the rest from the Documents tab.`);
        }
      }
    }

    // 5. Await onSuccess so the "Saving..." spinner stays through the
    //    parent's fleet refetch + onboarding-flag flip. Without the
    //    await, a quick second tap surfaces a duplicate-tail error
    //    against the user's own freshly-created aircraft.
    await onSuccess();
  };

  return (
    <div className="flex flex-col bg-neutral-100 min-h-[100dvh] w-full overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="bg-navy text-white shadow-md z-20 shrink-0 w-full">
        <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center w-full min-h-[60px]">
          <h1 className="font-oswald text-xl font-bold uppercase tracking-widest text-white m-0 leading-none">Skyward Aircraft Manager</h1>
          <button onClick={handleLogout} className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0" title="Logout">
            <LogOut size={18} /><span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </header>
      <div className="flex-1 p-4 flex justify-center items-start pt-8 pb-20">
        <div className="bg-cream shadow-2xl rounded-sm w-full max-w-lg p-6 md:p-8 border-t-4 border-mxOrange animate-slide-up">
          <div className="text-center mb-8">
            <h2 className="font-oswald text-3xl font-bold uppercase tracking-widest text-navy mb-2">Set Up Your Aircraft</h2>
            <p className="text-sm text-gray-500 font-roboto">Start with the airplane&apos;s basics. Once it&apos;s set up, flight logs and maintenance tracking kick in.</p>
          </div>
          <AircraftForm
            mode="create"
            onSubmit={handleSubmit}
            submitLabel="Save and start using Skyward"
            submittingLabel="Creating..."
          />
        </div>
      </div>
    </div>
  );
}
