import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, TrendingUp, TrendingDown, Plus, Minus } from "lucide-react";

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
    idleCls:     "bg-gradient-to-br from-emerald-50 to-teal-50 text-teal-800 border-teal-100 hover:from-emerald-100 hover:to-emerald-100",
    dot:         "bg-emerald-500",
  },
};

/**
 * Strike-range step size per index (as per user requirement):
 *   • NIFTY: 50 pts per ± click
 *   • SENSEX / BANKNIFTY: 100 pts per ± click
 */
const STRIKE_STEP = {
  NIFTY: 50,
  SENSEX: 100,
  BANKNIFTY: 100,
};

function StepperInput({ testId, value, step, onChange }) {
  const dec = () => onChange(Math.max(0, (Number(value) || 0) - step));
  const inc = () => onChange((Number(value) || 0) + step);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid={`${testId}-dec`}
        onClick={dec}
        className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-95 shrink-0"
        aria-label="Decrement"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <Input
        data-testid={testId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value ?? ""}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, "");
          onChange(digits === "" ? "" : Number(digits));
        }}
        className="h-8 min-w-0 flex-1 rounded-md font-mono-data text-sm text-center px-1"
      />
      <button
        type="button"
        data-testid={`${testId}-inc`}
        onClick={inc}
        className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:scale-95 shrink-0"
        aria-label="Increment"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ExpiryBadge({ tag }) {
  const isWeekly = tag === "W";
  return (
    <span
      data-testid={`expiry-tag-${tag}`}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold leading-none border shadow-sm shrink-0 ${
        isWeekly
          ? "bg-sky-500 text-white border-sky-600"
          : "bg-amber-500 text-white border-amber-600"
      }`}
      title={isWeekly ? "Weekly expiry" : "Monthly expiry"}
    >
      {tag}
    </span>
  );
}

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
  expiriesMeta,
  selectedExpiry,
  onChangeExpiry,
}) {
  const price = current?.price ?? 0;
  // Resolve meta by ISO date so downstream operations stay by-date.
  const metaByDate = new Map(
    (expiriesMeta || []).map((m) => [m.date, m])
  );
  // If no meta provided, fall back to plain expiries with W tag.
  const orderedExpiries =
    expiriesMeta && expiriesMeta.length
      ? expiriesMeta
      : (expiries || []).map((d) => ({ date: d, tag: "W", type: "weekly", days_to_expiry: null, label: d }));

  const step = STRIKE_STEP[activeIndex] || 50;

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

      {/* Expiry list — with W (Weekly) / M (Monthly) tags */}
      <div className="p-4 border-b border-slate-200">
        <Label className="text-[10px] uppercase tracking-widest text-slate-500">Expiries Included</Label>
        <div
          className="mt-2 space-y-1 pr-1 overflow-y-auto sidebar-expiries"
          style={{ maxHeight: "220px" }}
          data-testid="expiries-list"
        >
          {orderedExpiries.map((exp, i) => {
            const active = selectedExpiry ? selectedExpiry === exp.date : i === 0;
            const daysLabel =
              exp.days_to_expiry != null ? `${exp.days_to_expiry} days` : null;
            return (
              <button
                key={exp.date + i}
                data-testid={`expiry-${exp.date}`}
                onClick={() => onChangeExpiry?.(exp.date)}
                className={`w-full expiry-row flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
                  active
                    ? "bg-gradient-to-r from-indigo-600 to-sky-600 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`w-3 h-3 rounded-sm border ${active ? "bg-white border-white" : "border-slate-400"}`} />
                <span className="text-sm font-mono-data flex-1">
                  {exp.label || exp.date}
                  {daysLabel && (
                    <span className={`ml-1 text-[11px] ${active ? "text-white/80" : "text-slate-500"}`}>
                      ({daysLabel})
                    </span>
                  )}
                </span>
                <ExpiryBadge tag={exp.tag || "W"} />
              </button>
            );
          })}
          {(!orderedExpiries || orderedExpiries.length === 0) && (
            <p className="text-[11px] text-slate-400 italic pl-1">Loading expiries…</p>
          )}
        </div>
      </div>

      {/* Strike range with stepper (index-aware step: NIFTY 50, SENSEX/BANK 100) */}
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
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Min</div>
            <StepperInput
              testId="input-strike-min"
              value={strikeRange.min}
              step={step}
              onChange={(v) => onChangeStrikeRange({ ...strikeRange, min: v })}
            />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Max</div>
            <StepperInput
              testId="input-strike-max"
              value={strikeRange.max}
              step={step}
              onChange={(v) => onChangeStrikeRange({ ...strikeRange, max: v })}
            />
          </div>
        </div>
        <div className="mt-2 text-[10px] text-slate-400 font-mono-data">
          Step: {step} pts ({activeIndex})
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
