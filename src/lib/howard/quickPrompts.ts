import {
  Shield, Wrench, CalendarPlus, Activity,
  type LucideIcon,
} from 'lucide-react';

export interface FollowUp {
  label: string;
  prompt: string;
}

export interface QuickPrompt {
  icon: LucideIcon;
  label: string;
  prompt: string;
  followUps?: FollowUp[];
  /** 'aircraft' means the prompt needs a tail before Howard can answer;
   * HowardTab renders an aircraft picker until Howard calls a tool. */
  kind?: 'aircraft';
}

/**
 * Canonical Howard quick-prompt menu. Shared by:
 * - The floating launcher popup (initial menu + re-open)
 * - The HowardTab aircraft-switch panel (when the pilot changes tail
 *   mid-conversation and Howard offers the same angles for the new
 *   aircraft).
 * Keep this list tight — it's the pilot's shortcut surface, not a
 * catalog of everything Howard can do.
 */
export const HOWARD_QUICK_PROMPTS: QuickPrompt[] = [
  {
    icon: Shield,
    label: 'Airworthiness check',
    kind: 'aircraft',
    prompt: `Is my aircraft airworthy right now? Walk me through it.`,
    followUps: [
      { label: 'Blockers vs warnings', prompt: 'Which of those are blockers and which are just warnings?' },
      { label: 'How to clear each', prompt: 'What does it take to clear each finding?' },
      { label: 'Regulatory basis', prompt: 'What regs back up those findings?' },
    ],
  },
  {
    icon: Wrench,
    label: 'Maintenance overview',
    kind: 'aircraft',
    prompt: `Give me the maintenance picture: anything overdue or due now, upcoming inspections in the next 30–90 days, open squawks, and any ADs to act on. Order by urgency.`,
    followUps: [
      { label: 'Required vs optional', prompt: 'Split those by required vs optional so I know what I can defer.' },
      { label: 'Bundle for one visit', prompt: "Help me group these into a single shop visit to minimize downtime." },
      { label: "What's grounding me", prompt: 'Which of those actually affect airworthiness right now?' },
      { label: 'Open squawks detail', prompt: 'Dig into the open squawks — causes and what it takes to clear them.' },
      { label: 'AD detail', prompt: 'More on the ADs — overdue, due soon, and what each requires.' },
    ],
  },
  {
    icon: CalendarPlus,
    label: 'Book some time',
    kind: 'aircraft',
    prompt: `I'd like to book some time. Ask me for the details you need.`,
  },
  {
    icon: Activity,
    label: 'Recent activity',
    kind: 'aircraft',
    prompt: `What's been happening the last 30 days — flights, squawks, MX work?`,
    followUps: [
      { label: "Who's flying it", prompt: "Who's been flying it? Any patterns?" },
      { label: 'Fuel burn trends', prompt: "How's the fuel burn looking across those flights?" },
      { label: 'Anything unusual', prompt: 'Anything unusual in the last month I should know about?' },
    ],
  },
];

/** Client stale-session threshold. If Howard's most recent message is
 * older than this when the user comes back, the thread gets wiped so
 * the pilot starts fresh instead of picking up a stale conversation. */
export const HOWARD_STALE_MS = 30 * 60 * 1000;
