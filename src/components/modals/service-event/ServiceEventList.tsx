"use client";

import { ChevronRight, Calendar, AlertTriangle } from "lucide-react";
import { PrimaryButton } from "@/components/AppButtons";
import type { ServiceEventChildProps } from "./shared";

interface ServiceEventListProps extends ServiceEventChildProps {
  events: any[];
  onOpenCreateFlow: () => void;
  onOpenDraftReview: (ev: any) => void;
  onOpenDetail: (ev: any) => void;
}

export default function ServiceEventList({
  events, canManageService,
  onOpenCreateFlow, onOpenDraftReview, onOpenDetail,
}: ServiceEventListProps) {
  const activeEvents = events.filter(e => e.status !== 'complete' && e.status !== 'cancelled');
  const completedEvents = events.filter(e => e.status === 'complete');
  const cancelledEvents = events.filter(e => e.status === 'cancelled');

  return (
    <div className="space-y-4">
      {canManageService && (
        <PrimaryButton onClick={onOpenCreateFlow}>
          <Calendar size={18} /> Schedule New Service
        </PrimaryButton>
      )}

      {/* Draft banners */}
      {canManageService && activeEvents.filter(e => e.status === 'draft').length > 0 && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mxOrange mb-3 flex items-center gap-1">
            <AlertTriangle size={12} /> Drafts Awaiting Your Review
          </p>
          {activeEvents.filter(e => e.status === 'draft').map(ev => (
            <button key={ev.id} onClick={() => onOpenDraftReview(ev)} className="w-full bg-white border-2 border-mxOrange p-4 rounded mb-2 text-left flex justify-between items-center hover:bg-orange-50 transition-colors active:scale-[0.98]">
              <div>
                <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-mxOrange">draft — review &amp; send</span>
                <p className="text-[10px] text-gray-500 mt-1">Auto-created {new Date(ev.created_at).toLocaleDateString()}</p>
              </div>
              <ChevronRight size={18} className="text-mxOrange" />
            </button>
          ))}
        </div>
      )}

      {/* Active events (non-draft) */}
      {activeEvents.filter(e => e.status !== 'draft').length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Active</p>
          {activeEvents.filter(e => e.status !== 'draft').map(ev => (
            <button key={ev.id} onClick={() => onOpenDetail(ev)} className="w-full bg-gray-50 border border-gray-200 p-4 rounded mb-2 text-left flex justify-between items-center hover:border-mxOrange transition-colors active:scale-[0.98]">
              <div>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white ${ev.status === 'confirmed' ? 'bg-info' : ev.status === 'in_progress' ? 'bg-[#56B94A]' : ev.status === 'ready_for_pickup' ? 'bg-[#56B94A]' : 'bg-gray-500'}`}>
                  {ev.status === 'ready_for_pickup' ? 'Ready' : ev.status}
                </span>
                <p className="font-bold text-navy text-sm mt-1">{ev.confirmed_date || ev.proposed_date || 'Pending'}</p>
                <p className="text-[10px] text-gray-500">Created {new Date(ev.created_at).toLocaleDateString()}</p>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          ))}
        </div>
      )}

      {/* Completed */}
      {completedEvents.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Completed</p>
          {completedEvents.slice(0, 5).map(ev => (
            <button key={ev.id} onClick={() => onOpenDetail(ev)} className="w-full bg-green-50 border border-green-200 p-3 rounded mb-2 text-left flex justify-between items-center opacity-70 hover:opacity-100 transition-opacity active:scale-[0.98]">
              <div>
                <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-[#56B94A]">complete</span>
                <p className="text-[10px] text-gray-500 mt-1">Completed {ev.completed_at ? new Date(ev.completed_at).toLocaleDateString() : ''}</p>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          ))}
        </div>
      )}

      {/* Cancelled */}
      {cancelledEvents.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Cancelled</p>
          {cancelledEvents.slice(0, 3).map(ev => (
            <button key={ev.id} onClick={() => onOpenDetail(ev)} className="w-full bg-red-50 border border-red-200 p-3 rounded mb-2 text-left flex justify-between items-center opacity-50 hover:opacity-80 transition-opacity active:scale-[0.98]">
              <div>
                <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded text-white bg-danger">cancelled</span>
                <p className="text-[10px] text-gray-500 mt-1">Created {new Date(ev.created_at).toLocaleDateString()}</p>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          ))}
        </div>
      )}

      {events.length === 0 && (
        <p className="text-center text-sm text-gray-400 italic py-4">No service events yet.</p>
      )}
    </div>
  );
}
