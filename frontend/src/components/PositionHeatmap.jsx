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
  const exposure = live.reduce((acc, row) => {
    const pnl = Number(row.pnl) || 0;
    const key = row.isOpt === false ? "Futures" : String(row.side || "").toUpperCase() === "CE" ? "Calls" : String(row.side || "").toUpperCase() === "PE" ? "Puts" : "Other";
    acc[key] = (acc[key] || 0) + pnl;
    return acc;
  }, {});
  const exposureRows = ["Calls", "Puts", "Futures", "Other"].filter((key) => exposure[key] !== undefined);
  const exposureMax = Math.max(1, ...exposureRows.map((key) => Math.abs(exposure[key])));

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
      <div className={`mb-1.5 grid gap-1 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`} data-testid="position-exposure-summary" aria-label="Position P&L exposure by instrument">
        {exposureRows.map((key) => {
          const value = exposure[key];
          const ratio = Math.min(1, Math.abs(value) / exposureMax);
          const positive = value >= 0;
          return (
            <div key={key} className="rounded-md border border-slate-100 px-1.5 py-1 dark:border-slate-800" title={`${key} open P&L exposure`}>
              <div className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-wide text-slate-500">
                <span>{key}</span>
                <span className={positive ? "text-emerald-700" : "text-rose-700"}>{privacy ? "••••" : `${positive ? "+" : "-"}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="meter" aria-label={`${key} exposure intensity`} aria-valuemin="0" aria-valuemax="1" aria-valuenow={ratio.toFixed(2)}>
                <div className={`h-full rounded-full ${positive ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${Math.max(8, ratio * 100)}%` }} />
              </div>
            </div>
          );
        })}
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
              className={`rounded-lg border text-left transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-0.5 hover:shadow-md ${compact ? "px-1.5 py-1 min-h-[48px]" : "px-2 py-1.5 min-h-[56px]"} ${
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
