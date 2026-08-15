import { useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, AlertTriangle, ChevronDown } from "lucide-react";
import { nextHolidayInfo, upcomingHolidays, formatDatePretty } from "@/lib/holidays";
import usePortaledMenu from "@/hooks/usePortaledMenu";

const MENU_WIDTH = 288;

/**
 * Next NSE holiday tile. Click opens an in-place dropdown — never switches dashboard tabs.
 */
export default function HolidayBadge({ onOpenCalendar }) {
  const info = useMemo(() => nextHolidayInfo(), []);
  const upcoming = useMemo(() => upcomingHolidays(), []);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const { pos, place } = usePortaledMenu({
    open,
    onClose: close,
    anchorRef,
    panelRef,
    width: MENU_WIDTH,
    align: "right",
  });

  const extras = upcoming.filter((h) => !info || h.date !== info.date).slice(0, 8);
  const tileBase =
    "w-full min-h-[58px] h-full rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-95 flex flex-col justify-between cursor-pointer";

  const toggle = (e) => {
    e?.stopPropagation?.();
    setOpen((v) => {
      if (!v) place();
      return !v;
    });
  };

  const urgent = info && (info.status === "today" || info.status === "tomorrow");
  const cls = !info
    ? "border-slate-200 bg-white text-slate-600"
    : urgent
      ? "border-rose-500 bg-rose-50 text-rose-800 shadow-[0_0_0_2px_rgba(244,63,94,0.15)]"
      : info.status === "this-week"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-white text-slate-600";

  const relative = !info
    ? null
    : info.status === "today"
      ? "TODAY"
      : info.status === "tomorrow"
        ? "TOMORROW"
        : `in ${info.daysAway} days`;

  return (
    <div className={`relative w-full h-full overflow-visible ${open ? "z-40" : "z-10"}`} data-testid="holiday-badge-wrap">
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(e);
          }
        }}
        data-testid="holiday-badge"
        className={`${tileBase} ${cls}`}
        title={info ? `${info.name} — ${formatDatePretty(info.date)}` : "Upcoming NSE holidays"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
          {urgent ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
          {info ? `Next Holiday · ${relative}` : "Next Holiday"}
          <span className="ml-auto inline-flex items-center gap-0.5 opacity-70">
            {extras.length > 0 ? `+${extras.length}` : null}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </div>
        {info ? (
          <>
            <div className="text-xs font-semibold font-mono-data leading-tight" data-testid="holiday-badge-date">
              {formatDatePretty(info.date)}
            </div>
            <div className="text-[10px] leading-tight truncate" data-testid="holiday-badge-name">
              {info.name}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold leading-snug">No upcoming holiday</div>
            <div className="text-[10px] leading-tight opacity-60">Tap for the holiday list</div>
          </>
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          data-testid="holiday-dropdown"
          role="menu"
          className="fixed w-72 rounded-md border border-slate-200 bg-white shadow-xl z-[240] max-h-96 overflow-y-auto"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-slate-100 text-[10px] uppercase tracking-widest text-slate-500 flex items-center justify-between">
            <span>Upcoming NSE holidays</span>
            <button type="button" className="text-slate-400 hover:text-slate-800" onClick={close}>✕</button>
          </div>
          <div className="divide-y divide-slate-100">
            {(info ? [info, ...extras] : extras).map((h) => (
              <div key={h.date + h.name} data-testid="holiday-dropdown-item" className="px-3 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">{h.name}</div>
                  <div className="text-[10px] text-slate-500">{formatDatePretty(h.date)}</div>
                </div>
                <div className="text-[10px] text-slate-600 font-mono-data whitespace-nowrap">
                  {h.daysAway != null ? `in ${h.daysAway}d` : h.date}
                </div>
              </div>
            ))}
            {!info && extras.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-slate-500">No weekday holidays on the NSE calendar.</div>
            )}
          </div>
          {typeof onOpenCalendar === "function" && (
            <div className="px-3 py-2 border-t border-slate-100 text-right">
              <button
                type="button"
                className="text-[10px] text-sky-600 hover:underline"
                onClick={() => { close(); onOpenCalendar(); }}
                data-testid="holiday-dropdown-more"
              >
                See full calendar →
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
