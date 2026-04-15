"use client";

import { authFetch } from "@/lib/authFetch";
import useSWR from "swr";
import { BarChart3, Coins, MessageSquare, Plane, ArrowRight } from "lucide-react";
import { HowardIcon } from "@/components/shell/TrayIcons";

interface UsageResponse {
  totals: {
    input: number;
    output: number;
    cache_read: number;
    cache_create: number;
    messages: number;
    cost_usd: number;
  };
  perDay: Array<{
    day: string;
    input: number;
    output: number;
    cache_read: number;
    cache_create: number;
    messages: number;
    cost_usd: number;
  }>;
  perAircraft: Array<{
    aircraft_id: string;
    tail_number: string;
    input: number;
    output: number;
    cache_read: number;
    cache_create: number;
    messages: number;
    cost_usd: number;
  }>;
  range_days: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(2);
}

/** Build a 30-day bar-chart series, filling in missing days with zero. */
function buildDaySeries(perDay: UsageResponse['perDay'], days: number) {
  const map = new Map(perDay.map(d => [d.day, d]));
  const out: { day: string; label: string; messages: number; cost_usd: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const item = map.get(key);
    out.push({
      day: key,
      label: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      messages: item?.messages ?? 0,
      cost_usd: item?.cost_usd ?? 0,
    });
  }
  return out;
}

export default function HowardUsageTab() {
  const { data, isLoading, error } = useSWR<UsageResponse>(
    'howard-usage',
    async () => {
      const res = await authFetch('/api/howard/usage');
      if (!res.ok) throw new Error('Failed to load usage');
      return await res.json();
    },
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-20 bg-white rounded-sm shadow-md animate-pulse" />
        <div className="h-40 bg-white rounded-sm shadow-md animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-cream shadow-lg rounded-sm p-6 text-center">
        <p className="text-sm text-gray-500">Unable to load usage data.</p>
      </div>
    );
  }

  const { totals, perAircraft, perDay } = data;
  const daySeries = buildDaySeries(perDay, 30);
  const maxMessages = Math.max(...daySeries.map(d => d.messages), 1);
  const isEmpty = totals.messages === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-full bg-[#0EA5E9]/10">
          <HowardIcon size={24} style={{ color: '#0EA5E9' }} />
        </div>
        <div>
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Howard Usage</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#0EA5E9]">Last 30 days</span>
        </div>
      </div>

      {/* Empty state — first-time users */}
      {isEmpty && (
        <div className="bg-cream shadow-lg rounded-sm p-6 border-t-4 border-[#0EA5E9] text-center">
          <HowardIcon size={40} style={{ color: '#0EA5E9' }} className="mx-auto mb-3" />
          <p className="font-oswald text-lg font-bold uppercase text-navy mb-1">No usage yet</p>
          <p className="text-xs text-gray-500 font-roboto mb-4 max-w-sm mx-auto">
            Start a conversation with Howard to see your token usage, daily activity, and estimated cost tracked here.
          </p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('aft:navigate-howard'))}
            className="inline-flex items-center gap-2 bg-[#0EA5E9] text-white font-oswald font-bold uppercase tracking-widest text-sm px-4 py-2 rounded-lg active:scale-95 transition-transform"
          >
            Go to Howard <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<MessageSquare size={14} />}
          label="Messages"
          value={totals.messages.toLocaleString()}
          color="#0EA5E9"
        />
        <StatCard
          icon={<BarChart3 size={14} />}
          label="Input tokens"
          value={formatTokens(totals.input + totals.cache_read + totals.cache_create)}
          sub={`${formatTokens(totals.cache_read)} cached`}
          color="#56B94A"
        />
        <StatCard
          icon={<BarChart3 size={14} />}
          label="Output tokens"
          value={formatTokens(totals.output)}
          color="#F08B46"
        />
        <StatCard
          icon={<Coins size={14} />}
          label="Est. cost"
          value={formatCost(totals.cost_usd)}
          color="#CE3732"
        />
      </div>

      {/* Daily bar chart */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#0EA5E9]">
        <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-4">Daily activity</h3>
        {totals.messages === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-8">No Howard conversations yet. Start chatting to see your usage here.</p>
        ) : (
          <div className="flex items-end gap-[2px] h-32">
            {daySeries.map(d => {
              const h = (d.messages / maxMessages) * 100;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className={`w-full rounded-t-sm transition-all ${d.messages > 0 ? 'bg-[#0EA5E9] hover:bg-[#0284C7]' : 'bg-gray-200'}`}
                    style={{ height: `${Math.max(h, d.messages > 0 ? 8 : 2)}%` }}
                    title={`${d.label}: ${d.messages} msg · ${formatCost(d.cost_usd)}`}
                  />
                </div>
              );
            })}
          </div>
        )}
        {totals.messages > 0 && (
          <div className="flex justify-between mt-2 text-[9px] font-bold uppercase tracking-widest text-gray-400">
            <span>{daySeries[0].label}</span>
            <span>{daySeries[daySeries.length - 1].label}</span>
          </div>
        )}
      </div>

      {/* Per-aircraft breakdown */}
      <div className="bg-cream shadow-lg rounded-sm p-4 md:p-6 border-t-4 border-[#56B94A]">
        <h3 className="font-oswald text-lg font-bold uppercase text-navy mb-4">Per aircraft</h3>
        {perAircraft.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-4">No data.</p>
        ) : (
          <div className="space-y-2">
            {perAircraft.map(a => (
              <div key={a.aircraft_id} className="flex items-center gap-3 p-3 bg-white rounded border border-gray-200">
                <Plane size={16} className="text-[#3AB0FF] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-oswald font-bold text-sm uppercase text-navy leading-none">{a.tail_number}</p>
                  <p className="text-[10px] text-gray-500 mt-1 font-bold uppercase tracking-widest">
                    {a.messages} msg · {formatTokens(a.input + a.cache_read + a.cache_create)} in · {formatTokens(a.output)} out
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-roboto font-bold text-sm text-navy">{formatCost(a.cost_usd)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footnote */}
      <p className="text-[10px] text-center text-gray-400 font-bold uppercase tracking-widest">
        Est. cost uses Claude Haiku 4.5 list pricing ($1 / $5 per MTok).
        Cache reads ($0.10/MTok) and writes ($1.25/MTok) counted separately.
      </p>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white shadow-md rounded-sm p-3 border-l-4" style={{ borderLeftColor: color }}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="font-oswald text-xl font-bold text-navy leading-none">{value}</p>
      {sub && <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-1">{sub}</p>}
    </div>
  );
}
