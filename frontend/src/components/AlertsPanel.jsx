import { useMemo, useState } from "react";
import { Bell, X, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export default function AlertsPanel({
  alerts,
  onClear,
  activeIndex,
  showAll: showAllProp,
  canClear = true,
  /** When true, grow with content — parent (RightPanel) owns scrolling. */
  embed = false,
}) {
  const [localShowAll, setLocalShowAll] = useState(false);
  // If parent passes an activeIndex, filter to that index by default; the user
  // can flip a small toggle to view alerts for other indices too.
  const filterEnabled = !!activeIndex && !localShowAll && !showAllProp;
  const filtered = useMemo(() => {
    if (!filterEnabled) return alerts;
    return alerts.filter((a) => a.index === activeIndex);
  }, [alerts, filterEnabled, activeIndex]);

  const list = (
    <div className={`${embed ? "p-2" : "p-2"} space-y-2`}>
      {filtered.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-6">
          {filterEnabled ? `No alerts for ${activeIndex} yet.` : "No alerts yet."}
        </div>
      ) : (
        filtered.map((a) => {
          const bullish = a.direction?.toLowerCase().includes("bullish");
          return (
            <div
              key={a.created_at + a.index}
              data-testid="alert-item"
              className={`border rounded-sm p-2 ${
                bullish ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {bullish ? (
                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-rose-600" />
                  )}
                  <span>{a.index}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono-data">
                  {formatTime(a.created_at)}
                </span>
              </div>
              <div className="text-[11px] text-slate-700 mt-1">{a.direction}</div>
              <div className="text-[10px] text-slate-500 font-mono-data mt-1">
                Price {a.price?.toFixed?.(2)} · ATM {a.atm} · {a.strikes?.length ?? 0} strikes
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div
      className={`bg-white border border-slate-200 rounded-md ${
        embed ? "" : "h-full min-h-0 flex flex-col max-h-[70vh]"
      }`}
      data-testid="alerts-panel"
    >
      <div className="p-3 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold">Alerts</span>
          {filtered.length > 0 && (
            <span className="text-[10px] font-mono-data bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-sm">
              {filtered.length}
            </span>
          )}
          {activeIndex && (
            <span className="text-[10px] font-mono-data bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-sm">
              {filterEnabled ? activeIndex : "ALL"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeIndex && (
            <Button
              data-testid="btn-toggle-alerts-scope"
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2"
              onClick={() => setLocalShowAll((v) => !v)}
              title={filterEnabled ? "Show all indices" : `Show only ${activeIndex}`}
            >
              <Filter className="w-3 h-3 mr-1" />
              {filterEnabled ? "All" : activeIndex}
            </Button>
          )}
          {canClear && (
          <Button
            data-testid="btn-clear-alerts"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={onClear}
          >
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
          )}
        </div>
      </div>
      {embed ? list : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {list}
        </div>
      )}
    </div>
  );
}
