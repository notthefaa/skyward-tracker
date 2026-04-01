"use client";

import { useState } from "react";
import { 
  X, Wrench, Clock, Calendar, Send, CheckCircle, Bell, TrendingUp, 
  ExternalLink, MessageSquare, Sparkles, Plane, XCircle, ChevronRight, 
  ChevronDown, AlertTriangle, Plus, Edit2, RefreshCw, Package,
  Upload, FileText, Link2, Users, Download, Layers
} from "lucide-react";

interface MxGuideModalProps {
  show: boolean;
  onClose: () => void;
}

type GuideSection = 
  | 'overview' 
  | 'tracking' 
  | 'automation' 
  | 'workpackage' 
  | 'portal' 
  | 'completion' 
  | 'conflicts' 
  | 'notifications' 
  | 'exports';

const SECTIONS: { id: GuideSection; title: string; icon: React.ReactNode; color: string }[] = [
  { id: 'overview', title: 'How It Works', icon: <Wrench size={18} />, color: 'text-[#F08B46]' },
  { id: 'tracking', title: 'Item Tracking', icon: <Clock size={18} />, color: 'text-[#3AB0FF]' },
  { id: 'automation', title: 'Predictive Scheduling', icon: <TrendingUp size={18} />, color: 'text-[#F08B46]' },
  { id: 'workpackage', title: 'Work Packages', icon: <Package size={18} />, color: 'text-navy' },
  { id: 'portal', title: 'Mechanic Portal', icon: <ExternalLink size={18} />, color: 'text-[#091F3C]' },
  { id: 'completion', title: 'Completing Service', icon: <CheckCircle size={18} />, color: 'text-success' },
  { id: 'conflicts', title: 'Calendar Conflicts', icon: <Calendar size={18} />, color: 'text-[#CE3732]' },
  { id: 'notifications', title: 'Who Gets Notified', icon: <Users size={18} />, color: 'text-[#3AB0FF]' },
  { id: 'exports', title: 'Reports & Exports', icon: <Download size={18} />, color: 'text-navy' },
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
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Service Event Lifecycle</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Draft', desc: 'Work package created (manually or by the system when items approach their thresholds)', color: 'bg-[#F08B46]' },
                  { label: 'Scheduling', desc: 'Sent to mechanic — negotiating dates and service duration', color: 'bg-gray-500' },
                  { label: 'Confirmed', desc: 'Both sides agreed on a service date. Any overlapping reservations are cancelled automatically.', color: 'bg-[#3AB0FF]' },
                  { label: 'In Progress', desc: 'Mechanic is actively working on the aircraft', color: 'bg-[#56B94A]' },
                  { label: 'Ready for Pickup', desc: 'All work done — mechanic signals the aircraft is ready', color: 'bg-[#56B94A]' },
                  { label: 'Complete', desc: 'Owner enters logbook data — all maintenance tracking resets automatically', color: 'bg-navy' },
                ].map((s) => (
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
              Every status change triggers an email notification to the other party with a direct link to the app or portal. You can also resend a work package as a reminder at any time from the active event card on the Maintenance tab.
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
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> When flight patterns are consistent, you see a tight projection (e.g., "~45 days"). When erratic, the range widens (e.g., "~30-60 days").</li>
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
                Items marked <strong>Required</strong> will ground the aircraft when they expire — the status dot turns red and a "Not Flight Ready" banner appears across the app for all pilots. Items marked <strong>Optional</strong> will show as expired but won't affect airworthiness status.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Edit2 size={14} /> Editing Setup Times</p>
              <p className="text-sm text-gray-600 font-roboto">
                When you first add an aircraft, the times you enter become both the setup baseline and the current totals. Once flight logs exist, the current totals are driven by the latest log entry — editing the aircraft's setup times won't change the displayed totals. The setup fields will be locked with a note explaining this.
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
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Burn Rate:</strong> Calculated from your actual flight activity — how many engine hours per day the aircraft accumulates when it's actively flying, adjusted by how often it flies. Idle gaps are handled correctly without diluting the rate.</span></li>
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Projection Range:</strong> When weekly flying patterns are consistent, you see a tight range (e.g., "~45 days"). When erratic, the range widens (e.g., "~30-60 days") so you know the estimate is less reliable.</span></li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Confidence Score (0-100%)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                The system rates how much to trust its own prediction based on four factors:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">1.</span> <span><strong>History Depth:</strong> How far back flight data goes (more history = more reliable).</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">2.</span> <span><strong>Data Density:</strong> How many flights relative to expected (sparse data = lower confidence).</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">3.</span> <span><strong>Consistency:</strong> How stable weekly flying patterns are (erratic flying = wider projections).</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">4.</span> <span><strong>Recency:</strong> How recently the aircraft has flown. Confidence decays aggressively if the plane has been sitting idle, since a dormant aircraft gives no predictive signal.</span></li>
              </ul>
            </div>
            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-2 flex items-center gap-2"><Bell size={14} /> Automated Actions</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>High confidence (≥80%):</strong> System auto-creates a draft work package and emails the primary contact to review and send.</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>Low confidence (&lt;80%):</strong> System sends a heads-up email only — no draft created. You can schedule manually from the Maintenance tab.</li>
                <li className="flex items-start gap-2"><span className="text-[#F08B46] font-bold shrink-0">•</span> <strong>Hard limits:</strong> Date-based items always trigger at the configured day threshold. Time-based items trigger at the configured hour threshold. Both fire regardless of confidence.</li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Layers size={14} /> Aggregated Drafts</p>
              <p className="text-sm text-gray-600 font-roboto">
                When an item triggers a draft, the system doesn't just include that one item. It looks ahead and bundles <strong>all items due within the next 30 days</strong> into the same draft — so your mechanic gets one comprehensive work package instead of separate emails for each item. This reduces back-and-forth and makes scheduling more efficient.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Internal Reminders</p>
              <p className="text-sm text-gray-600 font-roboto">
                Independently of the scheduling automation, the system sends awareness alerts to the primary contact at three configurable thresholds (e.g., 30 days, 15 days, 5 days out). These are informational — they don't create drafts or trigger any action. Global admins can configure these thresholds from Admin → System Tools → Maintenance Triggers.
              </p>
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
                <li className="flex items-start gap-3"><Wrench size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Maintenance Items:</strong> Select any tracked items approaching their due thresholds. Use "Select All" to include everything at once.</span></li>
                <li className="flex items-start gap-3"><AlertTriangle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Open Squawks:</strong> Include any active squawks you want addressed during the visit. These will auto-resolve when the mechanic completes them.</span></li>
                <li className="flex items-start gap-3"><Sparkles size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Add-On Services:</strong> Request extras like aircraft wash &amp; detail, engine oil change, fluid top-off, nav database update, tire inspection, interior cleaning, pitot-static check, or battery condition check.</span></li>
                <li className="flex items-start gap-3"><Calendar size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Service Date:</strong> Either propose a preferred date, or choose "Request Availability" to let the mechanic propose dates that work for their shop.</span></li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2">Preview Before Sending</p>
              <p className="text-sm text-gray-600 font-roboto">
                Before sending, you can preview the exact email your mechanic will receive — including all line items, contact info, and the portal link. The email is CC'd to the primary contact so you have a copy.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Draft Review</p>
              <p className="text-sm text-gray-600 font-roboto">
                When the system auto-creates a draft (from the predictive engine), you'll see an orange highlighted banner on the Maintenance tab. Open it to review the bundled items, add more MX items or squawks, include add-on services, set a preferred date, and then send when ready. You're always in control — nothing goes to your mechanic until you explicitly send it.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><RefreshCw size={14} /> Resend as Reminder</p>
              <p className="text-sm text-gray-600 font-roboto">
                After sending a work package, you can resend it at any time from the active event card on the Maintenance tab. This sends the same email again with a "Reminder" prefix in the subject line — useful if you haven't heard back.
              </p>
            </div>
          </div>
        );

      case 'portal':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Your mechanic accesses a secure portal through a link in their email. No account or login is required — the link contains a unique, unguessable access token. The portal expires 7 days after the event is completed.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">What Your Mechanic Can Do</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-3"><Calendar size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Propose or Confirm Dates:</strong> Accept your proposed date or suggest an alternative. They must provide an <strong>estimated service duration</strong> (in days) — this determines the calendar blocking window and estimated completion date.</span></li>
                <li className="flex items-start gap-3"><Edit2 size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Update Line Items:</strong> Mark each item as Pending, In Progress, Complete, or Deferred. You're notified by email of every status change with a progress summary.</span></li>
                <li className="flex items-start gap-3"><Plus size={16} className="text-[#F08B46] shrink-0 mt-0.5" /> <span><strong>Suggest Additional Work:</strong> If they discover something during service, they can add it to the package with a name and description. You get an email alert immediately.</span></li>
                <li className="flex items-start gap-3"><Upload size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Upload Files:</strong> Attach photos, PDFs, or Word documents (up to 5 files per upload, 10MB each). Great for work order estimates, photos of discovered issues, or inspection reports. You're notified by email when files are uploaded.</span></li>
                <li className="flex items-start gap-3"><Clock size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Set Estimated Completion:</strong> Provide an expected ready date and notes (parts on order, weather delays, etc.).</span></li>
                <li className="flex items-start gap-3"><Plane size={16} className="text-success shrink-0 mt-0.5" /> <span><strong>Mark Ready for Pickup:</strong> When all work is done, they signal that the aircraft is ready. You receive an email notification prompting you to enter logbook data.</span></li>
                <li className="flex items-start gap-3"><MessageSquare size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Send Messages:</strong> Communicate directly through the portal. All messages are logged in a thread visible to both sides, with timestamps.</span></li>
                <li className="flex items-start gap-3"><XCircle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Decline Service:</strong> If they can't accommodate the request, they can decline with a reason. You're notified and can seek an alternative provider.</span></li>
              </ul>
            </div>
            <p className="text-xs text-gray-500 font-roboto italic">
              You can also access the portal yourself from the "Portal" button on any active service event — useful for seeing exactly what your mechanic sees.
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
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">1.</span> <span><strong>You enter logbook data</strong> for each item: completion date, engine time at completion, mechanic name, certificate number, and work description.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">2.</span> <span><strong>Time-based items reset:</strong> The "last completed" time updates to the logbook value, and the next due time recalculates using the configured interval.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">3.</span> <span><strong>Date-based items reset:</strong> The "last completed" date updates, and the next due date recalculates from the logbook date + interval.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">4.</span> <span><strong>Squawks auto-resolve:</strong> Any squawks included in the work package are automatically marked as resolved, with a cross-reference showing which service event resolved them.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">5.</span> <span><strong>Reminder flags clear:</strong> All automated alert and scheduling flags reset so the cycle can begin again for the next interval.</span></li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Layers size={14} /> Partial Completion</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                You don't have to complete everything at once. The system supports completing items individually:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Use the checkboxes to select which items you want to complete now.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Completed items reset their tracking immediately.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> The event stays open for the remaining items.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Come back later to complete or defer the rest.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Once all items are resolved (completed or deferred), a "Close Service Event" button appears to finalize.</li>
              </ul>
              <p className="text-sm text-gray-600 font-roboto mt-3">
                This is useful when your mechanic signs off items over multiple days, or when some items are deferred to a future visit.
              </p>
            </div>
            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#F08B46] mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Important</p>
              <p className="text-sm text-gray-600 font-roboto">
                Always enter the engine time and date <strong>exactly as recorded in the mechanic's logbook entry</strong>. This ensures the next due threshold is calculated correctly from the actual service time, not the current aircraft time. For example, if the annual was signed off at 1,523.4 hours but the plane now shows 1,525.0 — enter 1,523.4.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Link2 size={14} /> Squawk Cross-References</p>
              <p className="text-sm text-gray-600 font-roboto">
                After a service event is completed, any squawks that were resolved through it will show a reference badge: "Resolved by Service Event on [date]." This creates an audit trail linking discrepancy reports to the maintenance that addressed them — visible on both the Squawks tab and in PDF exports.
              </p>
            </div>
          </div>
        );

      case 'conflicts':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              When a service date is confirmed — by either the owner or the mechanic — the system automatically checks the calendar for conflicts and resolves them.
            </p>
            <div className="bg-red-50 rounded p-4 border border-red-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] mb-2 flex items-center gap-2"><Calendar size={14} /> What Happens Automatically</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> The system finds all confirmed reservations that overlap with the maintenance period (from the confirmed start date through the estimated completion date).</li>
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> Each overlapping reservation is automatically cancelled.</li>
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> Every affected pilot receives an email listing their cancelled booking(s) along with the maintenance dates, so they can rebook for after the service.</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Calendar Blocking</p>
              <p className="text-sm text-gray-600 font-roboto">
                Once a service date is confirmed, the maintenance period also blocks the calendar. Any pilot trying to create a new reservation during the maintenance window will see an error message. This prevents new bookings from being created during service.
              </p>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2">Service Duration Matters</p>
              <p className="text-sm text-gray-600 font-roboto">
                The mechanic is required to provide an estimated service duration (in days) when proposing or confirming a date. This duration determines how many calendar days are blocked. For example, a 3-day service starting March 10 blocks March 10-12 inclusive. If no duration is provided, only the single confirmed date is blocked.
              </p>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              The notification system routes emails to the right people based on the type of event. Understanding who gets what helps avoid confusion.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Primary Contact (Maintenance Coordination)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                The <strong>primary contact</strong> is the person whose email is set in the aircraft's "Main Contact Email" field. This person receives all maintenance-specific notifications:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> MX reminder alerts (30/15/5 day thresholds)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Draft work package creation alerts</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> All service event updates from the mechanic (date proposals, confirmations, progress updates, ready for pickup, file uploads, additional work suggestions, declines)</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">All Assigned Pilots (Operational Awareness)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                All pilots assigned to the aircraft receive operational notifications (except the person who triggered the action):
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> New squawk reports</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> New notes posted</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Reservation created or cancelled</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Reservation cancelled due to maintenance conflict</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Mechanic</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                Your maintenance contact receives:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Work package emails (CC'd to primary contact)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Squawk details when "Notify MX" is checked (CC'd to primary contact)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Owner scheduling actions (date confirmations, counter proposals, messages, cancellations)</li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Bell size={14} /> Managing Your Preferences</p>
              <p className="text-sm text-gray-600 font-roboto">
                Each pilot can control which emails they receive from the Settings screen (gear icon in the header). MX-specific toggles (maintenance reminders, service updates) are only shown if you are the primary contact on at least one aircraft — since those emails only go to the primary contact anyway.
              </p>
            </div>
          </div>
        );

      case 'exports':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              The system provides several export options for record-keeping and documentation.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Download size={14} /> Maintenance History (PDF)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "History" on the Maintenance tab to download a PDF of all completed service events. Each entry includes the completion date, mechanic name, confirmed service date, and full details for every line item: item name, status, completion date and engine time, mechanic signature info (name and certificate number), and work description. This creates a complete maintenance audit trail.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><FileText size={14} /> Squawk Report (PDF)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "Export PDF" on the Squawks tab to generate a formal squawk report. You can select which squawks to include (active, resolved, or both). The report includes dates, locations, descriptions, status, deferral details, service event cross-references, and attached photos.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Download size={14} /> Flight Log (CSV)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "Export CSV" on the Times tab to download the complete flight log history as a spreadsheet. Includes date, routing, pilot initials, flight time, cumulative engine times, landings, cycles (turbine), fuel state, reason codes, and passenger info.
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
