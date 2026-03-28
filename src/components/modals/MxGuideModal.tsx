"use client";

import { useState } from "react";
import { 
  X, Wrench, Clock, Calendar, Send, CheckCircle, Bell, TrendingUp, 
  ExternalLink, MessageSquare, Sparkles, Plane, XCircle, ChevronRight, 
  ChevronDown, AlertTriangle, Plus, Edit2, RefreshCw
} from "lucide-react";

interface MxGuideModalProps {
  show: boolean;
  onClose: () => void;
}

type GuideSection = 'overview' | 'tracking' | 'automation' | 'workpackage' | 'portal' | 'completion';

const SECTIONS: { id: GuideSection; title: string; icon: React.ReactNode; color: string }[] = [
  { id: 'overview', title: 'How It Works', icon: <Wrench size={18} />, color: 'text-[#F08B46]' },
  { id: 'tracking', title: 'Item Tracking', icon: <Clock size={18} />, color: 'text-[#3AB0FF]' },
  { id: 'automation', title: 'Predictive Scheduling', icon: <TrendingUp size={18} />, color: 'text-[#F08B46]' },
  { id: 'workpackage', title: 'Work Packages', icon: <Send size={18} />, color: 'text-navy' },
  { id: 'portal', title: 'Mechanic Portal', icon: <ExternalLink size={18} />, color: 'text-[#091F3C]' },
  { id: 'completion', title: 'Completing Service', icon: <CheckCircle size={18} />, color: 'text-success' },
];

export default function MxGuideModal({ show, onClose }: MxGuideModalProps) {
  const [activeSection, setActiveSection] = useState<GuideSection | null>(null);

  if (!show) return null;

  const renderSectionContent = (section: GuideSection) => {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              The maintenance system tracks everything from individual inspection items to full service events with your mechanic. Here's the lifecycle:
            </p>

            {/* Status flow diagram */}
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Service Event Lifecycle</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Draft', desc: 'Work package created (manually or by system)', color: 'bg-[#F08B46]' },
                  { label: 'Scheduling', desc: 'Sent to mechanic — negotiating dates', color: 'bg-gray-500' },
                  { label: 'Confirmed', desc: 'Both sides agreed on a service date', color: 'bg-[#3AB0FF]' },
                  { label: 'In Progress', desc: 'Mechanic is working on the aircraft', color: 'bg-[#56B94A]' },
                  { label: 'Ready for Pickup', desc: 'All work done — mechanic signals ready', color: 'bg-[#56B94A]' },
                  { label: 'Complete', desc: 'Owner enters logbook data — tracking resets', color: 'bg-navy' },
                ].map((s, i) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className={`${s.color} text-white text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded w-28 text-center shrink-0`}>{s.label}</span>
                    <span className="text-xs text-gray-600 font-roboto">{s.desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3">
                <span className="bg-[#CE3732] text-white text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded w-28 text-center shrink-0">Cancelled</span>
                <span className="text-xs text-gray-600 font-roboto">Owner or mechanic cancels/declines at any point</span>
              </div>
            </div>

            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Every status change triggers an email notification to the other party with a direct link to the app or portal.
            </p>
          </div>
        );

      case 'tracking':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Each maintenance item is tracked by either engine hours or calendar dates. Both support automatic interval recalculation after completion.
            </p>

            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Clock size={14} /> Time-Based Tracking</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Set the engine time when last completed and the hour interval.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> The system calculates the due time automatically (last + interval).</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Remaining hours and projected days are shown based on your flight activity.</li>
              </ul>
            </div>

            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-2 flex items-center gap-2"><Calendar size={14} /> Date-Based Tracking</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> Set the last completed date and the day interval.</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> The system calculates the due date automatically (last + interval).</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> Remaining days are counted down to the due date.</li>
              </ul>
            </div>

            <div className="bg-red-50 rounded p-4 border border-red-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Required vs Optional</p>
              <p className="text-sm text-gray-600 font-roboto">
                Items marked <strong>Required</strong> will ground the aircraft when they expire. Items marked <strong>Optional</strong> will show as expired but won't affect airworthiness status.
              </p>
            </div>
          </div>
        );

      case 'automation':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              The predictive engine analyzes 180 days of flight data to forecast when maintenance will come due, even for hour-based items that depend on how often you fly.
            </p>

            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">How Predictions Work</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Burn Rate:</strong> Calculated from your actual flight activity — how many engine hours per day the aircraft accumulates when it's actively flying, adjusted by how often it flies.</span></li>
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Projection Range:</strong> When weekly flying patterns are consistent, you see a tight range (e.g., "~45 days"). When erratic, the range widens (e.g., "~30-60 days").</span></li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Confidence Score (0-100%)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                The system rates how much to trust its own prediction based on four factors:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">1.</span> <span><strong>History Depth:</strong> How far back flight data goes.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">2.</span> <span><strong>Data Density:</strong> How many flights relative to expected.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">3.</span> <span><strong>Consistency:</strong> How stable weekly flying patterns are.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">4.</span> <span><strong>Recency:</strong> How recently the aircraft has flown (decays aggressively if idle).</span></li>
              </ul>
            </div>

            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-2 flex items-center gap-2"><Bell size={14} /> Automated Actions</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>High confidence (≥80%):</strong> System auto-creates a draft work package and emails you to review and send.</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>Low confidence (&lt;80%):</strong> System sends a heads-up only — no draft created. You can schedule manually.</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>Hard limits:</strong> Date-based items always trigger at the configured day threshold regardless of confidence.</li>
              </ul>
            </div>
          </div>
        );

      case 'workpackage':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              A work package bundles everything your mechanic needs into a single, organized request. You can create one manually or review a system-generated draft.
            </p>

            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">What Goes in a Work Package</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-3"><Wrench size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Maintenance Items:</strong> Select any tracked items approaching their due thresholds.</span></li>
                <li className="flex items-start gap-3"><AlertTriangle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Open Squawks:</strong> Include any active squawks you want addressed during the visit.</span></li>
                <li className="flex items-start gap-3"><Sparkles size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Add-On Services:</strong> Request extras like aircraft wash, oil change, nav database update, tire check, and more.</span></li>
                <li className="flex items-start gap-3"><Calendar size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Preferred Date:</strong> Optionally propose a service date (or let the mechanic propose one).</span></li>
              </ul>
            </div>

            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2">Preview Before Sending</p>
              <p className="text-sm text-gray-600 font-roboto">
                Before sending, you can preview the exact email your mechanic will receive — including all line items, contact info, and the portal link. The mechanic's email is CC'd to you.
              </p>
            </div>

            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Draft Review</p>
              <p className="text-sm text-gray-600 font-roboto">
                When the system auto-creates a draft, you'll see a highlighted banner on the Maintenance tab. Open it to review, add more items or squawks, then send when ready.
              </p>
            </div>
          </div>
        );

      case 'portal':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Your mechanic accesses a secure portal through a link in their email. No account or login is required — the link contains a unique, unguessable access token.
            </p>

            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">What Your Mechanic Can Do</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-3"><Calendar size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Propose or Confirm Dates:</strong> Accept your proposed date or suggest an alternative with shop availability notes.</span></li>
                <li className="flex items-start gap-3"><Edit2 size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Update Line Items:</strong> Mark each item as Pending, In Progress, Complete, or Deferred. You're notified of every status change.</span></li>
                <li className="flex items-start gap-3"><Plus size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Suggest Additional Work:</strong> If they discover something during service, they can add it to the package. You get an email alert.</span></li>
                <li className="flex items-start gap-3"><Clock size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Set Estimated Completion:</strong> Provide an expected ready date and notes (parts on order, weather delays, etc.).</span></li>
                <li className="flex items-start gap-3"><Plane size={16} className="text-success shrink-0 mt-0.5" /> <span><strong>Mark Ready for Pickup:</strong> When all work is done, they signal that the aircraft is ready. You receive an email notification.</span></li>
                <li className="flex items-start gap-3"><MessageSquare size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Send Messages:</strong> Communicate directly through the portal. All messages are logged and visible to both sides.</span></li>
                <li className="flex items-start gap-3"><XCircle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Decline Service:</strong> If they can't accommodate the request, they can decline with a reason.</span></li>
              </ul>
            </div>

            <p className="text-xs text-gray-500 font-roboto italic">
              You can also access the portal yourself from the "View" button on any active service event.
            </p>
          </div>
        );

      case 'completion':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Once your mechanic marks the aircraft as ready, you complete the event by entering the logbook data from their sign-off. This is the critical step that resets all maintenance tracking.
            </p>

            <div className="bg-green-50 rounded p-4 border border-green-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-3 flex items-center gap-2"><CheckCircle size={14} /> What Happens on Completion</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">1.</span> <span><strong>You enter logbook data</strong> for each MX item: completion date, engine time at completion, mechanic name, certificate number, and work description.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">2.</span> <span><strong>Time-based items reset:</strong> The "last completed" time updates to the logbook value, and the next due time recalculates using the configured interval.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">3.</span> <span><strong>Date-based items reset:</strong> The "last completed" date updates, and the next due date recalculates from the logbook date + interval.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">4.</span> <span><strong>Squawks auto-resolve:</strong> Any squawks included in the work package are automatically marked as resolved.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">5.</span> <span><strong>Reminder flags clear:</strong> All automated alert and scheduling flags reset so the cycle can begin again for the next interval.</span></li>
              </ul>
            </div>

            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Important</p>
              <p className="text-sm text-gray-600 font-roboto">
                Always enter the engine time and date <strong>exactly as recorded in the mechanic's logbook entry</strong>. This ensures the next due threshold is calculated correctly from the actual service time, not the current aircraft time.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[10001] flex items-center justify-center animate-fade-in" style={{ overscrollBehavior: 'contain', paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px) + 8px)', paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px) + 8px)', paddingLeft: '1rem', paddingRight: '1rem' }} onClick={onClose}>
      <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-[#F08B46] max-h-full overflow-y-auto animate-slide-up" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} onClick={e => e.stopPropagation()}>
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Wrench size={20} className="text-[#F08B46]" /> Maintenance Guide
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 p-2 -mr-2"><X size={24}/></button>
        </div>

        {/* Section Navigation */}
        <div className="space-y-2 mb-6">
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <div key={section.id}>
                <button
                  onClick={() => setActiveSection(isActive ? null : section.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded border text-left transition-all active:scale-[0.98] ${isActive ? 'bg-gray-50 border-[#F08B46] shadow-sm' : 'bg-white border-gray-200 hover:border-[#F08B46] hover:bg-gray-50'}`}
                >
                  <span className={section.color}>{section.icon}</span>
                  <span className="font-oswald font-bold uppercase tracking-widest text-sm text-navy flex-1">{section.title}</span>
                  {isActive 
                    ? <ChevronDown size={18} className="text-[#F08B46] shrink-0" /> 
                    : <ChevronRight size={18} className="text-gray-400 shrink-0" />
                  }
                </button>
                {isActive && (
                  <div className="p-4 border border-t-0 border-gray-200 rounded-b bg-white animate-fade-in">
                    {renderSectionContent(section.id)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
