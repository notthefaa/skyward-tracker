"use client";

/** Pulsing placeholder bar */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

/** Skeleton that mirrors the SummaryTab hero + info cards layout */
export function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Hero image area */}
      <div className="bg-white shadow-lg rounded-sm overflow-hidden">
        <div className="h-40 md:h-56 bg-gray-200 animate-pulse" />
        <div className="bg-cream px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-gray-200 pb-3">
            <div className="flex items-center gap-3">
              <Bar className="w-5 h-5 rounded-full" />
              <div><Bar className="w-20 h-2 mb-1" /><Bar className="w-32 h-3" /></div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bar className="w-5 h-5 rounded-full" />
              <div><Bar className="w-16 h-2 mb-1" /><Bar className="w-24 h-3" /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Status / current activity card */}
      <div className="bg-white shadow rounded-sm p-4">
        <Bar className="w-28 h-2 mb-3" />
        <Bar className="w-full h-10" />
      </div>

      {/* Times card */}
      <div className="bg-white shadow rounded-sm p-4">
        <Bar className="w-20 h-2 mb-3" />
        <div className="grid grid-cols-3 gap-4">
          <div><Bar className="w-12 h-2 mb-2" /><Bar className="w-16 h-5" /></div>
          <div><Bar className="w-12 h-2 mb-2" /><Bar className="w-16 h-5" /></div>
          <div><Bar className="w-12 h-2 mb-2" /><Bar className="w-16 h-5" /></div>
        </div>
      </div>

      {/* MX + Squawks row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white shadow rounded-sm p-4">
          <Bar className="w-24 h-2 mb-3" /><Bar className="w-full h-8" />
        </div>
        <div className="bg-white shadow rounded-sm p-4">
          <Bar className="w-20 h-2 mb-3" /><Bar className="w-full h-8" />
        </div>
      </div>

      {/* Reservations card */}
      <div className="bg-white shadow rounded-sm p-4">
        <Bar className="w-28 h-2 mb-3" />
        <Bar className="w-full h-12 mb-2" />
        <Bar className="w-full h-12" />
      </div>
    </div>
  );
}

/** Skeleton that mirrors the FleetSummary grid layout */
export function FleetSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="bg-navy p-6 rounded-sm shadow-lg border-t-4 border-[#F5B05B]">
        <Bar className="w-48 h-8 mb-2 !bg-white/10" />
        <Bar className="w-32 h-3 !bg-white/10" />
      </div>
      {/* Grid cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-white shadow-md rounded-sm border-t-4 border-gray-200 overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-4">
                <Bar className="w-12 h-12 rounded-full" />
                <div><Bar className="w-20 h-5 mb-1" /><Bar className="w-28 h-2" /></div>
              </div>
              <Bar className="w-16 h-5 rounded" />
            </div>
            <div className="p-4 grid grid-cols-3 gap-4">
              <div><Bar className="w-10 h-2 mb-2" /><Bar className="w-14 h-5" /></div>
              <div><Bar className="w-10 h-2 mb-2" /><Bar className="w-14 h-5" /></div>
              <div><Bar className="w-10 h-2 mb-2" /><Bar className="w-14 h-5" /></div>
            </div>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
              <Bar className="w-32 h-3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic tab skeleton — simple card placeholders */
export function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white shadow rounded-sm p-4"><Bar className="w-32 h-4 mb-3" /><Bar className="w-full h-24" /></div>
      <div className="bg-white shadow rounded-sm p-4"><Bar className="w-24 h-4 mb-3" /><Bar className="w-full h-16" /></div>
      <div className="bg-white shadow rounded-sm p-4"><Bar className="w-28 h-4 mb-3" /><Bar className="w-full h-16" /></div>
    </div>
  );
}
