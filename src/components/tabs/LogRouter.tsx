"use client";

import dynamic from "next/dynamic";
import type { AircraftWithMetrics, LogSubTab } from "@/lib/types";
import { TabSkeleton } from "@/components/Skeletons";
import { PenLine, CheckSquare } from "lucide-react";
import SectionSelector from "@/components/shell/SectionSelector";

const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"), { loading: () => <TabSkeleton /> });
const ChecksTab = dynamic(() => import("@/components/tabs/ChecksTab"), { loading: () => <TabSkeleton /> });

/** Unified top-selector for the Log section — mirrors the MX selector
 * shape so both sections feel cut from the same cloth. Keys match the
 * LogSubTab union so there's no mapping layer. */
const LOG_SELECTOR_ITEMS = [
  { key: 'flights', label: 'Flight', icon: PenLine, color: '#3AB0FF' },
  { key: 'checks',  label: 'Ops Checks', icon: CheckSquare, color: '#3AB0FF' },
];

interface LogRouterProps {
  logSubTab: LogSubTab;
  setLogSubTab: (sub: LogSubTab) => void;
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
  userInitials: string;
  onUpdate: () => void;
}

export default function LogRouter({ logSubTab, setLogSubTab, aircraft, session, role, userInitials, onUpdate }: LogRouterProps) {
  return (
    <div className="flex flex-col">
      <SectionSelector
        items={LOG_SELECTOR_ITEMS}
        selectedKey={logSubTab}
        onSelect={(key) => setLogSubTab(key as LogSubTab)}
        compact
      />
      {logSubTab === 'checks'
        ? <ChecksTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} />
        : <TimesTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} onUpdate={onUpdate} />}
    </div>
  );
}
