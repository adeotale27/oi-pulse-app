import { useMemo, useState, useRef, useCallback } from "react";
import { AlertTriangle, CalendarClock, ChevronDown } from "lucide-react";
import { upcomingEvents, eventsWithinDays, eventBadgeTone } from "@/lib/econCalendar";
import { formatDatePretty } from "@/lib/holidays";
import useClickOutside from "@/hooks/useClickOutside";

// Shows the next major event(s) that could move the market.
// - If 1 event within 3 days: shows it inline.
// - If multiple: shows the earliest inline + a dropdown chevron listing others.
// - Red boxed if any event is today or tomorrow.
export default function MarketEventsBadge({ onClick }) {
  const near = useMemo(() => eventsWithinDays(3), []);
  const upcoming = useMemo(() => upcomingEvents(10), []);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  const primary = near[0] || upcoming[0];
  const tileBase =
    "w-full min-h-[58px] h-full rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-95 flex flex-col justify-between";

  if (!primary) {
    return (
      <div className="relative w-full h-full" data-testid="events-badge-wrap">
        <div
          role="button"
          tabIndex={0}
          onClick={() => onClick?.()}
          onKeyDown={(e) => { if (e.key === "Enter") onClick?.(); }}
          data-testid="events-badge"
          className={`${tileBase} cursor-pointer border-slate-200 bg-white text-slate-600`}
        >
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
            <CalendarClock className="w-3 h-3" />
            Next Event
          </div>
          <div className="text-xs font-semibold leading-snug">There are no upcoming events</div>
          <div className="text-[10px] leading-tight opacity-60">Tap to open calendar</div>
        </div>
      </div>
    );
  }

  const urgent = primary.daysAway <= 1;
  const soon = primary.daysAway <= 3;
  const cls = urgent
    ? "border-rose-500 bg-rose-50 text-rose-800 shadow-[0_0_0_2px_rgba(244,63,94,0.15)]"
    : soon
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-white text-slate-600";

  const rel =
    primary.daysAway === 0 ? "TODAY"
      : primary.daysAway === 1 ? "TOMORROW"
        : `in ${primary.daysAway} days`;

  // Dropdown list = upcoming events beyond the primary, capped 8.
  const extras = upcoming.filter((e) => !(e.date === primary.date && e.name === primary.name)).slice(0, 8);

  return (
    <div className="relative w-full h-full" data-testid="events-badge-wrap" ref={wrapRef}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (extras.length) setOpen((v) => !v); else onClick?.(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { if (extras.length) setOpen((v) => !v); else onClick?.(); } }}
        data-testid="events-badge"
        className={`${tileBase} cursor-pointer ${cls}`}
        title={`${primary.name} — ${formatDatePretty(primary.date)}`}
      >
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
          {urgent ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
          Next Event · {rel}
          {extras.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-0.5 opacity-70">
              +{extras.length}
              <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </span>
          )}
        </div>
        <div className="text-xs font-semibold leading-tight truncate" data-testid="events-badge-name">
          {primary.name}
        </div>
        <div className="text-[10px] leading-tight opacity-80 font-mono-data">
          {formatDatePretty(primary.date)}
        </div>
      </div>

      {open && extras.length > 0 && (
        <div
          data-testid="events-dropdown"
          className="absolute right-0 top-full mt-1 w-72 rounded-md border border-slate-200 bg-white shadow-xl z-40 max-h-96 overflow-y-auto"
        >
          <div className="px-3 py-2 border-b border-slate-100 text-[10px] uppercase tracking-widest text-slate-500 flex items-center justify-between">
            <span>Upcoming market-moving events</span>
            <button type="button" className="text-slate-400 hover:text-slate-800" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="divide-y divide-slate-100">
            {extras.map((e) => (
              <div key={e.date + e.name} data-testid="events-dropdown-item" className="px-3 py-2 flex items-start gap-2 hover:bg-slate-50">
                <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-sm border ${eventBadgeTone(e.type)}`}>{e.type}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{e.name}</div>
                  <div className="text-[10px] text-slate-500">{formatDatePretty(e.date)}</div>
                </div>
                <div className="text-[10px] text-slate-600 font-mono-data whitespace-nowrap">in {e.daysAway}d</div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 text-right">
            <button
              type="button"
              className="text-[10px] text-sky-600 hover:underline"
              onClick={() => { setOpen(false); onClick?.(); }}
              data-testid="events-dropdown-more"
            >
              See full calendar →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
