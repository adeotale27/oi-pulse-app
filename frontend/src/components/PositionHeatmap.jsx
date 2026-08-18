import { heatmapLabel, openHeatmapRows } from "@/lib/positionHeatmap";

export default function PositionHeatmap({
  rows = [],
  privacy = false,
  onSelect,
  compact = false,
  activeIndex = null,
}) {
  const live = openHeatmapRows(rows, activeIndex);
  if (!live.length) return null;

  const mag = Math.max(1, ...live.map((r) => Math.abs(Number(r.pnl) || 0)));

  return (
    <div data-testid="position-heatmap" className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${compact ? "p-1.5 h-full" : "p-2.5"}`}>
      <div className="flex items-center justify-between mb-1 px-0.5 gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-700 font-semibold">
          Position heatmap{activeIndex ? ` · ${activeIndex}` : ""}
        </span>
        {!compact && (
          <span className="text-[10px] text-slate-500 shrink-0">Open book · tap to jump</span>
        )}
      </div>
      <div className={`grid gap-1 ${compact ? "grid-cols-3 sm:grid-cols-4 max-h-[7.5rem] overflow-y-auto" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-1.5"}`}>
        {live.map((r) => {
          const pnl = Number(r.pnl) || 0;
          const t = Math.min(1, Math.abs(pnl) / mag);
          const bg = pnl >= 0
            ? `rgba(22, 163, 74, ${0.22 + t * 0.55})`
            : `rgba(220, 38, 38, ${0.18 + t * 0.52})`;
          const qty = Number(r.quantity);
          const qtyTxt = Number.isFinite(qty) && qty !== 0
            ? `${qty > 0 ? "+" : ""}${qty}`
            : (r.product || "");
          const label = heatmapLabel(r);
          return (
            <button
              key={`${r.exchange}-${r.product}-${r.tradingsymbol}`}
              type="button"
              data-testid="heatmap-cell"
              onClick={() => onSelect?.(r.tradingsymbol)}
              className={`rounded-lg border text-left ${compact ? "px-1.5 py-1 min-h-[48px]" : "px-2 py-1.5 min-h-[56px]"} ${
                pnl >= 0 ? "border-emerald-400/80" : "border-rose-400/80"
              }`}
              style={{ background: bg }}
              title={r.display_name || r.tradingsymbol}
            >
              <div className={`font-semibold text-slate-900 leading-tight ${compact ? "text-[11px]" : "text-[12px]"}`}>
                {label}
              </div>
              <div className={`font-mono-data font-bold tabular-nums ${compact ? "text-[12px]" : "text-[13px]"} ${pnl >= 0 ? "text-emerald-800" : "text-rose-800"}`}>
                {privacy ? "••••" : `${pnl >= 0 ? "+" : ""}₹${Math.round(pnl).toLocaleString("en-IN")}`}
              </div>
              {!compact && qtyTxt ? (
                <div className="text-[10px] text-slate-600 font-mono-data">{qtyTxt}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
