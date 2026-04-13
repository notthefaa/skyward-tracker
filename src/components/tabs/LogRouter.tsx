import dynamic from "next/dynamic";
import type { AircraftWithMetrics, LogSubTab } from "@/lib/types";
import { TabSkeleton } from "@/components/Skeletons";

const TimesTab = dynamic(() => import("@/components/tabs/TimesTab"), { loading: () => <TabSkeleton /> });
const VorTab = dynamic(() => import("@/components/tabs/VorTab"), { loading: () => <TabSkeleton /> });
const TireTab = dynamic(() => import("@/components/tabs/TireTab"), { loading: () => <TabSkeleton /> });
const OilTab = dynamic(() => import("@/components/tabs/OilTab"), { loading: () => <TabSkeleton /> });

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
    case 'vor':
      return <VorTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} />;
    case 'tire':
      return <TireTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} />;
    case 'oil':
      return <OilTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} />;
    default:
      return <TimesTab aircraft={aircraft} session={session} role={role} userInitials={userInitials} onUpdate={onUpdate} />;
  }
}
