import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { FileText, Plus, X, Upload, Edit2, ChevronLeft, ChevronRight } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import imageCompression from "browser-image-compression";

export default function NotesTab({ aircraft, session, onNotesRead }: { aircraft: any, session: any, onNotesRead: () => void }) {
  const [notes, setNotes] = useState<any[]>([]);
  const[showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const[content, setContent] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);

  // Lightbox State
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const[previewIndex, setPreviewIndex] = useState<number>(0);

  useEffect(() => {
    if (aircraft) fetchNotes();
  }, [aircraft?.id]);

  const fetchNotes = async () => {
    // 1. Get Notes
    const { data: notesData } = await supabase.from('aft_notes').select('*').eq('aircraft_id', aircraft.id).order('created_at', { ascending: false });
    
    if (notesData && notesData.length > 0) {
      setNotes(notesData);

      // 2. Mark unread notes as read for this user instantly
      const { data: readsData } = await supabase.from('aft_note_reads').select('note_id').eq('user_id', session.user.id).in('note_id', notesData.map(n => n.id));
      const readIds = readsData ? readsData.map(r => r.note_id) :[];
      
      const unreadIds = notesData.filter(n => !readIds.includes(n.id)).map(n => n.id);
      
      if (unreadIds.length > 0) {
        const inserts = unreadIds.map(id => ({ note_id: id, user_id: session.user.id }));
        await supabase.from('aft_note_reads').upsert(inserts, { onConflict: 'note_id,user_id' });
        onNotesRead(); // Tell the main app shell to turn off the red badge!
      }
    } else {
      setNotes([]);
    }
  };

  const openForm = (note: any = null) => {
    if (note) {
      setEditingId(note.id);
      setContent(note.content || "");
      setExistingImages(note.pictures ||[]);
    } else {
      setEditingId(null);
      setContent("");
      setExistingImages([]);
    }
    setSelectedImages([]);
    setShowModal(true);
  };

  const uploadImages = async (): Promise<string[]> => {
    let uploadedPaths: string[] =[];
    const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
    for (const file of selectedImages) {
      try {
        const compressedFile = await imageCompression(file, options);
        const fileName = `${aircraft.tail_number}_${Date.now()}_${compressedFile.name}`;
        const { data } = await supabase.storage.from('aft_note_images').upload(fileName, compressedFile);
        if (data) {
          const { data: urlData } = supabase.storage.from('aft_note_images').getPublicUrl(data.path);
          uploadedPaths.push(urlData.publicUrl);
        }
      } catch (error) { console.error(error); }
    }
    return uploadedPaths;
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const uploadedUrls = await uploadImages();
    const allPictures =[...existingImages, ...uploadedUrls];

    const noteData: any = {
      aircraft_id: aircraft.id,
      content,
      pictures: allPictures
    };

    if (editingId) {
      noteData.edited_at = new Date().toISOString();
      await supabase.from('aft_notes').update(noteData).eq('id', editingId);
    } else {
      noteData.author_id = session.user.id;
      noteData.author_email = session.user.email;
      await supabase.from('aft_notes').insert(noteData);
    }

    await fetchNotes();
    setShowModal(false);
    setIsSubmitting(false);
  };

  if (!aircraft) return null;

  return (
    <>
      <div className="mb-2">
        <PrimaryButton onClick={() => openForm()}><Plus size={18} /> Add New Note</PrimaryButton>
      </div>

      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#1B4869] mb-6">
        <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 mb-6 leading-none">Flight Notes</h2>
        
        <div className="space-y-4">
          {notes.length === 0 ? (<p className="text-center text-sm text-gray-400 italic py-4">No notes for this aircraft.</p>) : (
            notes.map(note => (
              <div key={note.id} className="p-4 border border-blue-200 bg-white rounded shadow-sm">
                
                <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#1B4869] block">{note.author_email || 'Pilot'}</span>
                    <span className="text-[10px] uppercase text-gray-400 font-bold">
                      {new Date(note.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      {note.edited_at && <span className="text-brandOrange ml-2">(Edited: {new Date(note.edited_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})</span>}
                    </span>
                  </div>
                  {/* Only allow editing if the current user wrote the note */}
                  {note.author_id === session.user.id && (
                    <button onClick={() => openForm(note)} className="text-gray-400 hover:text-brandOrange active:scale-95"><Edit2 size={14}/></button>
                  )}
                </div>

                <p className="text-sm text-navy font-roboto whitespace-pre-wrap leading-relaxed">{note.content}</p>

                {note.pictures && note.pictures.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pt-2">
                    {note.pictures.map((pic: string, i: number) => (
                      <button key={i} onClick={() => { setPreviewImages(note.pictures); setPreviewIndex(i); }} className="active:scale-95 transition-transform shrink-0">
                        <img src={pic} loading="lazy" alt="Note Attachment" className="h-20 w-20 object-cover rounded border border-gray-300 shadow-sm" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
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

      {/* ADD/EDIT NOTE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded shadow-2xl w-full max-w-md p-6 border-t-4 border-[#1B4869] animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2"><FileText size={20} className="text-blue-500"/> {editingId ? 'Edit Note' : 'Add Note'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500"><X size={24}/></button>
            </div>
            
            <form onSubmit={submitNote} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Message *</label>
                <textarea required value={content} onChange={e=>setContent(e.target.value)} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-blue-400 min-h-[120px]" placeholder="Share info with the next pilot..." />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2 mb-2"><Upload size={14}/> Attach Photos (Optional)</label>
                <input type="file" multiple accept="image/*" onChange={(e)=>{if (e.target.files) setSelectedImages(Array.from(e.target.files));}} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100 file:text-navy cursor-pointer" />
              </div>
              <div className="pt-4"><PrimaryButton disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Post Note"}</PrimaryButton></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}