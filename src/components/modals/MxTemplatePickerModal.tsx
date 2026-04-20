"use client";

import { useState, useEffect, useMemo } from "react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/components/ToastProvider";
import { MX_TEMPLATES, CATEGORY_META } from "@/lib/mxTemplates";
import type { MxTemplate, MxTemplateItem } from "@/lib/mxTemplates";
import { 
  X, ChevronRight, ChevronDown, CheckSquare, Wrench, Clock, Calendar, 
  AlertTriangle, Loader2, Plane, Shield, Layers, ArrowLeft, Info
} from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";

interface MxTemplatePickerModalProps {
  aircraft: any;
  show: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

type Step = 'pick' | 'select' | 'inserting';

/** Format interval for display */
function formatInterval(item: MxTemplateItem): string {
  if (item.tracking_type === 'time') {
    return `Every ${item.interval.toLocaleString()} hrs`;
  }
  const days = item.interval;
  if (days >= 3650) return `Every ${Math.round(days / 365)} years`;
  if (days >= 365) {
    const yrs = Math.round(days / 365);
    return `Every ${yrs} year${yrs > 1 ? 's' : ''}`;
  }
  if (days >= 28 && days < 365) {
    const months = Math.round(days / 30);
    return `Every ${months} month${months > 1 ? 's' : ''}`;
  }
  return `Every ${days} days`;
}

/** Icon for category */
function getCategoryIcon(category: string) {
  const map: Record<string, React.ReactNode> = {
    inspection: <Shield size={14} className="text-mxOrange" />,
    engine: <Wrench size={14} className="text-navy" />,
    propeller: <Wrench size={14} className="text-[#3AB0FF]" />,
    airframe: <Plane size={14} className="text-gray-600" />,
    avionics: <Layers size={14} className="text-[#3AB0FF]" />,
    safety: <AlertTriangle size={14} className="text-[#CE3732]" />,
    fluid: <Clock size={14} className="text-[#56B94A]" />,
  };
  return map[category] || <Wrench size={14} />;
}

export default function MxTemplatePickerModal({ aircraft, show, onClose, onRefresh }: MxTemplatePickerModalProps) {
  useModalScrollLock(show);
  const { showError, showWarning } = useToast();
  const [step, setStep] = useState<Step>('pick');
  const [selectedTemplate, setSelectedTemplate] = useState<MxTemplate | null>(null);
  const [selectedItemIndices, setSelectedItemIndices] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [isInserting, setIsInserting] = useState(false);
  const [insertedCount, setInsertedCount] = useState(0);

  // Duplicate detection
  const [existingItemNames, setExistingItemNames] = useState<Set<string>>(new Set());
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [duplicateNames, setDuplicateNames] = useState<string[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<'pending' | 'skip' | 'add'>('pending');

  // Lock body scroll when modal is open
  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [show]);

  // Fetch existing item names when modal opens
  useEffect(() => {
    if (show && aircraft) {
      fetchExistingItems();
      // Reset state
      setStep('pick');
      setSelectedTemplate(null);
      setSelectedItemIndices(new Set());
      setCollapsedCategories(new Set());
      setInsertedCount(0);
      setShowDuplicateWarning(false);
      setDuplicateAction('pending');
    }
  }, [show, aircraft]);

  const fetchExistingItems = async () => {
    const { data } = await supabase
      .from('aft_maintenance_items')
      .select('item_name')
      .eq('aircraft_id', aircraft.id);
    if (data) {
      setExistingItemNames(new Set(data.map((d: any) => d.item_name.toLowerCase().trim())));
    }
  };

  // Group template items by category with sort order
  const groupedItems = useMemo(() => {
    if (!selectedTemplate) return [];
    const groups: Record<string, { label: string; order: number; items: { item: MxTemplateItem; index: number }[] }> = {};
    
    selectedTemplate.items.forEach((item, index) => {
      const cat = item.category;
      if (!groups[cat]) {
        const meta = CATEGORY_META[cat] || { label: cat, order: 99 };
        groups[cat] = { label: meta.label, order: meta.order, items: [] };
      }
      groups[cat].items.push({ item, index });
    });

    return Object.entries(groups)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, group]) => ({ key, ...group }));
  }, [selectedTemplate]);

  const handleSelectTemplate = (template: MxTemplate) => {
    setSelectedTemplate(template);
    // Pre-check required items
    const preSelected = new Set<number>();
    template.items.forEach((item, idx) => {
      if (item.is_required) preSelected.add(idx);
    });
    setSelectedItemIndices(preSelected);
    setCollapsedCategories(new Set());
    setDuplicateAction('pending');
    setShowDuplicateWarning(false);
    setStep('select');
  };

  const toggleItem = (index: number) => {
    setSelectedItemIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleCategory = (categoryKey: string) => {
    if (!selectedTemplate) return;
    const categoryIndices = selectedTemplate.items
      .map((item, idx) => item.category === categoryKey ? idx : -1)
      .filter(idx => idx >= 0);
    
    const allSelected = categoryIndices.every(idx => selectedItemIndices.has(idx));
    
    setSelectedItemIndices(prev => {
      const next = new Set(prev);
      if (allSelected) {
        categoryIndices.forEach(idx => next.delete(idx));
      } else {
        categoryIndices.forEach(idx => next.add(idx));
      }
      return next;
    });
  };

  const toggleCategoryCollapse = (categoryKey: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryKey)) next.delete(categoryKey);
      else next.add(categoryKey);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!selectedTemplate || selectedItemIndices.size === 0) return;

    // Check for duplicates
    const selectedItems = Array.from(selectedItemIndices).map(idx => selectedTemplate.items[idx]);
    const dupes = selectedItems.filter(item => 
      existingItemNames.has(item.item_name.toLowerCase().trim())
    );

    if (dupes.length > 0 && duplicateAction === 'pending') {
      setDuplicateNames(dupes.map(d => d.item_name));
      setShowDuplicateWarning(true);
      return;
    }

    performInsert();
  };

  const handleDuplicateDecision = (action: 'skip' | 'add') => {
    setDuplicateAction(action);
    setShowDuplicateWarning(false);
    performInsert(action);
  };

  const performInsert = async (dupeAction?: 'skip' | 'add') => {
    if (!selectedTemplate) return;
    const action = dupeAction || duplicateAction;
    
    setIsInserting(true);
    setStep('inserting');

    let itemsToInsert = Array.from(selectedItemIndices).map(idx => selectedTemplate.items[idx]);

    // Filter out duplicates if user chose to skip
    if (action === 'skip') {
      itemsToInsert = itemsToInsert.filter(item => 
        !existingItemNames.has(item.item_name.toLowerCase().trim())
      );
    }

    if (itemsToInsert.length === 0) {
      showWarning("All selected items already exist on this aircraft.");
      setIsInserting(false);
      setStep('select');
      return;
    }

    // Build the insert payload
    const rows = itemsToInsert.map(item => ({
      item_name: item.item_name,
      tracking_type: item.tracking_type,
      is_required: item.is_required,
      time_interval: item.tracking_type === 'time' ? item.interval : null,
      date_interval_days: item.tracking_type === 'date' ? item.interval : null,
      // All due/last-completed fields null — requires user setup
      due_time: null,
      due_date: null,
      last_completed_time: null,
      last_completed_date: null,
      automate_scheduling: false,
      mx_schedule_sent: false,
      primary_heads_up_sent: false,
      reminder_5_sent: false,
      reminder_15_sent: false,
      reminder_30_sent: false,
    }));

    // Batch insert via authenticated API (bypasses RLS)
    const res = await authFetch('/api/maintenance-items', {
      method: 'POST',
      body: JSON.stringify({ aircraftId: aircraft.id, items: rows }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Template insert error:', errData);
      showError("Couldn't add the maintenance items: " + (errData.error || 'Unknown error'));
      setIsInserting(false);
      setStep('select');
      return;
    }

    setInsertedCount(rows.length);
    setIsInserting(false);

    // Brief success display then close
    setTimeout(() => {
      onRefresh();
      onClose();
    }, 1500);
  };

  if (!show) return null;

  const selectedCount = selectedItemIndices.size;
  const totalItems = selectedTemplate?.items.length || 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[10000] overflow-y-auto animate-fade-in"
      style={{ overscrollBehavior: 'contain' }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
      <div
        className="bg-white rounded shadow-2xl w-full max-w-lg p-5 border-t-4 border-mxOrange animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── HEADER ─── */}
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Layers size={20} className="text-mxOrange" />
            {step === 'pick' ? 'MX Templates' : step === 'select' ? 'Select Items' : 'Adding Items...'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-[#CE3732] p-2 -mr-2"><X size={24} /></button>
        </div>

        {/* ═══════════════ STEP 1: PICK TEMPLATE ═══════════════ */}
        {step === 'pick' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-4">Choose a template that matches your aircraft type. You can customize which items to add in the next step.</p>
            
            <div className="bg-orange-50 border border-orange-200 rounded p-3 mb-4 flex items-start gap-2">
              <Info size={14} className="text-mxOrange shrink-0 mt-0.5" />
              <p className="text-[10px] text-gray-600 leading-tight">Templates add items with <strong>Setup Required</strong> status. You'll need to enter last-completed dates/times from your logbook to activate tracking.</p>
            </div>

            {MX_TEMPLATES.map(template => {
              const requiredCount = template.items.filter(i => i.is_required).length;
              return (
                <button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className="w-full bg-gray-50 border border-gray-200 p-4 rounded text-left hover:border-mxOrange hover:bg-orange-50/30 transition-colors active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-oswald font-bold text-navy text-sm uppercase leading-tight">{template.name}</h3>
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">{template.description}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-navy text-white">{template.engine_type}</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{template.items.length} items</span>
                        <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-red-100 text-[#CE3732]">{requiredCount} required</span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-gray-400 shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ═══════════════ STEP 2: SELECT ITEMS ═══════════════ */}
        {step === 'select' && selectedTemplate && (
          <div className="space-y-4">
            {/* Back + template name */}
            <div className="flex items-center gap-3 mb-2">
              <button 
                onClick={() => { setStep('pick'); setSelectedTemplate(null); }}
                className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mxOrange bg-orange-50 border border-orange-200 rounded px-3 py-1.5 hover:bg-orange-100 active:scale-95 transition-all"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <span className="font-oswald font-bold text-navy text-sm uppercase">{selectedTemplate.name}</span>
            </div>

            {/* Selection count */}
            <div className="flex justify-between items-center bg-gray-50 rounded p-3 border border-gray-200">
              <span className="text-xs text-gray-600 font-bold">
                {selectedCount} of {totalItems} items selected
              </span>
              <button
                onClick={() => {
                  if (selectedCount === totalItems) setSelectedItemIndices(new Set());
                  else {
                    const all = new Set<number>();
                    selectedTemplate.items.forEach((_, idx) => all.add(idx));
                    setSelectedItemIndices(all);
                  }
                }}
                className="text-[10px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 active:scale-95 flex items-center gap-1"
              >
                <CheckSquare size={12} /> {selectedCount === totalItems ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Duplicate warning */}
            {showDuplicateWarning && (
              <div className="bg-orange-50 border-2 border-orange-200 rounded p-4 animate-fade-in">
                <p className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-mxOrange" /> Duplicate Items Found
                </p>
                <p className="text-xs text-gray-600 mb-3">
                  {duplicateNames.length} item{duplicateNames.length > 1 ? 's' : ''} already exist{duplicateNames.length === 1 ? 's' : ''} on this aircraft:
                </p>
                <div className="max-h-[100px] overflow-y-auto mb-3">
                  {duplicateNames.map((name, i) => (
                    <p key={i} className="text-xs text-navy font-bold ml-2">• {name}</p>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleDuplicateDecision('skip')}
                    className="flex-1 bg-[#3AB0FF] text-white font-oswald font-bold uppercase tracking-widest py-2.5 rounded text-xs active:scale-95"
                  >
                    Skip Duplicates
                  </button>
                  <button 
                    onClick={() => handleDuplicateDecision('add')}
                    className="flex-1 bg-mxOrange text-white font-oswald font-bold uppercase tracking-widest py-2.5 rounded text-xs active:scale-95"
                  >
                    Add Anyway
                  </button>
                </div>
                <button 
                  onClick={() => setShowDuplicateWarning(false)}
                  className="w-full text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-2 py-1 hover:text-navy active:scale-95"
                >
                  Go Back &amp; Edit Selection
                </button>
              </div>
            )}

            {/* Categories with items */}
            {!showDuplicateWarning && (
              <div className="space-y-2">
                {groupedItems.map(group => {
                  const categoryIndices = group.items.map(i => i.index);
                  const selectedInCategory = categoryIndices.filter(idx => selectedItemIndices.has(idx)).length;
                  const allSelected = selectedInCategory === categoryIndices.length;
                  const isCollapsed = collapsedCategories.has(group.key);

                  return (
                    <div key={group.key} className="border border-gray-200 rounded overflow-hidden">
                      {/* Category header */}
                      <div className="flex items-center bg-gray-50 p-3">
                        <button 
                          onClick={() => toggleCategoryCollapse(group.key)}
                          className="flex items-center gap-2 flex-1 text-left active:scale-[0.98]"
                        >
                          {getCategoryIcon(group.key)}
                          <span className="font-oswald font-bold uppercase tracking-widest text-xs text-navy">{group.label}</span>
                          <span className="text-[9px] font-bold text-gray-400 ml-1">({selectedInCategory}/{categoryIndices.length})</span>
                          {isCollapsed 
                            ? <ChevronRight size={14} className="text-gray-400 ml-auto" />
                            : <ChevronDown size={14} className="text-gray-400 ml-auto" />
                          }
                        </button>
                        <button 
                          onClick={() => toggleCategory(group.key)}
                          className="text-[9px] font-bold uppercase tracking-widest text-mxOrange hover:opacity-80 active:scale-95 ml-2 shrink-0"
                        >
                          {allSelected ? 'None' : 'All'}
                        </button>
                      </div>

                      {/* Items */}
                      {!isCollapsed && (
                        <div className="divide-y divide-gray-100">
                          {group.items.map(({ item, index }) => {
                            const isSelected = selectedItemIndices.has(index);
                            const isDuplicate = existingItemNames.has(item.item_name.toLowerCase().trim());
                            return (
                              <label 
                                key={index} 
                                className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${isSelected ? 'bg-orange-50/40' : 'bg-white hover:bg-gray-50'}`}
                              >
                                <input 
                                  type="checkbox" 
                                  checked={isSelected} 
                                  onChange={() => toggleItem(index)}
                                  className="mt-0.5 w-4 h-4 text-mxOrange border-gray-300 rounded cursor-pointer shrink-0" 
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-navy">{item.item_name}</span>
                                    {item.is_required && (
                                      <span className="text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-red-100 text-[#CE3732]">Required</span>
                                    )}
                                    {isDuplicate && (
                                      <span className="text-[7px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-orange-100 text-mxOrange">Exists</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                      {item.tracking_type === 'time' ? <Clock size={10} /> : <Calendar size={10} />}
                                      {formatInterval(item)}
                                    </span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Confirm button */}
            {!showDuplicateWarning && (
              <div className="pt-2">
                <PrimaryButton onClick={handleConfirm} disabled={selectedCount === 0}>
                  Add {selectedCount} Item{selectedCount !== 1 ? 's' : ''} to {aircraft.tail_number}
                </PrimaryButton>
                <p className="text-[10px] text-gray-400 text-center mt-2">Items will need setup from your logbook before tracking begins.</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ STEP 3: INSERTING ═══════════════ */}
        {step === 'inserting' && (
          <div className="py-12 text-center">
            {isInserting ? (
              <>
                <Loader2 size={48} className="mx-auto text-mxOrange animate-spin mb-4" />
                <p className="font-oswald text-lg font-bold uppercase tracking-widest text-navy">Adding Items...</p>
                <p className="text-xs text-gray-500 mt-2">Setting up maintenance tracking for {aircraft.tail_number}</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-[#56B94A] rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <p className="font-oswald text-xl font-bold uppercase tracking-widest text-navy">{insertedCount} Items Added</p>
                <p className="text-xs text-gray-500 mt-2">Open each item to enter last-completed data from your logbook.</p>
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
