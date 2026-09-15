import { Check, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function chipClass(kind) {
  if (kind === "hedged") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (kind === "unhedged") return "bg-rose-50 text-rose-800 border-rose-200";
  return "bg-amber-50 text-amber-900 border-amber-200";
}

function GroupMark({ kind }) {
  if (kind === "hedged") return <Check className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden />;
  if (kind === "unhedged") return <span className="text-[10px] shrink-0" aria-hidden>🔴</span>;
  return <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" aria-hidden />;
}

export default function PositionsHedgeStatus({ hedge }) {
  if (!hedge || hedge.overallKind === "none") return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`text-[10px] font-mono-data px-1.5 py-0.5 rounded-sm border inline-flex items-center gap-0.5 max-w-full ${chipClass(hedge.overallKind)}`}
          data-testid="positions-hedge-summary"
          title="Open option hedge: BUY vs SELL lots per underlying and CE/PE"
        >
          {hedge.overallKind === "hedged" ? (
            <Check className="w-3 h-3 shrink-0" aria-hidden />
          ) : hedge.overallKind === "unhedged" ? (
            <span aria-hidden>🔴</span>
          ) : (
            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
          )}
          <span className="truncate">{hedge.overallLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)] p-0" data-testid="positions-hedge-breakdown">
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="text-xs font-semibold text-slate-900">Hedge status</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Open options. Extra shorts vs extra longs per CE/PE — overnight leftover to flatten.
          </div>
        </div>
        <div className="px-3 py-2 max-h-72 overflow-y-auto space-y-2">
          {hedge.byUnderlying.map((bag) => (
            <div key={bag.underlying} data-testid="hedge-underlying" data-underlying={bag.underlying}>
              <div className="text-[10px] font-semibold text-slate-700 tracking-wide">{bag.underlying}</div>
              <ul className="mt-0.5 space-y-0.5">
                {bag.groups.map((g) => (
                  <li
                    key={`${g.underlying}-${g.optionType}`}
                    className="flex items-center gap-1.5 text-[11px] text-slate-800"
                    data-testid="hedge-group"
                    data-kind={g.kind}
                    data-side={g.optionType}
                    data-underlying={g.underlying}
                  >
                    <span className="w-6 font-mono-data text-slate-500">{g.optionType}</span>
                    <GroupMark kind={g.kind} />
                    <span className="min-w-0 truncate">{g.shortLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
