import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, TrendingUp, TrendingDown } from "lucide-react";

const STRIKE_COUNTS = [5, 10, 15, 20, 25];

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
}) {
  const price = current?.price ?? 0;
  return (
    <aside
      data-testid="sidebar"
      className="w-72 shrink-0 bg-white border-r border-slate-200 h-full flex flex-col"
    >
      {/* Index search / switcher */}
      <div className="p-4 border-b border-slate-200">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Index</Label>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {indices.map((idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={idx}
                data-testid={`btn-index-${idx}`}
                onClick={() => onChangeIndex(idx)}
                className={`text-sm font-medium rounded-sm py-2 border ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {idx}
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
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Expiry Included</Label>
        <div className="mt-2 space-y-1.5">
          <div className="expiry-row flex items-center gap-2 py-1 px-2 rounded-sm">
            <Checkbox id="exp-nearest" checked disabled data-testid="exp-nearest" />
            <label htmlFor="exp-nearest" className="text-sm text-slate-700 font-mono-data">
              {current?.expiry || "—"} <span className="text-xs text-slate-400">(nearest)</span>
            </label>
          </div>
          <p className="text-[11px] text-slate-400 italic pl-1">
            Multi-expiry support coming soon.
          </p>
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
            className={`text-xs px-2.5 py-1 rounded-sm border font-mono-data ${
              strikesAround === "all"
                ? "bg-slate-900 text-white border-slate-900"
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
              className={`text-xs px-2.5 py-1 rounded-sm border font-mono-data ${
                strikesAround === n
                  ? "bg-slate-900 text-white border-slate-900"
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
