import { Button } from "@/components/ui/button";

const TIMEFRAMES = [
  { key: 1, label: "1m" },
  { key: 3, label: "3m" },
  { key: 5, label: "5m" },
  { key: 10, label: "10m" },
  { key: 15, label: "15m" },
  { key: 30, label: "30m" },
  { key: 60, label: "1h" },
  { key: 120, label: "2h" },
  { key: 180, label: "3h" },
  { key: 375, label: "Full Day" },
];

export default function TimeframePills({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="timeframe-pills">
      {TIMEFRAMES.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            data-testid={`tf-${t.label}`}
            onClick={() => onChange(t.key)}
            className={`tf-pill font-mono-data text-xs px-3 py-1.5 rounded-sm border ${
              active
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
