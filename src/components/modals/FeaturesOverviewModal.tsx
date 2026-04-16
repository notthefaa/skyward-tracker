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
    subtitle: "Your aircraft and its current state",
    cards: [
      {
        icon: Home, accent: '#091F3C',
        name: "Summary",
        blurb: "Live airworthiness verdict citing specific FARs (91.205, 91.411, 91.413, 91.207). Current Hobbs/Tach, engine burn rate, fuel state, next inspection due, open squawks. Grounded items turn the header red.",
        where: "Home icon in the nav",
      },
      {
        icon: Plane, accent: '#091F3C',
        name: "Fleet view",
        blurb: "Multi-aircraft operators see every tail side-by-side with airworthiness status rings — green/orange/red. Tap one to drill in.",
        where: "Home icon (double-tap with 2+ aircraft)",
      },
    ],
  },
  {
    title: "Logging",
    subtitle: "Every entry updates totals atomically — no drift, no race conditions",
    cards: [
      {
        icon: PenLine, accent: '#3AB0FF',
        name: "Flight log",
        blurb: "Hobbs/Tach/AFTT/FTT, route, pilot, fuel, landings, engine cycles. Each entry locks the aircraft row in a single database transaction so two pilots logging at the same time can't clobber each other's totals.",
        where: "Log → Flight",
      },
      {
        icon: CheckSquare, accent: '#56B94A',
        name: "Ops Checks",
        blurb: "VOR checks with 30-day validity tracked against FAR 91.171 (auto-flags when due). Oil consumption trending across engine hours. Tire PSI. All three on a live-updating dial dashboard.",
        where: "Log → Ops Checks",
      },
    ],
  },
  {
    title: "Maintenance",
    subtitle: "From tracking to the shop visit to the signoff",
    cards: [
      {
        icon: Wrench, accent: '#F08B46',
        name: "Maintenance items",
        blurb: "Dual-interval tracking — hours AND calendar date, whichever comes first. Seed from an FAA inspection template or create custom items. Predictive scheduling emails you before items are due.",
        where: "MX → Maintenance",
      },
      {
        icon: AlertTriangle, accent: '#CE3732',
        name: "Squawks",
        blurb: "Report a discrepancy with photos. Flag airworthiness impact — that flag grounds the aircraft immediately and shows across Howard, the summary, and the fleet view. Resolved squawks link back to the service event that fixed them.",
        where: "MX → Squawks",
      },
      {
        icon: ClipboardList, accent: '#0EA5E9',
        name: "Service events",
        blurb: "Bundle MX items and squawks into one shop visit. Your mechanic gets an email with a portal link — no account needed. They propose dates, upload photos, comment, and sign off individual line items. You confirm from the app. Conflicting pilot reservations are auto-cancelled with email notification.",
        where: "MX → Service",
      },
      {
        icon: ShieldAlert, accent: '#7C3AED',
        name: "Airworthiness Directives",
        blurb: "Track ADs per aircraft with compliance status (overdue / due soon / compliant). Nightly auto-sync from the FAA DRS feed pulls newly issued directives. Export a 91.417(b) compliance CSV for your IA — audit-ready in one tap.",
        where: "MX → ADs",
      },
      {
        icon: Gauge, accent: '#F08B46',
        name: "Equipment list",
        blurb: "Every installed piece with make/model/serial and certification due dates. Transponder (91.413), altimeter + pitot-static (91.411), and ELT (91.207) dates feed the airworthiness check automatically — if a date lapses, the aircraft shows grounded.",
        where: "More → Equipment",
      },
    ],
  },
  {
    title: "Team",
    subtitle: "Scheduling, crew comms, and access control",
    cards: [
      {
        icon: Calendar, accent: '#56B94A',
        name: "Calendar",
        blurb: "Confirmed maintenance dates auto-block the calendar. If MX bumps a pilot's reservation, they get an email explaining what happened and why. Howard can book for you from a chat.",
        where: "Calendar icon in nav",
      },
      {
        icon: MessageSquare, accent: '#525659',
        name: "Notes",
        blurb: "Crew message board that stays with the aircraft — not a group text that scrolls away. Attach photos. Next pilot sees unread notes before they fly. Badged in the nav.",
        where: "More → Notes",
      },
      {
        icon: Users, accent: '#091F3C',
        name: "Crew & access",
        blurb: "Invite pilots by email — they get a setup link with no app store required. Grant access per aircraft, promote to aircraft admin. Global admins see the whole fleet.",
        where: "Settings → cog → Users / Access",
      },
    ],
  },
  {
    title: "Howard + Tools",
    subtitle: "AI-powered, FAA-sourced, always available",
    cards: [
      {
        icon: MessageSquare, accent: '#e6651b',
        name: "Howard",
        blurb: "Orange button on every screen. Ask airworthiness, flight briefings (METARs/TAFs/NOTAMs/PIREPs from NOAA/FAA), decode a METAR, pull an AD, search inside your uploaded documents. He proposes actions — book a flight, resolve a squawk, schedule MX — you see a card and tap Confirm.",
        where: "Orange floating button, any screen",
      },
      {
        icon: CloudSun, accent: '#e6651b',
        name: "Flight briefing",
        blurb: "Official NOAA weather (METARs, TAFs, SIGMETs, AIRMETs, PIREPs) and FAA NOTAMs pulled directly from the source — always current, never cached scrapings. Howard decodes METARs into plain English and flags what matters.",
        where: "Howard → Flight briefing",
      },
      {
        icon: FolderOpen, accent: '#7C3AED',
        name: "Documents",
        blurb: "Upload POH, AFM, MEL, SOPs, registration, W&B. Each file is tamper-checked with a SHA-256 hash. Howard can search inside them — ask 'What's the Vne?' and he'll find the answer in your POH.",
        where: "More → Documents",
      },
      {
        icon: ShieldCheck, accent: '#56B94A',
        name: "Airworthiness check",
        blurb: "Howard runs an explicit verdict against 91.205/91.411/91.413/91.207/91.417 on demand — combines your equipment due dates, MX items, open squawks, and AD compliance into one structured answer, citing the specific reg that's blocking you.",
        where: "Howard → 'Is my aircraft airworthy?'",
      },
      {
        icon: Settings, accent: '#091F3C',
        name: "Profile & ratings",
        blurb: "Your FAA ratings shape how Howard talks to you. Student pilots get more scaffolding and VFR-framed language; CPLs and CFIs get the short version. Set your certs once and the tone adjusts everywhere.",
        where: "Settings → cog",
      },
      {
        icon: Bell, accent: '#F08B46',
        name: "Notifications",
        blurb: "Email alerts as MX items approach due — configurable thresholds (30/15/5 days and hours). Squawk reports, new notes, and service-event status changes also trigger emails.",
        where: "Settings → cog → Notifications",
      },
      {
        icon: Smartphone, accent: '#091F3C',
        name: "Install as app",
        blurb: "Skyward is a PWA. Add it to your home screen from the browser share menu — full-screen, its own icon, no app store. Works on iPhone, Android, and desktop.",
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
