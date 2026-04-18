import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { validateFileSizes, MAX_UPLOAD_SIZE_LABEL } from "@/lib/constants";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftRole } from "@/lib/types";
import useSWR from "swr";
import { FileText, Plus, X, Upload, Edit2, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import SectionSelector from "@/components/shell/SectionSelector";
import { MORE_SELECTOR_ITEMS, emitMoreNavigate } from "@/components/shell/moreNav";
import { useSignedUrls } from "@/hooks/useSignedUrls";

const whiteBg = { backgroundColor: '#ffffff' } as const;

export default function NotesTab({ aircraft, session, role, aircraftRole, userInitials, onNotesRead }: { aircraft: any, session: any, role: string, aircraftRole: AircraftRole | null, userInitials: string, onNotesRead: () => void }) {
  
  const { data: notes = [], mutate } = useSWR(
    aircraft ? swrKeys.notes(aircraft.id) : null,
    async () => {
      const { data: notesData } = await supabase
        .from('aft_notes')
        .select('*')
        .eq('aircraft_id', aircraft.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      
      if (notesData && notesData.length > 0) {
        const { data: readsData } = await supabase
          .from('aft_note_reads')
          .select('note_id')
          .eq('user_id', session.user.id)
          .in('note_id', notesData.map(n => n.id));
          
        const readIds = readsData ? readsData.map(r => r.note_id) : [];
        const unreadIds = notesData.filter(n => !readIds.includes(n.id)).map(n => n.id);
        
        if (unreadIds.length > 0) {
          const inserts = unreadIds.map(id => ({ note_id: id, user_id: session.user.id }));
          await supabase.from('aft_note_reads').upsert(inserts, { onConflict: 'note_id,user_id' });
          onNotesRead();
        }
      }
      return notesData || [];
    }
  );

  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        const compressedFile = await imageCompression(file, options);
        const fileName = `${aircraft.tail_number}_${Date.now()}_${compressedFile.name}`;

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
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to update note'); }
      } else {
        noteData.author_email = session.user.email;
        noteData.author_initials = userInitials;
        const res = await authFetch('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ aircraftId: aircraft.id, noteData })
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to create note'); }

        try {
          await authFetch('/api/emails/note-notify', {
            method: 'POST',
            body: JSON.stringify({ note: { ...noteData, author_initials: userInitials }, aircraft })
          });
        } catch (err) {
          // Notification failure is non-blocking — the note saved. Log
          // for ops but don't surface a toast that implies the note
          // write itself failed.
          console.error("Failed to send note notification", err);
        }
      }

      await mutate();
      setShowModal(false);
      showSuccess(editingId ? "Note updated" : "Note posted");
    } catch (err: any) {
      // Note row never landed — remove the images we just uploaded
      // so they don't sit in storage forever with no referencing row.
      await cleanupUploadedImages(uploadedPathsToRollback);
      showError(err?.message || 'Failed to save note.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteNote = async (id: string) => {
    const ok = await confirm({
      title: "Delete Note?",
      message: "This note will be permanently removed from the crew whiteboard.",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/notes', {
        method: 'DELETE',
        body: JSON.stringify({ noteId: id, aircraftId: aircraft.id })
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to delete note'); }
      await mutate();
      showSuccess('Note deleted.');
    } catch (err: any) {
      showError(err?.message || 'Failed to delete note.');
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
          {notes.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No notes for this aircraft.</p>) : (
            notes.map(note => (
              <div key={note.id} className="p-4 border border-navy/20 bg-white rounded shadow-sm">
                
                <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-navy block">
                      {note.author_initials ? `${note.author_initials} (${note.author_email})` : note.author_email || 'Pilot'}
                    </span>
                    <span className="text-[10px] uppercase text-gray-400 font-bold">
                      {new Date(note.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      {note.edited_at && <span className="text-[#F08B46] ml-2">(Edited: {new Date(note.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})</span>}
                    </span>
                  </div>
                  
                  <div className="flex gap-3 items-center">
                    {(isAdmin || note.author_id === session.user.id) && (
                      <button onClick={() => openForm(note)} className="text-gray-400 hover:text-navy active:scale-95" title="Edit Note">
                        <Edit2 size={14}/>
                      </button>
                    )}
                    {(isAdmin || note.author_id === session.user.id) && (
                      <button onClick={() => deleteNote(note.id)} className="text-gray-400 hover:text-red-500 active:scale-95" title="Delete Note">
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
            <img src={previewImages[previewIndex]} className="max-h-[85vh] max-w-full object-contain rounded shadow-2xl" />
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
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-navy animate-slide-up">
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
                <FileText size={20} className="text-navy"/> {editingId ? 'Edit Note' : 'Add Note'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500">
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
      )}
    </>
  );
}
