import { Bell, X, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export default function AlertsPanel({ alerts, onClear }) {
  return (
    <div className="bg-white border border-slate-200 rounded-md h-full flex flex-col" data-testid="alerts-panel">
      <div className="p-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold">Alerts</span>
          {alerts.length > 0 && (
            <span className="text-[10px] font-mono-data bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-sm">
              {alerts.length}
            </span>
          )}
        </div>
        <Button
          data-testid="btn-clear-alerts"
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={onClear}
        >
          <X className="w-3 h-3 mr-1" /> Clear
        </Button>
      </div>
      <ScrollArea className="flex-1 max-h-[420px]">
        <div className="p-2 space-y-2">
          {alerts.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-6">No alerts yet.</div>
          ) : (
            alerts.map((a, i) => {
              const bullish = a.direction?.toLowerCase().includes("bullish");
              return (
                <div
                  key={i}
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
      </ScrollArea>
    </div>
  );
}
