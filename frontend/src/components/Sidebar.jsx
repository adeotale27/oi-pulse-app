import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, TrendingUp, TrendingDown } from "lucide-react";

const STRIKE_COUNTS = [2, 5, 10, 15, 20, 25];

const INDEX_THEME = {
  NIFTY: {
    label: "NIFTY",
    activeCls:   "bg-gradient-to-br from-sky-500 to-indigo-600 text-white border-transparent shadow-lg shadow-indigo-500/25 ring-2 ring-sky-300/60",
    idleCls:     "bg-gradient-to-br from-sky-50 to-indigo-50 text-indigo-800 border-indigo-100 hover:from-sky-100 hover:to-indigo-100",
    dot:         "bg-sky-500",
  },
  SENSEX: {
    label: "SENSEX",
    activeCls:   "bg-gradient-to-br from-amber-500 to-orange-600 text-white border-transparent shadow-lg shadow-orange-500/25 ring-2 ring-amber-300/60",
    idleCls:     "bg-gradient-to-br from-amber-50 to-orange-50 text-orange-800 border-orange-100 hover:from-amber-100 hover:to-orange-100",
    dot:         "bg-amber-500",
  },
  BANKNIFTY: {
    label: "BANK",
    activeCls:   "bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-transparent shadow-lg shadow-teal-500/25 ring-2 ring-emerald-300/60",
    idleCls:     "bg-gradient-to-br from-emerald-50 to-teal-50 text-teal-800 border-teal-100 hover:from-emerald-100 hover:to-teal-100",
    dot:         "bg-emerald-500",
  },
};

export default function Sidebar({
  indices,
  activeIndex,
  onChangeIndex,
  current,
  strikesAround,
  onChangeStrikesAround,
  strikeRange,
  onChangeStrikeRange,
  onReset,
  expiries,
  selectedExpiry,
  onChangeExpiry,
}) {
  const price = current?.price ?? 0;
  return (
    <aside
      data-testid="sidebar"
      className="w-72 shrink-0 bg-white border-r border-slate-200 h-full flex flex-col overflow-y-auto"
    >
      {/* Index search / switcher */}
      <div className="p-4 border-b border-slate-200">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Index</Label>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {indices.map((idx) => {
            const active = idx === activeIndex;
            const theme = INDEX_THEME[idx] || INDEX_THEME.NIFTY;
            return (
              <button
                key={idx}
                data-testid={`btn-index-${idx}`}
                onClick={() => onChangeIndex(idx)}
                className={`relative text-xs font-semibold rounded-md py-2 border transition-all ${
                  active ? theme.activeCls : theme.idleCls
                }`}
              >
                <span className={`absolute top-1 left-1.5 w-1.5 h-1.5 rounded-full ${theme.dot} ${active ? "opacity-100" : "opacity-70"}`} />
                {theme.label}
              </button>
            );
          })}
        </div>

        {current && (
          <div className="mt-3 flex items-center justify-between font-mono-data">
            <span className="text-sm font-semibold">
              {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              ATM {current.atm}
              {price >= current.atm ? (
                <TrendingUp className="w-3 h-3 text-emerald-600" />
              ) : (
                <TrendingDown className="w-3 h-3 text-rose-600" />
              )}
            </span>
          </div>
        )}
      </div>

      {/* Expiry */}
      <div className="p-4 border-b border-slate-200">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Expiries Included</Label>
        <div
          className="mt-2 space-y-1 pr-1 overflow-y-auto sidebar-expiries"
          style={{ maxHeight: "168px" }}
          data-testid="expiries-list"
        >
          {(expiries || []).map((exp, i) => {
            const active = selectedExpiry ? selectedExpiry === exp : i === 0;
            return (
              <button
                key={exp + i}
                data-testid={`expiry-${exp}`}
                onClick={() => onChangeExpiry?.(exp)}
                className={`w-full expiry-row flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
                  active
                    ? "bg-gradient-to-r from-indigo-600 to-sky-600 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`w-3 h-3 rounded-sm border ${active ? "bg-white border-white" : "border-slate-400"}`} />
                <span className="text-sm font-mono-data">{exp}</span>
                {i === 0 && (
                  <span className={`text-[9px] uppercase ml-auto ${active ? "text-white/80" : "text-slate-400"}`}>
                    nearest
                  </span>
                )}
              </button>
            );
          })}
          {(!expiries || expiries.length === 0) && (
            <p className="text-[11px] text-slate-400 italic pl-1">Loading expiries…</p>
          )}
        </div>
      </div>

      {/* Strike range */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-widest text-slate-500">Strike Range</Label>
          <button
            data-testid="btn-reset-range"
            onClick={onReset}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Min</div>
            <Input
              data-testid="input-strike-min"
              type="number"
              value={strikeRange.min ?? ""}
              onChange={(e) => onChangeStrikeRange({ ...strikeRange, min: Number(e.target.value) })}
              className="h-8 rounded-sm font-mono-data text-sm"
            />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Max</div>
            <Input
              data-testid="input-strike-max"
              type="number"
              value={strikeRange.max ?? ""}
              onChange={(e) => onChangeStrikeRange({ ...strikeRange, max: Number(e.target.value) })}
              className="h-8 rounded-sm font-mono-data text-sm"
            />
          </div>
        </div>
      </div>

      {/* Strikes around ATM */}
      <div className="p-4">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">
          Strikes above and below ATM
        </Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            data-testid="strikes-all"
            onClick={() => onChangeStrikesAround("all")}
            className={`text-xs px-2.5 py-1 rounded-md border font-mono-data transition-colors ${
              strikesAround === "all"
                ? "bg-gradient-to-br from-slate-800 to-slate-900 text-white border-transparent shadow"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            Show All
          </button>
          {STRIKE_COUNTS.map((n) => (
            <button
              key={n}
              data-testid={`strikes-${n}`}
              onClick={() => onChangeStrikesAround(n)}
              className={`text-xs px-2.5 py-1 rounded-md border font-mono-data transition-colors ${
                strikesAround === n
                  ? "bg-gradient-to-br from-slate-800 to-slate-900 text-white border-transparent shadow"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
