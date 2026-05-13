"use client";

import { useEffect } from "react";
import {
  X, Home, PenLine, Calendar, CalendarDays, Wrench, FolderOpen, MessageSquare, Settings,
  ShieldCheck, ShieldAlert, Plane, Users, Bell, Smartphone, BookOpen, CheckSquare,
  AlertTriangle, ClipboardList, Gauge, CloudSun, Send, Camera, BarChart3, Lock,
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
 * model — Hangar basics, Logging, Maintenance, Shared aircraft, Tools. Each card
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
    title: "Hangar basics",
    subtitle: "Your airplane and where it stands right now",
    cards: [
      {
        icon: Home, accent: '#091F3C',
        name: "Summary",
        blurb: "Status at a glance. Current Hobbs and Tach, fuel on board, what's coming due next, anything open in the squawk book — the airplane's whole picture on one screen. The header runs green, orange, or red so you know how the airplane is before you walk out to the ramp.",
        where: "Home icon in the nav",
      },
      {
        icon: Plane, accent: '#091F3C',
        name: "Hangar view",
        blurb: "Every airplane side-by-side when you've got more than one. Status colors at a glance, and a tap drops you straight into Summary for the one you're flying today.",
        where: "Tap Home again with 2+ aircraft to switch between Summary and Hangar",
      },
      {
        icon: CalendarDays, accent: '#56B94A',
        name: "Hangar Schedule",
        blurb: "Your whole fleet on one calendar — month, week, or day. Filter to the tails you actually fly. Tap any date and you drop right into that airplane's own calendar.",
        where: "Home → Schedule (with 2+ aircraft)",
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
        blurb: "Hobbs, Tach, AFTT, FTT, route, fuel, landings, engine cycles — everything that belongs on the line, in one place. Two pilots can close out a flight at the same time and the airplane's totals still come out right.",
        where: "Log → Flight",
      },
      {
        icon: CheckSquare, accent: '#56B94A',
        name: "Ops Checks",
        blurb: "VOR, oil, tires — the three pre-flight checks that keep you legal and catch a sick engine before it bites. Oil consumption trends right alongside your hours, the VOR clock counts down to the next 30-day check, and Howard speaks up the moment burn rate starts climbing.",
        where: "Log → Ops Checks",
      },
      {
        icon: Send, accent: '#3AB0FF',
        name: "Log It — ramp companion",
        blurb: "A lightweight companion app for the ramp. Flights, VOR, oil, tires, squawks — five quick logs, one tap from your phone's home screen. Works without signal too: entries hold their real timestamps and flush when you're back in range, so a late upload never fakes a fresh compliance clock.",
        where: "Log It button in the header",
      },
    ],
  },
  {
    title: "Maintenance",
    subtitle: "Tracking what's due, the trip to the shop, the signoff",
    cards: [
      {
        icon: Wrench, accent: '#F08B46',
        name: "Maintenance items",
        blurb: "Track everything that comes due — annual, 100-hour, oil change, transponder cert, prop overhaul — by hours, by calendar, or whichever hits first. Start from an FAA inspection template or build your own list. We'll email you ahead of time, with the lead times you pick.",
        where: "MX → Maintenance",
      },
      {
        icon: AlertTriangle, accent: '#CE3732',
        name: "Squawks",
        blurb: "Write up any discrepancy with photos. Mark it airworthiness-affecting and the airplane shows grounded — Summary, Hangar, and Howard all reflect it. Deferring under MEL, CDL, NEF, or MDL? Log the category and procedures so the deferral story stays with the squawk. When the shop signs it off, the fix links back to the service event that closed it.",
        where: "MX → Squawks",
      },
      {
        icon: ClipboardList, accent: '#0EA5E9',
        name: "Service events",
        blurb: "Bundle MX items and squawks into one trip to the shop. Your mechanic gets an email with a portal link — no account, no app to install. They propose dates, share photos, comment, and sign off line by line; you confirm from the app. If a pilot had the airplane booked during the maintenance window, they get a heads-up email explaining what moved and why.",
        where: "MX → Service",
      },
      {
        icon: ShieldAlert, accent: '#7C3AED',
        name: "Airworthiness Directives",
        blurb: "Every AD that applies to your airplane, with compliance status front and center — overdue, due soon, or compliant. We check the FAA's DRS feed nightly so a new issuance doesn't catch you cold. Export a 91.417(b) log for your IA when annual rolls around.",
        where: "MX → ADs",
      },
      {
        icon: Gauge, accent: '#F08B46',
        name: "Equipment list",
        blurb: "Every installed piece — make, model, serial — plus the certification dates the FAA actually cares about. Transponder, altimeter and pitot-static, ELT, all tracked against the regs that govern them (§91.413, §91.411, §91.207). Let one lapse and the airplane shows grounded before you walk out to fly it.",
        where: "More → Equipment",
      },
      {
        icon: Camera, accent: '#0EA5E9',
        name: "Logbook scan",
        blurb: "Snap a photo of a mechanic's logbook entry and Skyward reads it — completion date, engine time, signoff, and which work it covered. Use it to close out a service event, or to bring an old entry forward as a tracked item. You confirm the details before anything saves.",
        where: "MX → Maintenance (Track New Item or Complete Event)",
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
        blurb: "Book the airplane the way you actually fly — a single slot or a recurring weekly pattern on whatever weekdays fit. Confirmed service dates block the calendar so nobody books over a shop visit, and if a pilot gets bumped by maintenance, they get an email explaining what changed. Howard can book a slot for you right from chat.",
        where: "Calendar icon in nav",
      },
      {
        icon: MessageSquare, accent: '#525659',
        name: "Notes",
        blurb: "A message board that lives with the airplane — no group texts, no buried threads. Post a note, attach a photo, and the next pilot sees it before they walk out to fly.",
        where: "More → Notes",
      },
      {
        icon: Users, accent: '#091F3C',
        name: "Pilots & access",
        blurb: "Invite a pilot by email and they're flying in minutes — no app store, no signup hassle. Grant access aircraft-by-aircraft, promote to admin when someone should own the numbers, and global admins see the whole fleet.",
        where: "Settings → cog → Users / Access",
      },
      {
        icon: Plane, accent: '#525659',
        name: "Aircraft profile",
        blurb: "The airplane's vitals in one place — make, model, serial, year, home base, timezone, IFR-equipped or not. Two emails matter most: the primary contact who runs the airplane and the mechanic who works on it. Howard reads the IFR flag and the timezone so briefings and reminders match how you actually fly.",
        where: "Summary → Edit (or tail dropdown → Edit)",
      },
    ],
  },
  {
    title: "Howard + Tools",
    subtitle: "Your AI mentor, official weather, your documents, the airworthiness call",
    cards: [
      {
        icon: MessageSquare, accent: '#e6651b',
        name: "Howard",
        blurb: "Your seasoned hangar mentor, one tap away on every screen. Ask whether the airplane's airworthy. Pull a briefing for any route. Decode a METAR, look up an AD, search inside your own documents. When Howard's ready to take action — book a flight, close a squawk, send the airplane to the shop — he hands you a card to confirm before anything happens. Your chat history follows you to whatever device you sign in on next.",
        where: "Howard's button — bottom-right, every screen",
      },
      {
        icon: CloudSun, accent: '#e6651b',
        name: "Flight briefing",
        blurb: "Official weather (METARs, TAFs, SIGMETs, AIRMETs, PIREPs) and NOTAMs, straight from NOAA and the FAA — nothing scraped, nothing stale. Howard reads the report in plain English and calls out the parts that matter for your flight.",
        where: "Howard → Flight briefing",
      },
      {
        icon: FolderOpen, accent: '#7C3AED',
        name: "Documents",
        blurb: "Upload your POH, AFM, MEL, SOPs, registration, weight and balance — every file safely stored and instantly searchable. Ask Howard a question — \"what's the Vne?\" — and he reads your POH and cites the page back to you.",
        where: "More → Documents",
      },
      {
        icon: ShieldCheck, accent: '#56B94A',
        name: "Airworthiness check",
        blurb: "Ask Howard \"is my airplane airworthy?\" and he reads your equipment dates, MX items, open squawks, and AD compliance against the regs that matter — §91.205, §91.411, §91.413, §91.207, §91.417 — then tells you whether you're good to fly, or which reg is standing in the way.",
        where: "Howard → \"Is my aircraft airworthy?\"",
      },
      {
        icon: Settings, accent: '#091F3C',
        name: "Profile & ratings",
        blurb: "Howard talks to you the way you fly. Student pilot? He explains more, gives the long version. CPL or CFI? You get the short, direct read. Set your certs and ratings once and the tone follows you everywhere.",
        where: "Settings → cog",
      },
      {
        icon: Bell, accent: '#F08B46',
        name: "Notifications",
        blurb: "Email reminders before MX items come due — you pick the lead times (30, 15, 5 days or hours out). New squawks, fresh notes, and reservation changes all land in your inbox too, and each kind toggles on or off on its own.",
        where: "Settings → cog → Notifications",
      },
      {
        icon: BarChart3, accent: '#0EA5E9',
        name: "Howard Usage",
        blurb: "Howard runs on a real model with real cost. The Usage tab shows your message count, the tokens in and out, and a running cost estimate — with daily activity bars so you can see when you've leaned on him most.",
        where: "Howard tab → Usage",
      },
      {
        icon: Lock, accent: '#525659',
        name: "Account",
        blurb: "Change your password by email, or close out your account entirely. Deleting walks you through exactly what leaves with you — aircraft you own, your access on shared aircraft, the rest of your data — and you type DELETE before any of it actually happens.",
        where: "Settings → cog",
      },
      {
        icon: Smartphone, accent: '#091F3C',
        name: "Install as app",
        blurb: "Add Skyward to your home screen from your browser's share menu — full-screen, its own icon, no app store. Works on iPhone, Android, and desktop, sitting right next to everything else you fly with.",
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
        className="bg-cream w-full md:max-w-2xl rounded-t-2xl md:rounded-xl shadow-2xl border-t-4 border-brandOrange flex flex-col max-h-[92vh] md:max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — Howard-branded so the guide feels like his reference
            shelf, not a generic help modal. */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full overflow-hidden border border-brandOrange/30 shrink-0">
              <img src={HOWARD_LOGO_PATH} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <div className="min-w-0">
              <h2 className="font-oswald text-xl md:text-2xl font-bold uppercase text-navy leading-none">
                Features Guide
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-brandOrange mt-1">
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
        <div className="px-4 py-3 border-b border-brandOrange/10 bg-brandOrange/5 shrink-0">
          <p className="font-roboto text-sm text-navy leading-snug">
            <span className="font-bold">Here's the whole hangar.</span>{' '}
            <span className="text-gray-600">
              Every tool in the app, grouped by how you'll use it. Prefer to talk it out? Tap my button — bottom-right of every screen — any time.
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
                <p className="text-[11px] font-roboto text-gray-500 mt-1">
                  {section.subtitle}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {section.cards.map(card => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.name}
                      className="bg-white rounded-lg p-3.5 border border-gray-200 shadow-sm hover:border-brandOrange/40 transition-colors flex flex-col gap-2"
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
            <p className="text-[11px] font-roboto text-gray-400">
              Anything unclear? Tap Howard — bottom-right — and ask.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
