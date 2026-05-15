"use client";

import { useState, useEffect, useRef } from "react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { registerPendingUpload } from "@/hooks/useDocStatusWatcher";
import { supabase } from "@/lib/supabase";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { idempotencyHeader } from "@/lib/idempotencyClient";
import { useToast } from "@/components/ToastProvider";
import { friendlyPgError } from "@/lib/pgErrors";
import type { AircraftWithMetrics } from "@/lib/types";
import { X } from "lucide-react";
import AircraftForm, { type AircraftFormPayload } from "@/components/AircraftForm";
import { parseSetupMeters } from "@/lib/aircraftSetup";

export default function AircraftModal({
  session,
  existingAircraft,
  onClose,
  onSuccess,
}: {
  session: any;
  existingAircraft: AircraftWithMetrics | null;
  onClose: () => void;
  onSuccess: (newTail: string) => void | Promise<void>;
}) {
  useModalScrollLock();
  useEscapeKey(onClose);
  const { showError, showWarning } = useToast();

  // Track whether the aircraft has flight logs (locks time fields in edit mode).
  const [hasFlightLogs, setHasFlightLogs] = useState(false);
  useEffect(() => {
    if (!existingAircraft) return;
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('aft_flight_logs')
        .select('id', { count: 'exact', head: true })
        .eq('aircraft_id', existingAircraft.id);
      if (!cancelled) setHasFlightLogs((count || 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [existingAircraft]);

  // Per-file idempotency keys for the doc-upload loop. Without a
  // sticky key per File, a user retry of the create-aircraft form
  // (e.g., one PDF failed, they tap Save again) would re-embed every
  // PDF with a fresh key → server has no dedup signal → double-charge
  // on OpenAI. Keys live in this parent ref so they persist across
  // submission retries within the same modal session.
  const docIdemKeys = useRef<Map<File, string>>(new Map());

  const handleHowardSetup = () => {
    // Close the modal, then dispatch the navigate-howard event with
    // a sessionStorage prefill so Howard kicks off in setup mode.
    // The popup launcher listens for the event + reads the prefill.
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
        }),
      );
    } catch { /* sessionStorage write failures are non-fatal */ }
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('aft:navigate-howard'));
    }, 100);
  };

  const handleSubmit = async (payload: AircraftFormPayload) => {
    const tailUpper = payload.tailNumber.toUpperCase();
    let avatarUrl: string | null = existingAircraft?.avatar_url || null;

    // 1. Avatar upload (best-effort).
    if (payload.avatarChanged) {
      const croppedFile = await payload.getCroppedAvatar();
      if (croppedFile) {
        try {
          // Extension + explicit contentType: without these, Supabase
          // serves the object as application/octet-stream, and Firefox's
          // OpaqueResponseBlocking refuses to render it inside <img>.
          const safeTail = tailUpper.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileName = `${safeTail}_${Date.now()}.jpg`;
          // Race the upload against UPLOAD_TIMEOUT_MS. supabase-js storage
          // uses XHR with no client-side timeout, and iOS Safari (PWA in
          // particular) can suspend a stalled upload indefinitely — that
          // leaves the "Saving..." button stuck forever. Fail-soft: drop
          // the photo, save the aircraft, warn the user.
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

    // 2. Assemble the base payload + time fields.
    // parseSetupMeters also coerces a solo airframe-0 to null when
    // the engine reading is positive — see helper for the rationale.
    // Engine time is validated to be a finite non-negative number by
    // AircraftForm before onSubmit fires (when fields aren't locked).
    // For edit-with-flight-logs the field is disabled and we keep the
    // existing setup_* values via the latest-log path below.
    const { setupAirframe, setupEngine } = parseSetupMeters(
      payload.airframeTimeRaw,
      payload.engineTimeRaw,
    );

    const basePayload: Record<string, any> = {
      tail_number: tailUpper,
      serial_number: payload.serialNumber,
      make: payload.make.trim() || null,
      type_certificate: payload.typeCertificate.trim() || null,
      aircraft_type: payload.aircraftType,
      engine_type: payload.engineType,
      home_airport: payload.homeAirport,
      time_zone: payload.timeZone || 'UTC',
      main_contact: payload.mainContact,
      main_contact_phone: payload.mainContactPhone,
      main_contact_email: payload.mainContactEmail,
      mx_contact: payload.mxContact,
      mx_contact_phone: payload.mxContactPhone,
      mx_contact_email: payload.mxContactEmail,
      is_ifr_equipped: payload.isIfrEquipped,
      avatar_url: avatarUrl,
    };

    if (existingAircraft) {
      // ── EDIT MODE ────────────────────────────────────────────
      Object.assign(basePayload, {
        setup_aftt: payload.engineType === 'Turbine' ? setupAirframe : null,
        setup_ftt: payload.engineType === 'Turbine' ? setupEngine : null,
        setup_hobbs: payload.engineType === 'Piston' ? setupAirframe : null,
        setup_tach: payload.engineType === 'Piston' ? setupEngine : null,
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
          return;
        }

        if (latestLog && latestLog.length > 0) {
          const log = latestLog[0] as any;
          if (payload.engineType === 'Turbine') {
            basePayload.total_airframe_time = setupAirframe != null
              ? (log.aftt != null ? log.aftt : setupAirframe)
              : (log.ftt ?? existingAircraft.total_engine_time ?? 0);
            basePayload.total_engine_time = log.ftt ?? existingAircraft.total_engine_time ?? 0;
          } else {
            basePayload.total_airframe_time = setupAirframe != null
              ? (log.hobbs != null ? log.hobbs : setupAirframe)
              : (log.tach ?? existingAircraft.total_engine_time ?? 0);
            basePayload.total_engine_time = log.tach ?? existingAircraft.total_engine_time ?? 0;
          }
        }
      } else {
        // No flight logs — setup values are the starting point, so totals = setup.
        // If no airframe meter, airframe time tracks the engine time.
        basePayload.total_airframe_time = setupAirframe != null ? setupAirframe : (setupEngine ?? 0);
        basePayload.total_engine_time = setupEngine ?? 0;
      }

      const { error: updateError } = await supabase
        .from('aft_aircraft')
        .update(basePayload)
        .eq('id', existingAircraft.id);
      if (updateError) {
        console.error('[AircraftModal] Update failed:', updateError);
        showError("Couldn't update the aircraft: " + friendlyPgError(updateError));
        return;
      }
    } else {
      // ── CREATE MODE ─────────────────────────────────────────
      Object.assign(basePayload, {
        total_airframe_time: setupAirframe != null ? setupAirframe : (setupEngine ?? 0),
        total_engine_time: setupEngine ?? 0,
        setup_aftt: payload.engineType === 'Turbine' ? setupAirframe : null,
        setup_ftt: payload.engineType === 'Turbine' ? setupEngine : null,
        setup_hobbs: payload.engineType === 'Piston' ? setupAirframe : null,
        setup_tach: payload.engineType === 'Piston' ? setupEngine : null,
        created_by: session.user.id,
      });

      let newAircraftId: string | null = null;
      try {
        const res = await authFetch('/api/aircraft/create', {
          method: 'POST',
          body: JSON.stringify({ payload: basePayload }),
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

      // Best-effort: save equipment rows the user typed in.
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

      // Best-effort: upload documents via direct-to-storage flow.
      // Bytes go browser → Supabase Storage, bypassing Vercel's 4.5 MB
      // inbound body cap so routine 10–20 MB POH/AFM uploads land
      // instead of silently failing.
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
            if (!signRes.ok) {
              const bodyText = await signRes.text().catch(() => '');
              console.error('[aircraft-create] signed-upload-url failed:', df.file.name, signRes.status, bodyText.slice(0, 200));
              failures.push(df.file.name);
              continue;
            }
            const { token, storagePath } = await signRes.json();

            const uploadRes = await Promise.race([
              supabase.storage
                .from('aft_aircraft_documents')
                .uploadToSignedUrl(storagePath, token, df.file, { contentType: 'application/pdf' }),
              new Promise<{ data: null; error: Error }>(resolve =>
                setTimeout(() => resolve({ data: null, error: new Error('storage_upload_timeout') }), UPLOAD_TIMEOUT_MS),
              ),
            ]);
            if (uploadRes.error) {
              console.error('[aircraft-create] storage upload failed:', df.file.name, uploadRes.error.message);
              failures.push(df.file.name);
              continue;
            }

            // Sticky idempotency key per file — see comment on the
            // docIdemKeys ref above for why this lives in the parent.
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
            if (!res.ok) {
              const bodyText = await res.text().catch(() => '');
              console.error('[aircraft-create] register failed:', df.file.name, res.status, bodyText.slice(0, 200));
              failures.push(df.file.name);
              continue;
            }
            // Tell the AppShell watcher to expect this doc id — covers
            // the case where the server-side `after()` finishes before
            // the watcher's first poll observes the 'processing' state.
            try {
              const body = await res.json();
              if (body?.document?.id) registerPendingUpload(body.document.id);
            } catch { /* swallow — toast lifecycle is best-effort */ }
          } catch (err: any) {
            console.error('[aircraft-create] doc upload threw:', df.file.name, err?.message || err);
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
    }

    // Await onSuccess so the "Saving..." spinner stays through the
    // parent's fleet refetch + activeTail flip. Without the await,
    // the button un-disables and a quick second tap surfaces a
    // duplicate-tail error against the user's own freshly-created
    // aircraft.
    await onSuccess(tailUpper);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-mxOrange animate-slide-up">

          <div className="flex justify-between items-center mb-4">
            <h2 className="font-oswald text-2xl font-bold uppercase text-navy">
              {existingAircraft ? 'Edit Aircraft' : 'Add Aircraft'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-danger transition-colors">
              <X size={24}/>
            </button>
          </div>

          <AircraftForm
            mode={existingAircraft ? 'edit' : 'create'}
            initialAircraft={existingAircraft}
            hasFlightLogs={hasFlightLogs}
            showHowardButton
            onHowardSetup={handleHowardSetup}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
