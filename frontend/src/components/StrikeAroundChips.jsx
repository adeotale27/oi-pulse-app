const STRIKE_COUNTS = [2, 5, 10, 15, 20, 25];

export default function StrikeAroundChips({
  strikesAround,
  onChange,
  className = "",
}) {
  return (
    <div className={className} data-testid="strike-around-chips">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
        Strikes above &amp; below ATM
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="strikes-all"
          onClick={() => onChange?.("all")}
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
            type="button"
            key={n}
            data-testid={`strikes-${n}`}
            onClick={() => onChange?.(n)}
            className={`text-xs px-2.5 py-1 rounded-md border font-mono-data transition-colors ${
              strikesAround === n
                ? "bg-gradient-to-br from-emerald-600 to-teal-600 text-white border-transparent shadow"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            ±{n}
          </button>
        ))}
      </div>
    </div>
  );
}
