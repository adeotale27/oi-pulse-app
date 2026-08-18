import { Radio, TrendingUp, TrendingDown, Building2, Flame, ConstructionIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import PageBrandTitle from "@/components/PageBrandTitle";

function relTime(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function icon(type) {
  switch (type) {
    case "huge-shift": return <Flame className="w-3.5 h-3.5 text-rose-600" />;
    case "gamma-wall": return <ConstructionIcon className="w-3.5 h-3.5 text-purple-600" />;
    case "institution": return <Building2 className="w-3.5 h-3.5 text-sky-600" />;
    case "velocity": return <Flame className="w-3.5 h-3.5 text-amber-600" />;
    case "reversal-bullish": return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
    case "reversal-bearish": return <TrendingDown className="w-3.5 h-3.5 text-rose-600" />;
    default: return <Radio className="w-3.5 h-3.5 text-slate-500" />;
  }
}

function fmt(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

export default function ActivityFeed({ events, onClear, activeIndex, filter, onSetFilter }) {
  const list = (events || []).filter((e) => !filter || filter === "all" || e.type === filter);
  return (
    <div className="bg-white border border-slate-200 rounded-md" data-testid="activity-feed">
      <div className="p-3 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <PageBrandTitle title="Unusual Activity" testId="activity-page-title" />
          {activeIndex && (
            <span className="text-[10px] font-mono-data bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-sm">{activeIndex}</span>
          )}
          <span className="text-[10px] font-mono-data bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-sm">{list.length}</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { key: "all", label: "All" },
            { key: "huge-shift", label: "🔥 Shift" },
            { key: "gamma-wall", label: "🚧 Wall" },
            { key: "institution", label: "🏦 Inst" },
            { key: "velocity", label: "⚡ Vel" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => onSetFilter?.(f.key)}
              className={`px-2 py-0.5 rounded-sm text-[10px] border ${
                (filter || "all") === f.key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`activity-filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClear} data-testid="btn-clear-activity">Clear</Button>
        </div>
      </div>
      <ScrollArea className="max-h-[520px]">
        <div className="p-2 space-y-1.5">
          {list.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-6">No unusual activity yet.</div>
          ) : (
            list.map((e) => (
              <div
                key={e.id}
                data-testid="activity-item"
                className="flex items-start gap-2 rounded-sm border border-slate-100 hover:border-slate-200 bg-white p-2"
              >
                <div className="pt-0.5">{icon(e.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold text-slate-900">{e.index}</span>
                    {e.strike && <span className="font-mono-data text-slate-700">{e.strike}</span>}
                    {e.side && <span className={`font-semibold ${e.side === "CE" ? "text-rose-600" : "text-emerald-600"}`}>{e.side}</span>}
                    <span className="ml-auto text-[10px] text-slate-400 font-mono-data">{relTime(e.at)}</span>
                  </div>
                  <div className="text-[11px] text-slate-700 mt-0.5 leading-snug">{e.message}</div>
                  {e.value != null && (
                    <div className="text-[10px] text-slate-500 font-mono-data mt-0.5">ΔOI {fmt(e.value)}{e.window ? ` · in ${e.window}m` : ""}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
