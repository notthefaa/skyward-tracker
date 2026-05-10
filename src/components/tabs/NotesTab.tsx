import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { newIdempotencyKey, idempotencyHeader } from "@/lib/idempotencyClient";
import { validateFileSizes, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { FileText, Plus, X, Upload, Edit2, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import { compressImage } from "@/lib/imageCompress";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import SectionSelector from "@/components/shell/SectionSelector";
import { MORE_SELECTOR_ITEMS, emitMoreNavigate } from "@/components/shell/moreNav";
import { useSignedUrls } from "@/hooks/useSignedUrls";
import { ModalPortal } from "@/components/ModalPortal";
import { mutateWithDeadline } from "@/lib/mutateWithDeadline";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function NotesTab({ aircraft, session, role, aircraftRole, userInitials, onNotesRead }: { aircraft: any, session: any, role: string, aircraftRole: AircraftRole | null, userInitials: string, onNotesRead: () => void }) {
  
  const { data: notes = [], mutate } = useSWR<any[]>(
    aircraft ? swrKeys.notes(aircraft.id) : null,
    async () => {
      // One cookie-bearing call replaces the previous 2 reads + 1
      // upsert dance. Server reads notes, computes unread, upserts
      // read receipts, returns the notes plus a list of just-marked-
      // read ids so we can refresh the unread-badge in AppShell.
      const res = await authFetch(`/api/notes?aircraftId=${aircraft.id}`);
      if (!res.ok) throw new Error(`notes fetch failed: ${res.status}`);
      const body = await res.json() as { notes: any[]; newlyMarkedRead: string[] };
      if (body.newlyMarkedRead?.length > 0) onNotesRead();
      return body.notes || [];
    }
  );

  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sticky idempotency key for the note-create POST. PUT (edit) is
  // inherently idempotent (target by note_id), so only the create
  // branch needs this. Reset on form open.
  const submitIdemKeyRef = useRef<string | null>(null);

  const { showSuccess, showError } = useToast();
  const resolve = useSignedUrls();
  const confirm = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);

  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  const isAdmin = role === 'admin' || aircraftRole === 'admin';

  useModalScrollLock(showModal || !!previewImages);

  // Aircraft switch — close the editor and drop any in-progress draft
  // so a note typed for tail A (with photos already picked) can never
  // submit against tail B's id.
  useEffect(() => {
    setShowModal(false);
    setEditingId(null);
    setContent("");
    setSelectedImages([]);
    setExistingImages([]);
    setPreviewImages(null);
    setPreviewIndex(0);
    submitIdemKeyRef.current = null;
  }, [aircraft?.id]);

  const openForm = (note: any = null) => {
    if (note) {
      setEditingId(note.id);
      setContent(note.content || "");
      setExistingImages(note.pictures || []);
    } else {
      setEditingId(null);
      setContent("");
      setExistingImages([]);
    }
    setSelectedImages([]);
    submitIdemKeyRef.current = null;
    setShowModal(true);
  };

  const handleImageSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const sizeError = validateFileSizes(files);
    if (sizeError) {
      showError(sizeError);
      e.target.value = '';
      return;
    }
    setSelectedImages(files);
  };

  // Returns both the public URL (for storing in the note row) AND the
  // storage path (for rollback if the note insert fails). Same shape
  // as SquawksTab — see there for the rationale.
  const uploadImages = async (): Promise<{ url: string; path: string }[]> => {
    const uploaded: { url: string; path: string }[] = [];
    const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };

    for (const file of selectedImages) {
      try {
        const compressedFile = await compressImage(file, options);
        // Sanitize tail + filename — the orphan-sweeper diffs storage
        // paths against stored URLs by exact match, and a slash from
        // a dashboard-edited tail or a user-supplied "../foo.jpg"
        // would create folders that drift out of the diff.
        const safeTail = String(aircraft.tail_number || 'aircraft').replace(/[^A-Za-z0-9-]/g, '_');
        const safeName = compressedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileName = `${safeTail}_${Date.now()}_${safeName}`;

        const { data } = await supabase.storage.from('aft_note_images').upload(fileName, compressedFile);

        if (data) {
          const { data: urlData } = supabase.storage.from('aft_note_images').getPublicUrl(data.path);
          uploaded.push({ url: urlData.publicUrl, path: data.path });
        }
      } catch (error) {
        console.error("Error compressing/uploading image:", error);
      }
    }
    return uploaded;
  };

  // Fire-and-forget rollback when the note insert fails after images
  // have already landed in storage.
  const cleanupUploadedImages = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      await supabase.storage.from('aft_note_images').remove(paths);
    } catch (err) {
      console.error("Failed to clean up orphaned note images:", err);
    }
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Try/catch/finally — bare throws used to leave the button frozen
    // in "Saving…" forever on API error.
    // Upload images first so we can roll them back if the note insert
    // fails. uploadedPathsToRollback is used by the catch branch.
    const uploadedThisSubmit = await uploadImages();
    const uploadedPathsToRollback = uploadedThisSubmit.map(u => u.path);
    try {
      const allPictures = [...existingImages, ...uploadedThisSubmit.map(u => u.url)];

      const noteData: any = {
        aircraft_id: aircraft.id,
        content,
        pictures: allPictures
      };

      if (editingId) {
        noteData.edited_at = new Date().toISOString();
        const res = await authFetch('/api/notes', {
          method: 'PUT',
          body: JSON.stringify({ noteId: editingId, aircraftId: aircraft.id, noteData })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't update the note"); }
      } else {
        noteData.author_email = session.user.email;
        noteData.author_initials = userInitials;
        if (!submitIdemKeyRef.current) submitIdemKeyRef.current = newIdempotencyKey();
        const res = await authFetch('/api/notes', {
          method: 'POST',
          headers: idempotencyHeader(submitIdemKeyRef.current),
          body: JSON.stringify({ aircraftId: aircraft.id, noteData })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't create the note"); }

        try {
          // Fresh idempotency key per submit so a network-blip retry
          // hits the cached 200 instead of resending the email to
          // every assigned pilot. Matches the squawk-notify pattern.
          const notifyKey = newIdempotencyKey();
          await authFetch('/api/emails/note-notify', {
            method: 'POST',
            headers: idempotencyHeader(notifyKey),
            body: JSON.stringify({ note: { ...noteData, author_initials: userInitials }, aircraft })
          });
        } catch (err) {
          // Notification failure is non-blocking — the note saved. Log
          // for ops but don't surface a toast that implies the note
          // write itself failed.
          console.error("Failed to send note notification", err);
        }
      }

      await mutateWithDeadline(mutate());
      setShowModal(false);
      showSuccess(editingId ? "Note updated" : "Note posted");
    } catch (err: any) {
      // Note row never landed — remove the images we just uploaded
      // so they don't sit in storage forever with no referencing row.
      await cleanupUploadedImages(uploadedPathsToRollback);
      showError(err?.message || "Couldn't save the note.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteNote = async (id: string) => {
    const ok = await confirm({
      title: "Delete Note?",
      message: "This note will be permanently removed from the message board.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/notes', {
        method: 'DELETE',
        body: JSON.stringify({ noteId: id, aircraftId: aircraft.id })
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Couldn't delete the note"); }
      await mutateWithDeadline(mutate());
      showSuccess('Note deleted.');
    } catch (err: any) {
      showError(err?.message || "Couldn't delete the note.");
    }
  };

  if (!aircraft) return null;

  return (
    <>
      <SectionSelector
        items={MORE_SELECTOR_ITEMS}
        selectedKey="notes"
        onSelect={(key) => emitMoreNavigate(key)}
        compact
      />
      <div className="mb-2">
        <PrimaryButton onClick={() => openForm()}>
          <Plus size={18} /> Add New Note
        </PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-navy mb-6">
        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 mb-6 leading-none">Flight Notes</h2>
        
        <div className="space-y-4">
          {notes.length === 0 ? (<p className="text-center text-sm text-gray-400 py-4">No notes for this aircraft.</p>) : (
            notes.map(note => (
              <div key={note.id} className="p-4 border border-navy/20 bg-white rounded shadow-sm">
                
                <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-navy block">
                      {note.author_initials ? `${note.author_initials} (${note.author_email})` : note.author_email || 'Pilot'}
                    </span>
                    <span className="text-[10px] uppercase text-gray-400 font-bold">
                      {new Date(note.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      {note.edited_at && <span className="text-mxOrange ml-2">(Edited: {new Date(note.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})</span>}
                    </span>
                  </div>
                  
                  <div className="flex gap-3 items-center">
                    {(isAdmin || note.author_id === session.user.id) && (
                      <button onClick={() => openForm(note)} className="text-gray-400 hover:text-navy active:scale-95" aria-label="Edit note" title="Edit Note">
                        <Edit2 size={14}/>
                      </button>
                    )}
                    {(isAdmin || note.author_id === session.user.id) && (
                      <button onClick={() => deleteNote(note.id)} className="text-gray-400 hover:text-danger active:scale-95" aria-label="Delete note" title="Delete Note">
                        <Trash2 size={14}/>
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{note.content}</p>

                {note.pictures && note.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pt-2">
                    {note.pictures.map((pic: string, i: number) => (
                      <button key={i} onClick={() => { setPreviewImages(note.pictures); setPreviewIndex(i); }} className="active:scale-95 transition-transform shrink-0">
                        <img src={resolve(pic) || pic} loading="lazy" alt="Note Attachment" className="h-20 w-20 object-cover rounded border border-gray-300 shadow-sm" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {previewImages && (
        <ModalPortal>
        <div className="fixed inset-0 z-[10000] bg-black/95 overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={() => setPreviewImages(null)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <button className="absolute top-4 right-4 text-gray-400 hover:text-white z-50 p-2">
            <X size={32}/>
          </button>

          {previewImages.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === 0 ? previewImages.length - 1 : prev - 1); }} className="absolute left-4 text-gray-400 hover:text-white z-50 p-2">
              <ChevronLeft size={48}/>
            </button>
          )}

          <div className="max-w-full max-h-full p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={resolve(previewImages[previewIndex]) || previewImages[previewIndex]} className="max-h-[85vh] max-w-full object-contain rounded shadow-2xl" />
          </div>

          {previewImages.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); setPreviewIndex(prev => prev === previewImages.length - 1 ? 0 : prev + 1); }} className="absolute right-4 text-gray-400 hover:text-white z-50 p-2">
              <ChevronRight size={48}/>
            </button>
          )}

          <div className="absolute bottom-6 text-gray-400 font-oswald tracking-widest text-sm uppercase">
            Image {previewIndex + 1} of {previewImages.length}
          </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showModal && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up">
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
                <FileText size={20} className="text-navy"/> {editingId ? 'Edit Note' : 'Add Note'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-danger">
                <X size={24}/>
              </button>
            </div>
            
            <form onSubmit={submitNote} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Message *</label>
                <textarea style={whiteBg} 
                  required 
                  value={content} 
                  onChange={e=>setContent(e.target.value)} 
                  className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-navy outline-none bg-white min-h-[120px]" 
                  placeholder="Share info with the next pilot..." 
                />
              </div>
              
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2 mb-2">
                  <Upload size={14}/> Attach Photos (Max {MAX_UPLOAD_SIZE_LABEL} each)
                </label>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  onChange={handleImageSelection} 
                  className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100 file:text-navy cursor-pointer" 
                />
              </div>
              
              <div className="pt-4">
                <PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Post Note"}</PrimaryButton>
              </div>
            </form>

          </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
