"use client";

import { useState } from "react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
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
  { id: 'overview', title: 'How It Works', icon: <Wrench size={18} />, color: 'text-mxOrange' },
  { id: 'tracking', title: 'Item Tracking', icon: <Clock size={18} />, color: 'text-[#3AB0FF]' },
  { id: 'automation', title: 'Auto-Scheduling & Forecasts', icon: <TrendingUp size={18} />, color: 'text-mxOrange' },
  { id: 'workpackage', title: 'Work Packages', icon: <Package size={18} />, color: 'text-navy' },
  { id: 'portal', title: 'Mechanic Portal', icon: <ExternalLink size={18} />, color: 'text-[#091F3C]' },
  { id: 'completion', title: 'Completing Service', icon: <CheckCircle size={18} />, color: 'text-success' },
  { id: 'conflicts', title: 'Calendar Conflicts', icon: <Calendar size={18} />, color: 'text-[#CE3732]' },
  { id: 'notifications', title: 'Who Gets Notified', icon: <Users size={18} />, color: 'text-[#3AB0FF]' },
  { id: 'exports', title: 'Reports & Exports', icon: <Download size={18} />, color: 'text-navy' },
];

export default function MxGuideModal({ show, onClose }: MxGuideModalProps) {
  const [activeSection, setActiveSection] = useState<GuideSection | null>(null);
  useModalScrollLock(show);

  if (!show) return null;

  const renderSectionContent = (section: GuideSection) => {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Skyward tracks each maintenance item all the way through a service event with your mechanic. Here's how an event moves through the system:
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Service Event Lifecycle</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Draft', desc: 'You\u2019ve built a work package, or we auto-drafted one when items got close to due', color: 'bg-mxOrange' },
                  { label: 'Scheduling', desc: 'Sent to your mechanic \u2014 waiting on proposed dates and how long the work will take', color: 'bg-gray-500' },
                  { label: 'Confirmed', desc: 'You and your mechanic agreed on a date. We automatically cancel reservations that overlap the service window.', color: 'bg-[#3AB0FF]' },
                  { label: 'In Progress', desc: 'Mechanic is working on the aircraft', color: 'bg-[#56B94A]' },
                  { label: 'Ready for Pickup', desc: 'All work is done \u2014 mechanic has signaled the airplane is ready', color: 'bg-[#56B94A]' },
                  { label: 'Complete', desc: 'You entered the logbook data. Tracking resets for the next interval.', color: 'bg-navy' },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className={`${s.color} text-white text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded w-28 text-center shrink-0`}>{s.label}</span>
                    <span className="text-xs text-gray-600 font-roboto">{s.desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3">
                <span className="bg-[#CE3732] text-white text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded w-28 text-center shrink-0">Cancelled</span>
                <span className="text-xs text-gray-600 font-roboto">You or your mechanic called it off at any point</span>
              </div>
            </div>
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Every status change sends an email to the other side with a link straight to the app or the mechanic portal. You can also resend a work package as a reminder from the active event card on the Maintenance tab.
            </p>
          </div>
        );

      case 'tracking':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Each maintenance item is tracked by engine hours, calendar dates, or both. When you complete an item, we recalculate the next due point automatically.
            </p>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Clock size={14} /> Time-Based Tracking</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Enter the engine time at last completion and the hour interval.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> We work out the next due time: last completed + interval.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> You see both hours remaining and an estimated day count based on how much you've been flying.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Steady flying gives you a tight projection (e.g., "~45 days"). Irregular flying widens the range (e.g., "~30-60 days") so you know the number is softer.</li>
              </ul>
            </div>
            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mxOrange mb-2 flex items-center gap-2"><Calendar size={14} /> Date-Based Tracking</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> Enter the last completed date and the day interval.</li>
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> We work out the next due date: last completed + interval.</li>
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> The day counter ticks down to that date.</li>
              </ul>
            </div>
            <div className="bg-red-50 rounded p-4 border border-red-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Required vs Optional</p>
              <p className="text-sm text-gray-600 font-roboto">
                Items marked <strong>Required</strong> ground the airplane when they go past due — the status dot turns red and a "Not Flight Ready" banner appears across the app for every pilot. Items marked <strong>Optional</strong> still show as past due, but they don't affect the airworthiness status.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Edit2 size={14} /> Editing Setup Times</p>
              <p className="text-sm text-gray-600 font-roboto">
                The times you enter when first adding an aircraft set both the starting point and the current totals. Once you log a flight, current totals come from your flight log — editing the aircraft's setup times no longer changes them, and the setup fields lock with a note.
              </p>
            </div>
          </div>
        );

      case 'automation':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              We look at the last 180 days of your flight data to forecast when maintenance will come due — including hour-based items, where the answer depends on how often you fly.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">How Forecasts Work</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-mxOrange shrink-0 mt-0.5" /> <span><strong>Hours per day:</strong> We work out how many engine hours you put on the airplane in a typical day, weighting by how often it actually flies so long idle stretches don't drag the number down.</span></li>
                <li className="flex items-start gap-2"><TrendingUp size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Projection range:</strong> Steady flying gives a tight window (e.g., "~45 days"). Irregular flying widens it (e.g., "~30-60 days") so you know the estimate is softer.</span></li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Forecast Confidence (0-100%)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                We rate how much to trust the forecast on four things:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">1.</span> <span><strong>How far back the data goes:</strong> More history means a more reliable forecast.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">2.</span> <span><strong>How busy the log is:</strong> Sparse flight logs lower confidence; a packed log raises it.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">3.</span> <span><strong>How steady the flying is:</strong> A regular week-to-week cadence tightens the projection; irregular flying widens it.</span></li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">4.</span> <span><strong>How recently it flew:</strong> If the airplane has been sitting, confidence drops fast — a parked airplane tells us nothing about how fast it's putting on hours.</span></li>
              </ul>
            </div>
            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mxOrange mb-2 flex items-center gap-2"><Bell size={14} /> What we do automatically</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> <strong>80% confidence or higher:</strong> We draft a work package and email the primary contact to review and send it.</li>
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> <strong>Below 80%:</strong> We send a heads-up email only — no draft. You schedule manually from the Maintenance tab when you're ready.</li>
                <li className="flex items-start gap-2"><span className="text-mxOrange font-bold shrink-0">•</span> <strong>Hard cutoffs:</strong> Date-based items always fire at the configured day threshold. Time-based items fire at the configured hour threshold. Both ignore the confidence score.</li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Layers size={14} /> Bundled drafts</p>
              <p className="text-sm text-gray-600 font-roboto">
                When one item triggers a draft, we don't stop there. We look ahead and pull in <strong>every other item due within the next 30 days</strong> — so your mechanic gets one package, not a drip of emails for each item.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Heads-up reminders</p>
              <p className="text-sm text-gray-600 font-roboto">
                Separate from the auto-scheduler, we email the primary contact heads-up reminders at three configurable points (e.g., 30 days, 15 days, 5 days out). These don't draft anything or take action — they're just a nudge. Global admins set the thresholds from Admin → System Tools → Maintenance Triggers.
              </p>
            </div>
          </div>
        );

      case 'workpackage':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              A work package bundles everything your mechanic needs into one request. You build one by hand, or review a draft we auto-created from the forecast.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">What Goes in a Work Package</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-3"><Wrench size={16} className="text-mxOrange shrink-0 mt-0.5" /> <span><strong>Maintenance items:</strong> Pick any tracked items that are close to due. "Select all" grabs everything at once.</span></li>
                <li className="flex items-start gap-3"><AlertTriangle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Open squawks:</strong> Include any active squawks you want addressed on the visit. They'll be marked resolved when your mechanic completes them.</span></li>
                <li className="flex items-start gap-3"><Sparkles size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Add-ons:</strong> Request extras like wash &amp; detail, oil change, fluid top-off, nav database update, tire inspection, interior cleaning, pitot-static check, or battery check.</span></li>
                <li className="flex items-start gap-3"><Calendar size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Service date:</strong> Propose a preferred date, or choose "Request Availability" to let the mechanic propose dates that fit their shop.</span></li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2">Preview before sending</p>
              <p className="text-sm text-gray-600 font-roboto">
                You can preview the exact email your mechanic will get before you send — every line item, contact info, and the portal link. The email is CC'd to the primary contact so you have a copy.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Reviewing an auto-draft</p>
              <p className="text-sm text-gray-600 font-roboto">
                When we auto-create a draft from the forecast, you'll see an orange banner on the Maintenance tab. Open it to review what's bundled, add more items or squawks, include add-ons, pick a preferred date, then send when ready. Nothing reaches your mechanic until you tap send.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><RefreshCw size={14} /> Resend as a reminder</p>
              <p className="text-sm text-gray-600 font-roboto">
                Once a work package is out, you can resend it any time from the active event card on the Maintenance tab. Same email again, with "Reminder" tacked onto the subject line — useful when you haven't heard back.
              </p>
            </div>
          </div>
        );

      case 'portal':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Your mechanic opens a secure portal by clicking the link in their email — no login or account. The link is unique to that event and stops working 7 days after the event is completed.
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">What Your Mechanic Can Do</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-3"><Calendar size={16} className="text-mxOrange shrink-0 mt-0.5" /> <span><strong>Propose or confirm a date:</strong> Accept the date you proposed or counter with a different one. They have to enter <strong>how many days the work will take</strong> — that's how we block out the calendar and show an estimated completion date.</span></li>
                <li className="flex items-start gap-3"><Edit2 size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Update each item:</strong> Mark each item Pending, In Progress, Complete, or Deferred. You get an email on every status change with a progress summary.</span></li>
                <li className="flex items-start gap-3"><Plus size={16} className="text-mxOrange shrink-0 mt-0.5" /> <span><strong>Add discovered work:</strong> If they find something during the visit, they can add it to the package with a name and description. You get an email alert right away.</span></li>
                <li className="flex items-start gap-3"><Upload size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Upload files:</strong> Attach photos, PDFs, or Word documents (up to 5 files per upload, 10MB each). Great for work order estimates, photos of what they found, or inspection reports. You get an email when files arrive.</span></li>
                <li className="flex items-start gap-3"><Clock size={16} className="text-navy shrink-0 mt-0.5" /> <span><strong>Set estimated completion:</strong> Give an expected ready date and notes (parts on order, weather delays, etc.).</span></li>
                <li className="flex items-start gap-3"><Plane size={16} className="text-success shrink-0 mt-0.5" /> <span><strong>Mark ready for pickup:</strong> When all work is done, they signal the airplane is ready. You get an email asking you to come enter logbook data.</span></li>
                <li className="flex items-start gap-3"><MessageSquare size={16} className="text-[#3AB0FF] shrink-0 mt-0.5" /> <span><strong>Send messages:</strong> Message back and forth through the portal. Every message is timestamped and visible to both sides.</span></li>
                <li className="flex items-start gap-3"><XCircle size={16} className="text-[#CE3732] shrink-0 mt-0.5" /> <span><strong>Decline the job:</strong> If they can't take it, they can decline with a reason. You're notified and can reach out to a different mechanic.</span></li>
              </ul>
            </div>
            <p className="text-xs text-gray-500 font-roboto italic">
              You can open the same portal yourself from the "Portal" button on any active service event — handy for seeing exactly what your mechanic sees.
            </p>
          </div>
        );

      case 'completion':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              Once your mechanic marks the airplane ready, you finish the event by entering the logbook data from their sign-off. This is the step that resets maintenance tracking for the next interval.
            </p>
            <div className="bg-green-50 rounded p-4 border border-green-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-3 flex items-center gap-2"><CheckCircle size={14} /> What happens when you complete an event</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-3">
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">1.</span> <span><strong>You enter logbook data</strong> for each item: completion date, engine time at completion, mechanic name, certificate number, and work description.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">2.</span> <span><strong>Time-based items reset:</strong> Last-completed time updates to the logbook value, and we recalculate the next due time using the interval you set.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">3.</span> <span><strong>Date-based items reset:</strong> Last-completed date updates, and we recalculate the next due date from the logbook date + interval.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">4.</span> <span><strong>Squawks auto-resolve:</strong> Any squawks included in the work package are marked resolved, with a link back to which service event fixed them.</span></li>
                <li className="flex items-start gap-2"><span className="text-success font-bold shrink-0">5.</span> <span><strong>Reminder flags clear:</strong> All reminder and auto-scheduling flags reset, so the cycle starts over for the next interval.</span></li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Layers size={14} /> Finishing items one at a time</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                You don't have to close everything at once. Finish items as they're signed off:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Check the boxes next to the items you want to complete now.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Those items reset their tracking right away.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> The event stays open for the rest.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Come back later to complete or defer whatever's left.</li>
                <li className="flex items-start gap-2"><span className="text-[#3AB0FF] font-bold shrink-0">•</span> Once every item is either complete or deferred, a "Close Service Event" button appears to wrap it up.</li>
              </ul>
              <p className="text-sm text-gray-600 font-roboto mt-3">
                Useful when your mechanic signs off items over several days, or when some items get pushed to the next visit.
              </p>
            </div>
            <div className="bg-orange-50 rounded p-4 border border-orange-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mxOrange mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Important</p>
              <p className="text-sm text-gray-600 font-roboto">
                Always enter the engine time and date <strong>exactly as recorded in the mechanic's logbook entry</strong>. That way the next due time is counted from when the work actually happened, not when you're filling in the form. Example: the annual was signed off at 1,523.4 hours but the airplane now shows 1,525.0 — enter 1,523.4.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Link2 size={14} /> Squawk-to-service links</p>
              <p className="text-sm text-gray-600 font-roboto">
                Once a service event is complete, every squawk it resolved shows a badge: "Resolved by Service Event on [date]." You end up with a paper trail linking each squawk to the maintenance that fixed it — visible on the Squawks tab and in PDF exports.
              </p>
            </div>
          </div>
        );

      case 'conflicts':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              When a service date gets confirmed — by owner or mechanic — we check the calendar for conflicts and handle them automatically.
            </p>
            <div className="bg-red-50 rounded p-4 border border-red-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#CE3732] mb-2 flex items-center gap-2"><Calendar size={14} /> What we handle automatically</p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> We find every confirmed reservation that overlaps the service window (confirmed start date through estimated completion).</li>
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> Each overlapping reservation gets cancelled.</li>
                <li className="flex items-start gap-2"><span className="text-[#CE3732] font-bold shrink-0">•</span> Every affected pilot gets an email listing their cancelled booking(s) and the maintenance dates, so they can rebook for after the service.</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2">Blocking the calendar</p>
              <p className="text-sm text-gray-600 font-roboto">
                Once a service date is confirmed, we block the calendar for the full maintenance window. If a pilot tries to book during that window, they see an error — no new bookings can land on top of service.
              </p>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2">How long the work takes matters</p>
              <p className="text-sm text-gray-600 font-roboto">
                The mechanic has to enter how many days the work will take when they propose or confirm a date. That's how many calendar days we block. Example: a 3-day service starting March 10 blocks March 10-12 inclusive. If they don't enter a duration, we only block the single confirmed date.
              </p>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              We send each type of update to the right people. Here's who gets what:
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Primary contact (runs maintenance coordination)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                The <strong>primary contact</strong> is whoever's email sits in the aircraft's "Main Contact Email" field. This person gets every maintenance-specific email:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Heads-up reminders (30/15/5 day thresholds)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Auto-drafted work package alerts</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Every service-event update from the mechanic (date proposals, confirmations, progress updates, ready for pickup, file uploads, new discovered work, declines)</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">All pilots on the airplane (operational awareness)</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                Every pilot with access to the aircraft gets operational alerts — except whoever did the thing:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> New squawk reports</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> New notes posted</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> A reservation created or cancelled</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> A reservation cancelled because of a maintenance conflict</li>
              </ul>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-3">Mechanic</p>
              <p className="text-sm text-gray-600 font-roboto mb-3">
                Your maintenance contact gets:
              </p>
              <ul className="text-sm text-gray-600 font-roboto space-y-2">
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Work package emails (CC'd to the primary contact)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Squawk details when you check "Notify MX" on the squawk (CC'd to the primary contact)</li>
                <li className="flex items-start gap-2"><span className="text-navy font-bold shrink-0">•</span> Owner scheduling actions — date confirmations, counter proposals, messages, cancellations</li>
              </ul>
            </div>
            <div className="bg-blue-50 rounded p-4 border border-blue-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#3AB0FF] mb-2 flex items-center gap-2"><Bell size={14} /> Turning emails on or off</p>
              <p className="text-sm text-gray-600 font-roboto">
                Each pilot controls their own email preferences from the Settings screen (gear icon in the header). The maintenance-specific toggles (reminders, service updates) only show up if you're the primary contact on at least one aircraft — those emails only go to the primary contact anyway.
              </p>
            </div>
          </div>
        );

      case 'exports':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 font-roboto leading-relaxed">
              A few different ways to export your records for an IA, a next owner, or your own files:
            </p>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Download size={14} /> Maintenance History (PDF)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "History" on the Maintenance tab to download a PDF of every completed service event. Each entry covers completion date, mechanic name, confirmed service date, and full details for every line item: name, status, completion date and engine time, mechanic signature (name + certificate number), and work description. A complete maintenance paper trail.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><FileText size={14} /> Squawk Report (PDF)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "Export PDF" on the Squawks tab to generate a formal squawk report. Pick which squawks to include (active, resolved, or both). The report covers dates, locations, descriptions, status, deferral details, links to the service events that resolved them, and attached photos.
              </p>
            </div>
            <div className="bg-gray-50 rounded p-4 border border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-navy mb-2 flex items-center gap-2"><Download size={14} /> Flight Log (CSV)</p>
              <p className="text-sm text-gray-600 font-roboto">
                Tap "Export CSV" on the Times tab to download the full flight log as a spreadsheet — date, routing, pilot initials, flight time, cumulative engine times, landings, cycles (turbine), fuel state, reason codes, and passenger info.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[10001] overflow-y-auto animate-fade-in" style={{ overscrollBehavior: 'contain' }} onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="bg-white rounded shadow-2xl w-full max-w-lg p-6 border-t-4 border-mxOrange animate-slide-up" onClick={e => e.stopPropagation()}>
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-oswald text-2xl font-bold uppercase text-navy flex items-center gap-2">
            <Wrench size={20} className="text-mxOrange" /> Maintenance Guide
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
                  className={`w-full flex items-center gap-3 p-3 rounded border text-left transition-all active:scale-[0.98] ${isActive ? 'bg-gray-50 border-mxOrange shadow-sm' : 'bg-white border-gray-200 hover:border-mxOrange hover:bg-gray-50'}`}
                >
                  <span className={section.color}>{section.icon}</span>
                  <span className="font-oswald font-bold uppercase tracking-widest text-sm text-navy flex-1">{section.title}</span>
                  {isActive 
                    ? <ChevronDown size={18} className="text-mxOrange shrink-0" /> 
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
    </div>
  );
}
