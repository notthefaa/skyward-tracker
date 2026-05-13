"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { authFetch, UPLOAD_TIMEOUT_MS } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { supabase } from "@/lib/supabase";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics, AircraftDocument, DocType } from "@/lib/types";
import useSWR from "swr";
import { Upload, Trash2, FileText, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import SectionSelector from "@/components/shell/SectionSelector";
import { MORE_SELECTOR_ITEMS, emitMoreNavigate } from "@/components/shell/moreNav";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { registerPendingUpload } from "@/hooks/useDocStatusWatcher";

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'POH', label: "Pilot's Operating Handbook" },
  { value: 'AFM', label: 'Aircraft Flight Manual' },
  { value: 'Supplement', label: 'Supplement' },
  { value: 'MEL', label: 'Minimum Equipment List' },
  { value: 'SOP', label: 'Standard Operating Procedures' },
  { value: 'Registration', label: 'Registration' },
  { value: 'Airworthiness Certificate', label: 'Airworthiness Certificate' },
  { value: 'Weight and Balance', label: 'Weight and Balance' },
  { value: 'Other', label: 'Other' },
];

export default function DocumentsTab({
  aircraft, session, role
}: {
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
}) {
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();
  const resolve = useSignedUrls();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocType>('POH');
  // Sticky idempotency for the PDF upload POST. A network blip + user
  // tap retry uses the same key so OpenAI doesn't re-charge embeddings
  // on a successful upload that the client thinks failed. Cleared on
  // success so the next deliberate upload of a different PDF gets a
  // fresh key.
  const uploadIdemKeyRef = useRef<string | null>(null);

  // Aircraft switch — drop any picked PDF + reset the doc-type so a
  // POH selected for tail A can never upload against tail B's id (the
  // server pulls aircraftId from FormData at submit time, not at file
  // pick). Also clear the sticky idempotency key — a left-over key
  // from tail A would otherwise be reused for tail B's first upload
  // and the server's idem cache would return the wrong response.
  useEffect(() => {
    setSelectedFile(null);
    setDocType('POH');
    setUploadProgress('');
    uploadIdemKeyRef.current = null;
  }, [aircraft?.id]);

  // Howard handoff: when Howard's open_documents_uploader tool fires,
  // AppShell stashes a pre-fill payload in sessionStorage and
  // navigates here. Consume + clear so a later tab-switch back doesn't
  // re-apply the stale pre-fill. The setTimeout defers the scroll
  // until after the layout settles — without it the upload form is
  // still being mounted and scrollIntoView lands on the wrong y-offset.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('aft_open_documents_upload');
      if (!raw) return;
      sessionStorage.removeItem('aft_open_documents_upload');
      const data = JSON.parse(raw) as { docType?: string };
      if (data.docType && DOC_TYPES.some(t => t.value === data.docType)) {
        setDocType(data.docType as DocType);
      }
      setTimeout(() => {
        const el = document.querySelector('input[type="file"][accept="application/pdf"]');
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 120);
    } catch {
      // Bad JSON / sessionStorage error — no-op. The pilot still sees
      // the Documents tab; they just have to scroll + pick docType
      // themselves.
    }
  }, [aircraft?.id]);

  const { data, mutate } = useSWR(
    aircraft ? swrKeys.docs(aircraft.id) : null,
    async () => {
      const res = await authFetch(`/api/documents?aircraftId=${aircraft!.id}`);
      if (!res.ok) throw new Error("Couldn't load documents");
      return await res.json() as { documents: AircraftDocument[] };
    }
  );

  const documents = data?.documents || [];

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !aircraft || isUploading) return;

    if (selectedFile.type !== 'application/pdf') {
      showError('Only PDF files are supported.');
      return;
    }
    if (selectedFile.size > 30 * 1024 * 1024) {
      showError('File too large (max 30 MB). Try compressing or splitting the PDF.');
      return;
    }
    // iCloud-stub / partially-downloaded files commonly report 0 bytes.
    if (selectedFile.size === 0) {
      showError("That file is empty — if it lives in iCloud, open the Files app and tap to download it first, then try again.");
      return;
    }

    setIsUploading(true);
    setUploadProgress('Preparing upload...');

    // Log file metadata up front so field reports always carry it,
    // even if the upload throws somewhere outside the catch.
    console.log('[documents] uploading:', selectedFile.name, `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`, selectedFile.type);

    try {
      // ── Step 1: ask the server for a signed upload URL ────────────
      // The server validates aircraft access + size cap + scrubs the
      // filename into a storage path scoped to this aircraft.
      const signRes = await authFetch('/api/documents/signed-upload-url', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          filename: selectedFile.name,
          size: selectedFile.size,
        }),
      });
      if (!signRes.ok) {
        const d = await signRes.json().catch(() => ({}));
        throw new Error(d.error || 'Could not prepare upload.');
      }
      const { token, storagePath } = await signRes.json();

      // ── Step 2: upload bytes directly to Supabase Storage ─────────
      // This is the step that bypasses Vercel's 4.5 MB inbound body
      // cap — bytes go browser → storage with no Vercel hop.
      setUploadProgress('Uploading PDF...');
      const uploadRes = await Promise.race([
        supabase.storage
          .from('aft_aircraft_documents')
          .uploadToSignedUrl(storagePath, token, selectedFile, { contentType: 'application/pdf' }),
        new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error('storage_upload_timeout') }), UPLOAD_TIMEOUT_MS),
        ),
      ]);
      if (uploadRes.error) throw uploadRes.error;

      // ── Step 3: register the document ─────────────────────────────
      // Server creates the row at status='processing' and returns
      // immediately; pdf-parse + OpenAI embeddings run in the
      // background (Next's `after()`). The status-watcher hook in
      // AppShell will surface a toast when the row flips to 'ready'.
      // Idempotency key sticky across retries so a slow `after()`
      // can't be re-triggered by a network blip + retry.
      setUploadProgress('Filing the document…');
      if (!uploadIdemKeyRef.current) uploadIdemKeyRef.current = newIdempotencyKey();
      const res = await authFetch('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          aircraftId: aircraft.id,
          docType,
          storagePath,
          filename: selectedFile.name,
        }),
        headers: idempotencyHeader(uploadIdemKeyRef.current),
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        let serverError = '';
        try {
          const d = JSON.parse(bodyText);
          serverError = d?.error || '';
        } catch {
          // Non-JSON body shouldn't happen on this route anymore (no
          // FormData → no 413 surface), but keep the fallback so a
          // Vercel infra 5xx HTML page can't crash JSON.parse.
        }
        throw new Error(serverError || `Upload failed (status ${res.status}).`);
      }

      const result = await res.json();
      uploadIdemKeyRef.current = null;
      // Register the new doc id with the status watcher so a very fast
      // server-side embed (small PDF) that completes BEFORE the
      // watcher's next poll still produces a toast — without this,
      // the first-sighting-silencing rule would swallow the terminal
      // status.
      if (result?.document?.id) registerPendingUpload(result.document.id);
      showSuccess("Uploaded! Indexing the document in the background — we'll let you know when it's searchable. Feel free to keep using the app.");
      setSelectedFile(null);
      mutate();
    } catch (err: any) {
      console.error(
        '[documents] upload failed:',
        err?.name,
        err?.message,
        'file:',
        selectedFile?.name,
        selectedFile?.size,
        selectedFile?.type,
        err,
      );
      showError(err?.message || "Couldn't upload the document.");
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  }, [selectedFile, aircraft, isUploading, docType, mutate, showSuccess, showError]);

  const handleDelete = async (doc: AircraftDocument) => {
    if (!aircraft) return;
    const ok = await confirm({ title: 'Delete Document?', message: `Delete "${doc.filename}"? Howard will no longer be able to reference it.`, confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      const res = await authFetch('/api/documents', {
        method: 'DELETE',
        body: JSON.stringify({ documentId: doc.id, aircraftId: aircraft.id }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Couldn't delete the document."); }
      showSuccess('Document deleted.');
      mutate();
    } catch (err: any) { showError(err.message); }
  };

  const isAdmin = role === 'admin';
  if (!aircraft) return null;

  return (
    <>
      <SectionSelector
        items={MORE_SELECTOR_ITEMS}
        selectedKey="documents"
        onSelect={(key) => emitMoreNavigate(key)}
        compact
      />
      {/* Upload section */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#56B94A] flex flex-col mb-6">
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#56B94A] block mb-1">Aircraft Library</span>
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Documents</h2>
          </div>
        </div>

        {/* Upload form */}
        <div className="bg-white rounded-sm border border-gray-200 p-4 mb-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-3">Upload Document</span>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">Document Type</label>
              <select
                value={docType}
                onChange={e => setDocType(e.target.value as DocType)}
                className="w-full rounded p-3 text-sm border border-gray-300 focus:border-[#56B94A] outline-none"
                style={{ backgroundColor: '#ffffff' }}
              >
                {DOC_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 block">PDF File</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  setSelectedFile(e.target.files?.[0] || null);
                  // Reset the idempotency ref so a NEW file picked
                  // after a failed prior upload doesn't reuse the
                  // old key (which would make the server's idem
                  // cache return the prior 'processing' response).
                  uploadIdemKeyRef.current = null;
                }}
                className="w-full text-sm text-navy file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-bold file:bg-navy file:text-white file:uppercase file:tracking-widest file:cursor-pointer"
              />
              {selectedFile && (
                <span className="text-[10px] text-gray-500 mt-1 block">{selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span>
              )}
            </div>
            {isUploading ? (
              <div className="flex items-center gap-2 text-sm text-[#56B94A] font-roboto">
                <Loader2 size={16} className="animate-spin" />
                <span>{uploadProgress}</span>
              </div>
            ) : (
              <PrimaryButton onClick={handleUpload} disabled={!selectedFile}>
                <Upload size={18} /> Upload & Index
              </PrimaryButton>
            )}
          </div>
        </div>

        {/* Document list */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-navy text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <th className="pb-2 pr-4">Document</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Pages</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Uploaded</th>
                <th className="pb-2 pr-4"></th>
                {isAdmin && <th className="pb-2"></th>}
              </tr>
            </thead>
            <tbody className="text-xs font-roboto text-navy">
              {documents.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-8">No documents uploaded yet. Upload a POH or AFM to let Howard reference it.</td></tr>
              )}
              {documents.map(doc => (
                <tr key={doc.id} className="border-b border-gray-200 hover:bg-blue-50/50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className={doc.status === 'error' ? 'text-gray-400 shrink-0' : 'text-[#56B94A] shrink-0'} />
                      {doc.status === 'error' ? (
                        // Storage object was removed by failDocument; no
                        // link to render. Show the filename + reason
                        // inline so the user knows what to retry.
                        <span className="text-gray-500 truncate max-w-[260px]" title={doc.last_error_reason || undefined}>
                          {doc.filename}
                          {doc.last_error_reason ? ` — ${doc.last_error_reason}` : ''}
                        </span>
                      ) : (
                        <a href={resolve(doc.file_url) || '#'} target="_blank" rel="noopener noreferrer" className="text-info underline truncate max-w-[180px]">{doc.filename}</a>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider">{doc.doc_type}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">{doc.page_count || '—'}</td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {doc.status === 'ready' && <span className="inline-flex items-center gap-1 text-[#56B94A] font-bold"><CheckCircle size={12} /> Ready</span>}
                    {doc.status === 'processing' && <span className="inline-flex items-center gap-1 text-mxOrange font-bold"><Loader2 size={12} className="animate-spin" /> Processing</span>}
                    {doc.status === 'error' && <span className="inline-flex items-center gap-1 text-danger font-bold"><AlertCircle size={12} /> Error</span>}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                  <td className="py-3 pr-4 whitespace-nowrap" />
                  {isAdmin && (
                    <td className="py-3 text-right">
                      <button onClick={() => handleDelete(doc)} className="text-gray-400 hover:text-danger transition-colors"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-gray-400 mt-4 text-center">
          Uploaded documents are searchable by Howard. Ask questions like &quot;What is the Vne?&quot; or &quot;Show me the emergency checklist.&quot;
        </p>
      </div>
    </>
  );
}
