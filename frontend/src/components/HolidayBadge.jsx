import { useMemo } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { nextHolidayInfo, formatDatePretty } from "@/lib/holidays";

export default function HolidayBadge({ onClick }) {
  const info = useMemo(() => nextHolidayInfo(), []);
  const tileBase =
    "w-full min-h-[58px] h-full rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-95 flex flex-col justify-between";

  if (!info) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="holiday-badge"
        className={`${tileBase} border-slate-200 bg-white text-slate-600`}
      >
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
          <CalendarClock className="w-3 h-3" />
          Next Holiday
        </div>
        <div className="text-xs font-semibold leading-snug">No upcoming holiday</div>
        <div className="text-[10px] leading-tight opacity-60">Tap to open holidays</div>
      </button>
    );
  }

  // Red boxed when the holiday is TODAY or TOMORROW (per user spec).
  const urgent = info.status === "today" || info.status === "tomorrow";
  const cls = urgent
    ? "border-rose-500 bg-rose-50 text-rose-800 shadow-[0_0_0_2px_rgba(244,63,94,0.15)]"
    : info.status === "this-week"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-white text-slate-600";

  const dateLabel = formatDatePretty(info.date);
  const relative =
    info.status === "today" ? "TODAY"
      : info.status === "tomorrow" ? "TOMORROW"
        : `in ${info.daysAway} days`;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="holiday-badge"
      className={`${tileBase} ${cls}`}
      title={`${info.name} — ${dateLabel}`}
    >
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
        {urgent ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
        Next Holiday · {relative}
      </div>
      <div className="text-xs font-semibold font-mono-data leading-tight" data-testid="holiday-badge-date">
        {dateLabel}
      </div>
      <div className="text-[10px] leading-tight truncate" data-testid="holiday-badge-name">
        {info.name}
      </div>
    </button>
  );
}
