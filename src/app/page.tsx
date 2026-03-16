"use client";

import { useState } from "react";
import { Eye, Edit2, Plus, PlaneTakeoff, Wrench, AlertTriangle, ChevronDown } from "lucide-react";
import TicketField from "@/components/TicketField";
import { PrimaryButton, AddButton } from "@/components/AppButtons";

export default function FleetTrackerApp() {
  const[activeView, setActiveView] = useState<'form' | 'dashboard'>('dashboard');
  const [activeTail, setActiveTail] = useState("N12345");

  // --- EDITOR PANE (LEFT SIDE) ---
  const FormPane = (
    <div className="h-full p-6 bg-white overflow-y-auto border-r border-gray-200">
      <div className="mb-8">
        <h1 className="font-oswald text-2xl font-bold uppercase tracking-wide text-navy flex items-center gap-2">
          <PlaneTakeoff className="text-brandOrange" /> Fleet Tracker
        </h1>
        <p className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mt-2">Select Aircraft</p>
        <select 
          className="mt-1 w-full border border-gray-300 rounded p-2 text-sm focus:border-blue-400 focus:outline-none bg-white font-roboto text-navy"
          value={activeTail}
          onChange={(e) => setActiveTail(e.target.value)}
        >
          <option value="N12345">N12345 (Cessna 172)</option>
          <option value="N9876A">N9876A (Piper Cherokee)</option>
        </select>
      </div>

      <div className="space-y-6">
        {/* Update Times Form */}
        <div className="bg-gray-50 p-4 rounded border border-gray-200">
          <h3 className="font-oswald font-bold uppercase text-sm mb-3 text-navy">Update Times</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-brandOrange">New Airframe</label>
              <input type="number" className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-blue-400 focus:outline-none" placeholder="Hours" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-brandOrange">New Engine</label>
              <input type="number" className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:border-blue-400 focus:outline-none" placeholder="Hours" />
            </div>
          </div>
          <PrimaryButton>Save Times</PrimaryButton>
        </div>

        {/* Add Squawk Form */}
        <div>
          <h3 className="font-oswald font-bold uppercase text-sm mb-2 text-navy">Report Squawk</h3>
          <textarea 
            className="w-full border border-gray-300 rounded p-2 text-sm mb-2 focus:border-blue-400 focus:outline-none min-h-[80px]" 
            placeholder="Describe the issue..." 
          />
          <AddButton><Plus size={16}/> Submit Squawk</AddButton>
        </div>

        {/* Add Note Form */}
        <div>
          <h3 className="font-oswald font-bold uppercase text-sm mb-2 text-navy">Add Flight Note</h3>
          <textarea 
            className="w-full border border-gray-300 rounded p-2 text-sm mb-2 focus:border-blue-400 focus:outline-none min-h-[80px]" 
            placeholder="Share info with the next pilot..." 
          />
          <AddButton><Plus size={16}/> Add Note</AddButton>
        </div>
      </div>
    </div>
  );

  // --- DASHBOARD PANE (RIGHT SIDE) ---
  const DashboardPane = (
    <div className="h-full w-full flex justify-center items-start p-4 md:p-10 overflow-y-auto">
      
      {/* The physical "Paper Document" */}
      <div className="bg-cream w-full max-w-2xl shadow-2xl p-6 md:p-10 rounded-sm relative">
        
        {/* Document Header */}
        <div className="border-b-2 border-navy pb-4 mb-8 flex justify-between items-end">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mb-[2px] block">
              AIRCRAFT PROFILE
            </span>
            <h2 className="font-oswald text-5xl font-bold uppercase text-navy m-0 leading-none">
              {activeTail}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Status</span>
            <span className="bg-success text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest">
              Flight Ready
            </span>
          </div>
        </div>

        {/* Aircraft Times (Grid) */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 mb-8">
          <TicketField label="Aircraft Type" value="Cessna 172 Skyhawk" />
          <TicketField label="Total Airframe" value="4,250.5 hrs" emphasis />
          <TicketField label="Total Engine" value="1,120.2 hrs" emphasis />
        </div>

        {/* Accordion: Maintenance Items */}
        <div className="border border-gray-200 bg-white rounded overflow-hidden mb-6">
          <div className="bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center cursor-pointer">
            <h4 className="text-xs font-bold uppercase tracking-widest text-navy flex items-center gap-2">
              <Wrench size={14} className="text-brandOrange"/> Maintenance Due
            </h4>
            <ChevronDown size={16} className="text-gray-400" />
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <TicketField label="100 Hour Insp." value="Due @ 4,300.0" />
            <TicketField label="Annual Insp." value="Due Oct 15, 2026" />
            <TicketField label="ELT Battery" value="Due Jan 01, 2027" />
            <TicketField label="Oil Change" value="Due @ 4,280.5" />
          </div>
        </div>

        {/* Accordion: Active Squawks (Warning colors) */}
        <div className="border border-red-200 bg-[#fef2f2] rounded overflow-hidden">
          <div className="bg-red-50 p-3 border-b border-red-200 flex justify-between items-center">
            <h4 className="text-xs font-bold uppercase tracking-widest text-red-700 flex items-center gap-2">
              <AlertTriangle size={14} /> Active Squawks
            </h4>
          </div>
          <div className="p-4 space-y-3">
            <div className="bg-white border border-gray-200 p-3 rounded">
              <TicketField label="Oct 12 - Pilot Smith" value="Left main tire looking slightly bald on the inner edge." />
            </div>
            <div className="bg-white border border-gray-200 p-3 rounded">
              <TicketField label="Oct 10 - Pilot Jones" value="Comm 2 has static when transmitting on 122.8." />
            </div>
          </div>
        </div>

      </div>
    </div>
  );

  return (
    <div className="relative h-screen bg-neutral-100 flex flex-col md:flex-row overflow-hidden">
      
      {/* Desktop Split / Mobile View Switching */}
      <div className={`w-full md:w-[450px] h-full ${activeView === 'form' ? 'block' : 'hidden md:block'}`}>
        {FormPane}
      </div>
      
      <div className={`flex-1 bg-slateGray h-full ${activeView === 'dashboard' ? 'block' : 'hidden md:block'}`}>
        {DashboardPane}
      </div>

      {/* Floating Action Button (Mobile Only Context Switcher) */}
      <button 
        onClick={() => setActiveView(activeView === 'dashboard' ? 'form' : 'dashboard')}
        className="md:hidden fixed bottom-6 right-6 bg-brandOrange text-white px-6 py-4 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.4)] flex items-center gap-2 font-oswald tracking-widest z-50 text-xs uppercase transition-transform hover:scale-105"
      >
        {activeView === 'dashboard' ? <><Edit2 size={16}/> Input Data</> : <><Eye size={16}/> View Aircraft</>}
      </button>

    </div>
  );
}