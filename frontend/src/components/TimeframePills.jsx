import { Button } from "@/components/ui/button";

const TIMEFRAMES = [
  { key: 1, label: "Last 1 min" },
  { key: 3, label: "Last 3 mins" },
  { key: 5, label: "Last 5 mins" },
  { key: 10, label: "Last 10 mins" },
  { key: 15, label: "Last 15 mins" },
  { key: 30, label: "Last 30 mins" },
  { key: 60, label: "Last 1 Hr" },
  { key: 120, label: "Last 2 Hrs" },
  { key: 180, label: "Last 3 Hrs" },
  { key: "full", label: "Full Day" },
];

export default function TimeframePills({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="timeframe-pills">
      {TIMEFRAMES.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            data-testid={`tf-${t.key}`}
            onClick={() => onChange(t.key)}
            className={`tf-pill font-mono-data text-[11px] sm:text-xs px-2.5 sm:px-3.5 py-1.5 rounded-sm border transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/80 focus-visible:ring-offset-1 ${
              active
                ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-400"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
