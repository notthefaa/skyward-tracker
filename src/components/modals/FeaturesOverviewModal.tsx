"use client";

import { useEffect } from "react";
import {
  X, Home, PenLine, Calendar, Wrench, FolderOpen, MessageSquare, Settings,
  ShieldCheck, ShieldAlert, Plane, Users, Bell, Smartphone, BookOpen, CheckSquare,
  AlertTriangle, ClipboardList, Gauge, CloudSun,
  type LucideIcon,
} from "lucide-react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { HOWARD_LOGO_PATH } from "@/lib/howard/persona";

/**
 * Features Guide — the "show me everything this app does" reference.
 * Different from HowardTour in both shape and purpose:
 *   Tour  = linear 8-step first-impression orientation
 *   Guide = non-linear card grid, searchable by eye, always available.
 *
 * Entry points:
 *   - Settings menu ("Features Guide")
 *   - Final step of HowardTour ("Open the Features Guide")
 *   - Howard's onboarding closer mentions it
 *
 * Cards are grouped into five sections that match the app's mental
 * model — Fleet basics, Logging, Maintenance, Team, Tools. Each card
 * has an icon, a name, a 1–2 sentence blurb, and a "Where to find it"
 * tag so the user can actually navigate to the feature after reading.
 */

type Card = {
  icon: LucideIcon;
  accent: string;
  name: string;
  blurb: string;
  where: string;
};

type Section = {
  title: string;
  subtitle: string;
  cards: Card[];
};

const SECTIONS: Section[] = [
  {
    title: "Fleet basics",
    subtitle: "Where your aircraft lives in the app",
    cards: [
      {
        icon: Home, accent: '#091F3C',
        name: "Summary dashboard",
        blurb: "Everything you'd ask before a flight: current totals, next inspection, open squawks, airworthiness verdict with the regs that back it.",
        where: "Home icon in the nav",
      },
      {
        icon: Plane, accent: '#091F3C',
        name: "Fleet overview",
        blurb: "If you manage more than one aircraft, tap again to see them side-by-side with status rings.",
        where: "Home icon (when you have 2+ aircraft)",
      },
      {
        icon: Gauge, accent: '#091F3C',
        name: "Aircraft settings",
        blurb: "Make/model, year, tail, engine type, IFR-equipped flag, home airport, main + MX contacts, aircraft photo.",
        where: "Summary → pencil icon on the aircraft card",
      },
    ],
  },
  {
    title: "Logging",
    subtitle: "Capture the day — flights, checks, fuel, photos",
    cards: [
      {
        icon: PenLine, accent: '#3AB0FF',
        name: "Flight log",
        blurb: "Hobbs / Tach / AFTT / FTT, route, pilot initials, landings, engine cycles, fuel used. Totals auto-update the aircraft's current meter atomically.",
        where: "Log → Flight",
      },
      {
        icon: CheckSquare, accent: '#3AB0FF',
        name: "Ops Checks",
        blurb: "VOR checks for 91.171 (30-day validity with dial), oil consumption trending, tire pressure. Three-dial dashboard at a glance.",
        where: "Log → Ops Checks",
      },
    ],
  },
  {
    title: "Maintenance",
    subtitle: "Shop-side work, airworthiness, and coordination",
    cards: [
      {
        icon: Wrench, accent: '#F08B46',
        name: "Maintenance items",
        blurb: "Track recurring inspections with dual intervals — hours AND date, whichever comes first. Setup from FAA-template library or custom.",
        where: "MX → Maintenance",
      },
      {
        icon: AlertTriangle, accent: '#CE3732',
        name: "Squawks",
        blurb: "Report a discrepancy with photos. Flag whether it affects airworthiness (grounds the plane). Resolve via a linked service event or manually.",
        where: "MX → Squawks",
      },
      {
        icon: ClipboardList, accent: '#0EA5E9',
        name: "Service events",
        blurb: "Bundle MX items + squawks into one trip to the shop. Mechanic gets an email with a portal link — they propose dates, upload attachments, comment, and sign off line items. You confirm. Conflicting reservations get auto-cancelled.",
        where: "MX → Service",
      },
      {
        icon: ShieldAlert, accent: '#7C3AED',
        name: "Airworthiness Directives",
        blurb: "Track FAA ADs per aircraft. Nightly sync from the DRS feed pulls new directives automatically. Export a 91.417(b) compliance CSV any time.",
        where: "MX → ADs",
      },
      {
        icon: ShieldCheck, accent: '#56B94A',
        name: "Airworthiness check",
        blurb: "Howard can run an explicit 91.205 / 91.411 / 91.413 / 91.207 / 91.417 verdict on demand — combines equipment, MX, squawks, and ADs into one structured answer.",
        where: "Howard → \"Is my aircraft airworthy?\"",
      },
      {
        icon: Gauge, accent: '#F08B46',
        name: "Equipment list",
        blurb: "Every piece of installed equipment with make/model/serial. Transponder, altimeter, pitot-static due dates drive the airworthiness check automatically.",
        where: "More → Equipment",
      },
    ],
  },
  {
    title: "Team",
    subtitle: "Crew comms, bookings, access",
    cards: [
      {
        icon: Calendar, accent: '#56B94A',
        name: "Calendar & bookings",
        blurb: "Reserve the airplane, see other pilots' bookings, avoid doubles. Confirmed maintenance blocks show as unbookable. Pilots whose reservations get bumped for MX get an email.",
        where: "Calendar icon in nav",
      },
      {
        icon: MessageSquare, accent: '#525659',
        name: "Notes (crew message board)",
        blurb: "Short-form updates that stay with the aircraft — optional photos. The next pilot sees them before they fly. Unread count shows on the nav.",
        where: "More → Notes",
      },
      {
        icon: Users, accent: '#091F3C',
        name: "Crew & access (admin)",
        blurb: "Invite pilots, grant aircraft access, promote someone to aircraft admin. Global admins see the whole fleet.",
        where: "Settings → cog → Users / Access",
      },
    ],
  },
  {
    title: "Tools",
    subtitle: "Everything else Howard, the app, and your reg shelf offer",
    cards: [
      {
        icon: FolderOpen, accent: '#7C3AED',
        name: "Documents",
        blurb: "Upload POH, AFM, MEL, SOPs, registration, airworthiness cert, W&B. SHA-256 hashed for tamper detection. Howard can search inside them for procedures, limits, and reference material.",
        where: "More → Documents",
      },
      {
        icon: MessageSquare, accent: '#e6651b',
        name: "Howard — your hangar helper",
        blurb: "Orange button on every screen. Ask anything — airworthiness, maintenance, fuel state, flight briefings with METARs / TAFs / NOTAMs / PIREPs, FAR questions. He proposes writes (reservations, squawk resolves, service scheduling); you confirm with one tap.",
        where: "Orange floating button, any screen",
      },
      {
        icon: CloudSun, accent: '#e6651b',
        name: "Flight briefing",
        blurb: "Official NOAA weather (METARs + TAFs + SIGMETs + AIRMETs + PIREPs) and FAA NOTAMs — never scraped, always from the authoritative source. Howard decodes METARs into plain English.",
        where: "Howard → Flight briefing",
      },
      {
        icon: Bell, accent: '#F08B46',
        name: "Notifications",
        blurb: "Email alerts for upcoming MX, squawk reports, new notes, and service-event status changes. Thresholds per-user.",
        where: "Settings → cog → Notifications",
      },
      {
        icon: Settings, accent: '#091F3C',
        name: "Your profile",
        blurb: "Name, initials (used on logs), FAA ratings — Howard tailors his tone to your ratings (scaffolds explanations for students; talks shop with CFIs).",
        where: "Settings → cog",
      },
      {
        icon: Smartphone, accent: '#091F3C',
        name: "Install as app",
        blurb: "Skyward is a PWA — add it to your home screen for full-screen, icon-on-desktop experience. No app store required.",
        where: "Browser share menu → Add to Home Screen",
      },
    ],
  },
];

export default function FeaturesOverviewModal({
  show,
  onClose,
}: {
  show: boolean;
  onClose: () => void;
}) {
  useModalScrollLock(show);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[99998] bg-black/60 flex items-end md:items-center justify-center p-0 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full md:max-w-2xl rounded-t-2xl md:rounded-xl shadow-2xl border-t-4 border-[#e6651b] flex flex-col max-h-[92vh] md:max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — Howard-branded so the guide feels like his reference
            shelf, not a generic help modal. */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full overflow-hidden border border-[#e6651b]/30 shrink-0">
              <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <div className="min-w-0">
              <h2 className="font-oswald text-xl md:text-2xl font-bold uppercase text-navy leading-none">
                Features Guide
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#e6651b] mt-1">
                From your hangar helper
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-navy p-2 active:scale-95"
          >
            <X size={20} />
          </button>
        </div>

        {/* Intro line — Howard's voice, one sentence */}
        <div className="px-4 py-3 border-b border-[#e6651b]/10 bg-[#e6651b]/5 shrink-0">
          <p className="font-roboto text-sm text-navy leading-snug">
            <span className="font-bold">Here's the whole hangar.</span>{' '}
            <span className="text-gray-600">
              Scroll through — everything the app does, organized by what you're trying to accomplish. Tap the orange button any time if you'd rather just ask me.
            </span>
          </p>
        </div>

        {/* Sections — scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <div className="mb-3">
                <h3 className="font-oswald text-lg font-bold uppercase text-navy leading-none">
                  {section.title}
                </h3>
                <p className="text-[11px] font-roboto italic text-gray-500 mt-1">
                  {section.subtitle}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {section.cards.map(card => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.name}
                      className="bg-white rounded-lg p-3.5 border border-gray-200 shadow-sm hover:border-[#e6651b]/40 transition-colors flex flex-col gap-2"
                      style={{ borderLeftWidth: 3, borderLeftColor: card.accent }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${card.accent}15`, color: card.accent }}
                        >
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-oswald text-sm font-bold uppercase text-navy leading-tight">
                            {card.name}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-700 leading-relaxed">
                        {card.blurb}
                      </p>
                      <div className="flex items-center gap-1.5 mt-auto pt-1 border-t border-gray-100">
                        <BookOpen size={10} className="text-gray-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                          {card.where}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Footer — friendly close line */}
          <div className="pt-2 pb-1 text-center">
            <p className="text-[11px] font-roboto italic text-gray-400">
              Anything unclear? Tap the orange button and ask.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
