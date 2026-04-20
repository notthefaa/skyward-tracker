"use client";

import { Calendar, CalendarCheck, CalendarSearch } from "lucide-react";
import { INPUT_WHITE_BG } from "./shared";

interface DateProposalSectionProps {
  wantsToPropose: boolean | null;
  setWantsToPropose: (v: boolean) => void;
  proposedDate: string;
  setProposedDate: (v: string) => void;
}

export default function DateProposalSection({ wantsToPropose, setWantsToPropose, proposedDate, setProposedDate }: DateProposalSectionProps) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Calendar size={14} className="text-mxOrange" /> Service Date</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setWantsToPropose(true)}
          className={`flex-1 py-4 px-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all active:scale-95 flex flex-col items-center gap-2 ${
            wantsToPropose === true 
              ? 'bg-mxOrange text-white shadow-lg' 
              : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-mxOrange hover:text-mxOrange shadow-sm'
          }`}
        >
          <CalendarCheck size={20} />
          Propose a Date
        </button>
        <button
          type="button"
          onClick={() => { setWantsToPropose(false); setProposedDate(""); }}
          className={`flex-1 py-4 px-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all active:scale-95 flex flex-col items-center gap-2 ${
            wantsToPropose === false 
              ? 'bg-[#3AB0FF] text-white shadow-lg' 
              : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-[#3AB0FF] hover:text-[#3AB0FF] shadow-sm'
          }`}
        >
          <CalendarSearch size={20} />
          Request Availability
        </button>
      </div>
      {wantsToPropose === true && (
        <div className="animate-fade-in bg-orange-50 border border-orange-200 rounded-lg p-4">
          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date *</label>
          <input
            type="date"
            value={proposedDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => setProposedDate(e.target.value)}
            style={INPUT_WHITE_BG}
            className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-mxOrange outline-none"
          />
        </div>
      )}
      {wantsToPropose === false && (
        <div className="animate-fade-in bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-[#3AB0FF] font-bold text-center">Your mechanic will propose dates that fit their shop.</p>
        </div>
      )}
    </div>
  );
}
