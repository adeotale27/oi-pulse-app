export default function PositionHeatmap({ rows = [], privacy = false, onSelect, compact = false }) {
  const open = (rows || []).filter((r) => !r.exited);
  if (!open.length) return null;

  const mag = Math.max(1, ...open.map((r) => Math.abs(Number(r.pnl) || 0)));

  return (
    <div data-testid="position-heatmap" className={`rounded-md border border-slate-200 bg-slate-50/60 ${compact ? "p-1.5 h-full" : "p-2"}`}>
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Position heatmap</span>
        {!compact && <span className="text-[10px] text-slate-400">Color = P&amp;L · tap to jump</span>}
      </div>
      <div className={`grid gap-1 ${compact ? "grid-cols-3 sm:grid-cols-4 max-h-[7.5rem] overflow-y-auto" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-1.5"}`}>
        {open.map((r) => {
          const pnl = Number(r.pnl) || 0;
          const t = Math.min(1, Math.abs(pnl) / mag);
          const bg = pnl >= 0
            ? `rgba(16, 185, 129, ${0.12 + t * 0.55})`
            : `rgba(244, 63, 94, ${0.12 + t * 0.55})`;
          const dist = r.distancePct != null
            ? r.distancePct
            : (r.spotUsed && r.strike
              ? ((r.strike - r.spotUsed) / r.spotUsed) * 100
              : null);
          return (
            <button
              key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
              type="button"
              data-testid="heatmap-cell"
              onClick={() => onSelect?.(r.tradingsymbol)}
              className={`rounded-md border text-left ${compact ? "px-1.5 py-1 min-h-[44px]" : "px-2 py-1.5 min-h-[52px]"} ${
                r.breachedAdjust ? "border-rose-400 ring-1 ring-rose-300" : "border-white/80"
              }`}
              style={{ background: bg }}
              title={r.display_name || r.tradingsymbol}
            >
              <div className={`font-semibold text-slate-800 truncate ${compact ? "text-[9px]" : "text-[10px]"}`}>
                {r.display_name || r.tradingsymbol}
              </div>
              <div className={`font-mono-data font-bold ${compact ? "text-[11px]" : "text-[12px]"} ${pnl >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                {privacy ? "••••" : `${pnl >= 0 ? "+" : ""}₹${Math.round(pnl).toLocaleString("en-IN")}`}
              </div>
              {!compact && (
                <div className="text-[9px] text-slate-600">
                  {r.breachedAdjust ? "Too close" : dist != null ? `${dist >= 0 ? "+" : ""}${Number(dist).toFixed(1)}% ATM` : r.product}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
