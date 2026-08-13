import React from "react";

export default function OIPulledBadge({ lastPulledAt, isMarketOpen, nowIso, onClick }) {
  const pulledTime = lastPulledAt ? new Date(lastPulledAt).toLocaleTimeString() : "—";
  const liveTime = nowIso ? new Date(nowIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : "—";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="oi-pulled-badge"
      className={`w-full rounded-sm border px-2.5 py-1.5 text-left transition-colors hover:brightness-95 bg-transparent border-slate-200 dark:border-slate-700`}
      title={`Last OI pull: ${pulledTime}`}
    >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest opacity-90 text-slate-700 dark:text-slate-300 hidden" data-live-as-of="kept-hidden">
          <div className="flex items-center gap-2">
            <span className="text-[11px]">Live data as of</span>
          </div>
          <div className="text-sm font-mono-data font-semibold text-slate-900 dark:text-slate-100">{pulledTime}</div>
        </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isMarketOpen ? "bg-emerald-500" : "bg-slate-300"}`} />
          <div className="text-[10px] text-slate-500 dark:text-slate-400">{isMarketOpen ? "LIVE" : ""}</div>
        </div>
        <div className="text-sm font-semibold font-mono-data text-slate-900 dark:text-slate-100">{isMarketOpen ? <strong>{liveTime}</strong> : liveTime}</div>
      </div>
    </button>
  );
}
