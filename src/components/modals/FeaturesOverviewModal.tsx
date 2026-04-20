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
 * model — Fleet basics, Logging, Maintenance, Shared aircraft, Tools. Each card
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
    subtitle: "The airplane and where it stands right now",
    cards: [
      {
        icon: Home, accent: '#091F3C',
        name: "Summary",
        blurb: "Status at a glance — is the airplane good to go, or is there maintenance to address? Current Hobbs/Tach, fuel, next inspection, and any open squawks. Header runs green, orange, or red so you know before you walk out to the ramp.",
        where: "Home icon in the nav",
      },
      {
        icon: Plane, accent: '#091F3C',
        name: "Fleet view",
        blurb: "Every tail side-by-side when you've got more than one airplane. Green, orange, red — pick the one you need.",
        where: "Home icon (double-tap with 2+ aircraft)",
      },
    ],
  },
  {
    title: "Logging",
    subtitle: "Log what you fly — totals stay in sync across every pilot on the airplane",
    cards: [
      {
        icon: PenLine, accent: '#3AB0FF',
        name: "Flight log",
        blurb: "Hobbs, Tach, AFTT, FTT, route, fuel, landings, engine cycles. If two pilots close out a flight at the same time, the numbers still come out right.",
        where: "Log → Flight",
      },
      {
        icon: CheckSquare, accent: '#56B94A',
        name: "Ops Checks",
        blurb: "VOR check every 30 days per §91.171, oil burn trending across your engine hours, tire PSI. All three on one dashboard.",
        where: "Log → Ops Checks",
      },
    ],
  },
  {
    title: "Maintenance",
    subtitle: "Tracking, the shop visit, the signoff",
    cards: [
      {
        icon: Wrench, accent: '#F08B46',
        name: "Maintenance items",
        blurb: "Track by hours, by calendar, or whichever comes first. Start from an FAA inspection template or build your own list. You'll get an email before anything comes due.",
        where: "MX → Maintenance",
      },
      {
        icon: AlertTriangle, accent: '#CE3732',
        name: "Squawks",
        blurb: "Write up a squawk with photos. Mark it airworthiness-affecting and the airplane grounds — Howard, the summary, and the fleet view all show it. When the shop fixes it, the squawk links back to the service event that closed it.",
        where: "MX → Squawks",
      },
      {
        icon: ClipboardList, accent: '#0EA5E9',
        name: "Service events",
        blurb: "Bundle MX items and squawks into one trip to the shop. Your mechanic gets an email with a portal link — no account, no app. They propose dates, upload photos, comment, and sign off line by line. You confirm from the app. If a pilot had the airplane booked during that window, they get an email that says why.",
        where: "MX → Service",
      },
      {
        icon: ShieldAlert, accent: '#7C3AED',
        name: "Airworthiness Directives",
        blurb: "Every AD on the airplane with compliance status — overdue, due soon, or compliant. Skyward checks the FAA's DRS feed every night for new issues. Export a 91.417(b) log for your IA when it's time for the annual.",
        where: "MX → ADs",
      },
      {
        icon: Gauge, accent: '#F08B46',
        name: "Equipment list",
        blurb: "Every installed piece with make, model, serial, and the certification dates the FAA cares about. Transponder (§91.413), altimeter & pitot-static (§91.411), ELT (§91.207) — let one lapse and the airplane shows grounded.",
        where: "More → Equipment",
      },
    ],
  },
  {
    title: "Shared aircraft",
    subtitle: "Scheduling, shared notes, and who has access",
    cards: [
      {
        icon: Calendar, accent: '#56B94A',
        name: "Calendar",
        blurb: "Confirmed service dates block the calendar. If maintenance bumps a pilot off the airplane, they get an email that explains what moved and why. Howard can book a slot for you in chat.",
        where: "Calendar icon in nav",
      },
      {
        icon: MessageSquare, accent: '#525659',
        name: "Notes",
        blurb: "A message board that stays with the airplane — nothing scrolls off into a group text. Attach photos. The next pilot sees what's new before they fly.",
        where: "More → Notes",
      },
      {
        icon: Users, accent: '#091F3C',
        name: "Pilots & access",
        blurb: "Invite a pilot by email — they get a link, no app store. Grant access by aircraft. Promote to admin when they should own the numbers. Global admins see the whole fleet.",
        where: "Settings → cog → Users / Access",
      },
    ],
  },
  {
    title: "Howard + Tools",
    subtitle: "Howard, weather, documents, and your airworthiness check",
    cards: [
      {
        icon: MessageSquare, accent: '#e6651b',
        name: "Howard",
        blurb: "Orange button on every screen. Ask whether the airplane's airworthy, pull a briefing (METARs, TAFs, NOTAMs, PIREPs straight from NOAA and FAA), decode a METAR, look up an AD, search your own documents. When Howard wants to act — book a flight, close a squawk, schedule the shop — he shows you a card. You tap Confirm.",
        where: "Orange floating button, any screen",
      },
      {
        icon: CloudSun, accent: '#e6651b',
        name: "Flight briefing",
        blurb: "NOAA weather (METARs, TAFs, SIGMETs, AIRMETs, PIREPs) and FAA NOTAMs straight from the official feeds — nothing scraped, nothing stale. Howard reads the METAR in plain English and calls out what matters.",
        where: "Howard → Flight briefing",
      },
      {
        icon: FolderOpen, accent: '#7C3AED',
        name: "Documents",
        blurb: "Upload POH, AFM, MEL, SOPs, registration, W&B. Every file gets a fingerprint so you know it hasn't been swapped. Ask Howard 'What's the Vne?' and he reads your POH to answer.",
        where: "More → Documents",
      },
      {
        icon: ShieldCheck, accent: '#56B94A',
        name: "Airworthiness check",
        blurb: "Ask Howard if the airplane's airworthy. He checks §91.205, §91.411, §91.413, §91.207, and §91.417 against your equipment dates, MX items, open squawks, and AD compliance — then tells you whether you're good, and if not, which reg is in the way.",
        where: "Howard → 'Is my aircraft airworthy?'",
      },
      {
        icon: Settings, accent: '#091F3C',
        name: "Profile & ratings",
        blurb: "Howard talks to you the way you fly. A student gets more explanation; a CPL or CFI gets the short version. Set your certs once and the tone follows.",
        where: "Settings → cog",
      },
      {
        icon: Bell, accent: '#F08B46',
        name: "Notifications",
        blurb: "Emails as MX items come due — you pick the lead time (30, 15, 5 days or hours out). New squawks, new notes, and service-event updates also land in your inbox.",
        where: "Settings → cog → Notifications",
      },
      {
        icon: Smartphone, accent: '#091F3C',
        name: "Install as app",
        blurb: "Add Skyward to your home screen from the browser share menu. Full-screen, its own icon, no app store. Works on iPhone, Android, and desktop.",
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
                Every tool, grouped by what it's for
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
              Every tool in the app, grouped by what you're doing with it. Tap the orange button any time if you'd rather just ask me.
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
