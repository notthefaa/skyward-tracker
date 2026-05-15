"use client";

import { ChevronDown, Warehouse, Send, ShieldCheck, Settings, LogOut } from "lucide-react";
import type { AircraftWithMetrics, AircraftStatus, AppTab } from "@/lib/types";
import { formatAircraftType } from "@/lib/aircraftDisplay";

// Fixed top header. Holds the tail-number-with-status-dot button, the
// aircraft-switch dropdown, and the right-side button bar (Hangar,
// Log It, Admin, Settings, Logout). Dropdown state lives in AppShell
// because pull-to-refresh needs to know when it's open.
export default function AppHeader({
  activeTail,
  activeTab,
  aircraftStatus,
  dropdownOptions,
  showFleetButton,
  role,
  showTailDropdown,
  setShowTailDropdown,
  onNavigateTab,
  onTailChange,
  onOpenLogIt,
  onOpenAdmin,
  onOpenSettings,
  onLogout,
}: {
  activeTail: string;
  activeTab: AppTab;
  aircraftStatus: AircraftStatus;
  dropdownOptions: AircraftWithMetrics[];
  showFleetButton: boolean;
  role: string | null;
  showTailDropdown: boolean;
  setShowTailDropdown: (v: boolean) => void;
  onNavigateTab: (tab: AppTab) => void;
  onTailChange: (tailOrSentinel: string) => void;
  onOpenLogIt: () => void;
  onOpenAdmin: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const handleDropdownPick = (value: string) => {
    setShowTailDropdown(false);
    onTailChange(value);
  };

  return (
    <header
      role="banner"
      className="fixed top-0 left-0 right-0 bg-navy text-white shadow-md z-[9999]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="max-w-3xl mx-auto px-4 py-2 flex justify-between items-center w-full min-h-[52px]">
        <div className="flex flex-col">
          <span className="text-[9px] font-bold uppercase tracking-widest text-[#F5B05B] mb-[2px]">Active Aircraft</span>
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full shrink-0 shadow-inner ${aircraftStatus === 'grounded' ? 'bg-red-500' : aircraftStatus === 'issues' ? 'bg-mxOrange' : aircraftStatus === 'airworthy' ? 'bg-success' : 'bg-gray-400'}`}
              role="status"
              aria-label={`Aircraft status: ${aircraftStatus}`}
            />
            <div className="relative flex items-center">
              <button
                onClick={() => onNavigateTab('summary')}
                aria-label={`View ${activeTail || 'aircraft'} summary`}
                className="text-xl font-oswald font-bold uppercase tracking-wide text-white hover:text-info transition-colors active:scale-95"
              >
                {activeTail || '—'}
              </button>
              {dropdownOptions.length > 0 && (
                <button
                  onClick={() => setShowTailDropdown(!showTailDropdown)}
                  aria-label="Switch aircraft"
                  aria-expanded={showTailDropdown}
                  className="text-white/70 hover:text-white transition-colors active:scale-95 ml-1 p-1"
                >
                  <ChevronDown size={16} className={`transition-transform ${showTailDropdown ? 'rotate-180' : ''}`} />
                </button>
              )}
              {showTailDropdown && (
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setShowTailDropdown(false)} />
                  <div
                    role="listbox"
                    aria-label="Aircraft selection"
                    className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-2xl border border-gray-200 min-w-full w-max z-[9999] overflow-hidden animate-slide-up"
                  >
                    {dropdownOptions.map(a => (
                      <button
                        key={a.id}
                        role="option"
                        aria-selected={a.tail_number === activeTail}
                        onClick={() => handleDropdownPick(a.tail_number)}
                        className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 active:bg-gray-100 transition-colors ${a.tail_number === activeTail ? 'bg-blue-50' : ''}`}
                      >
                        <div>
                          <span className={`font-oswald font-bold uppercase text-sm ${a.tail_number === activeTail ? 'text-info' : 'text-navy'}`}>{a.tail_number}</span>
                          <span className="block text-[10px] text-gray-400 uppercase tracking-widest">{formatAircraftType(a)}</span>
                        </div>
                        {a.tail_number === activeTail && <div className="w-2 h-2 rounded-full bg-info shrink-0" />}
                      </button>
                    ))}
                    <button
                      onClick={() => handleDropdownPick('__add_new__')}
                      className="w-full text-left px-4 py-3 text-info font-oswald font-bold uppercase text-sm hover:bg-blue-50 active:bg-blue-100 transition-colors border-t border-gray-100"
                    >
                      + Add Aircraft
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-4">
          {showFleetButton && (
            <button
              onClick={() => onNavigateTab('fleet')}
              aria-label="Hangar overview"
              className={`hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0 ${activeTab === 'fleet' ? 'text-info' : 'text-gray-300'}`}
            >
              <Warehouse size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Hangar</span>
            </button>
          )}
          <button
            onClick={onOpenLogIt}
            aria-label="Install Log It companion app"
            className="text-[#F5B05B] hover:text-[#F5B05B]/80 transition-colors flex flex-col items-center active:scale-95 shrink-0"
          >
            <Send size={18} />
            <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Log It</span>
          </button>
          {role === 'admin' && (
            <button
              onClick={onOpenAdmin}
              aria-label="Admin tools"
              className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"
            >
              <ShieldCheck size={18} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Admin</span>
            </button>
          )}
          <button
            onClick={onOpenSettings}
            aria-label="Settings"
            className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"
          >
            <Settings size={18} />
            <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Settings</span>
          </button>
          <button
            onClick={onLogout}
            aria-label="Log out"
            className="text-gray-300 hover:text-white transition-colors flex flex-col items-center active:scale-95 shrink-0"
          >
            <LogOut size={18} />
            <span className="text-[8px] font-bold uppercase tracking-widest mt-1">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
