"use client";

import { Calendar } from "lucide-react";
import { INPUT_WHITE_BG } from "./shared";

interface DateProposalSectionProps {
  wantsToPropose: boolean | null;
  setWantsToPropose: (v: boolean) => void;
  proposedDate: string;
  setProposedDate: (v: string) => void;
}

export default function DateProposalSection({ wantsToPropose, setWantsToPropose, proposedDate, setProposedDate }: DateProposalSectionProps) {
  return (
    <div className="border border-gray-200 rounded p-4 bg-gray-50 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-navy flex items-center gap-2"><Calendar size={14} className="text-[#F08B46]" /> Service Date</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setWantsToPropose(true)}
          className={`flex-1 py-3 px-3 rounded border-2 text-xs font-bold uppercase tracking-widest transition-all active:scale-95 ${wantsToPropose === true ? 'border-[#F08B46] bg-orange-50 text-[#F08B46]' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}
        >
          Propose a Date
        </button>
        <button
          type="button"
          onClick={() => { setWantsToPropose(false); setProposedDate(""); }}
          className={`flex-1 py-3 px-3 rounded border-2 text-xs font-bold uppercase tracking-widest transition-all active:scale-95 ${wantsToPropose === false ? 'border-[#3AB0FF] bg-blue-50 text-[#3AB0FF]' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}
        >
          Request Availability
        </button>
      </div>
      {wantsToPropose === true && (
        <div className="animate-fade-in">
          <label className="text-[10px] font-bold uppercase tracking-widest text-navy">Preferred Service Date *</label>
          <input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} style={INPUT_WHITE_BG} className="w-full border border-gray-300 rounded p-3 text-sm mt-1 focus:border-[#F08B46] outline-none" />
        </div>
      )}
      {wantsToPropose === false && (
        <p className="text-xs text-gray-500 italic animate-fade-in">The mechanic will be asked to propose dates that work for their schedule.</p>
      )}
    </div>
  );
}
