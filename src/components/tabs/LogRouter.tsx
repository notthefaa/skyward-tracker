import dynamic from "next/dynamic";
import type { AircraftWithMetrics, LogSubTab } from "@/lib/types";
import { TabSkeleton } from "@/components/Skeletons";

const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"), { loading: () => <TabSkeleton /> });
const ChecksTab = dynamic(() => import("@/components/tabs/ChecksTab"), { loading: () => <TabSkeleton /> });

interface LogRouterProps {
  logSubTab: LogSubTab;
  aircraft: AircraftWithMetrics | null;
  session: any;
  role: string;
  userInitials: string;
  onUpdate: () => void;
}

export default function LogRouter({ logSubTab, aircraft, session, role, userInitials, onUpdate }: LogRouterProps) {
  switch (logSubTab) {
    case 'flights':
      return <TimesTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} onUpdate={onUpdate} />;
    case 'checks':
      return <ChecksTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} />;
    default:
      return <TimesTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} onUpdate={onUpdate} />;
  }
}
