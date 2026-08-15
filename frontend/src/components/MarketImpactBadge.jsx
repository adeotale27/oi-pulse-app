import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, TrendingUp, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import usePortaledMenu from "@/hooks/usePortaledMenu";

/**
 * MarketImpactBadge — small header tile that shows a dropdown of upcoming
 * high-impact events (Quarterly Results, Board Meetings) for the current
 * strategy's index (activeIndex).
 *
 * Color rules:
 *   • RED  if any event is today OR within THIS week (≤7d)
 *   • BLUE if only upcoming next week (8–14d)
 *   • Neutral if further out / no events
 */

const INDEX_LABEL = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Bank Nifty",
  SENSEX: "Sensex",
};

const MENU_WIDTH = 288;

export default function MarketImpactBadge({ activeIndex, onOpenIndexEvents }) {
  const [events, setEvents] = useState([]);
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

  useEffect(() => {
    if (!activeIndex) return undefined;

    let cancelled = false;

    api
      .get(`/events/${activeIndex}`)
      .then((r) => {
        if (!cancelled) setEvents(r.data.events || []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeIndex]);

  // High-impact = Quarterly Results or Board Meeting
  const impactful = useMemo(() => {
    return events
      .filter((e) => e.days_remaining >= 0)
      .filter((e) =>
        ["Quarterly Results", "Board Meeting"].includes(e.event_type)
      )
      .sort(
        (a, b) =>
          a.days_remaining - b.days_remaining ||
          -((a.weightage || 0) - (b.weightage || 0))
      );
  }, [events]);

  const primary = impactful[0];
  const indexLabel = INDEX_LABEL[activeIndex] || activeIndex || "this index";

  const hasThisWeek = impactful.some((e) => e.days_remaining <= 7);
  const hasNextWeek = impactful.some(
    (e) => e.days_remaining > 7 && e.days_remaining <= 14
  );

  const tone = !primary
    ? "neutral"
    : hasThisWeek
      ? "red"
      : hasNextWeek
        ? "blue"
        : "neutral";

  const toneCls =
    tone === "red"
      ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 shadow-[0_0_0_2px_rgba(244,63,94,0.15)]"
      : tone === "blue"
      ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200"
      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300";

  const daysText = (d) =>
    d === 0 ? "TODAY" : d === 1 ? "TOMORROW" : `in ${d}d`;

  const tileBase =
    "w-full min-h-[58px] h-full rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors hover:brightness-95 flex flex-col justify-between";

  if (!primary) {
    return (
      <div className="relative w-full h-full" data-testid="market-impact-badge-wrap">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (typeof onOpenIndexEvents === "function") onOpenIndexEvents();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typeof onOpenIndexEvents === "function") onOpenIndexEvents();
          }}
          data-testid="market-impact-badge"
          className={`${tileBase} cursor-pointer ${toneCls}`}
          title={`No upcoming events for ${indexLabel}`}
        >
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
            <TrendingUp className="w-3 h-3" />
            Index Impact
          </div>
          <div className="text-xs font-semibold leading-snug mt-0.5" data-testid="market-impact-empty">
            There are no upcoming events for {indexLabel}
          </div>
          <div className="text-[10px] leading-tight opacity-60">Tap to open Index Risk</div>
        </div>
      </div>
    );
  }

  const toggle = () => {
    setOpen((v) => {
      if (!v) place();
      return !v;
    });
  };

  return (
    <div
      className={`relative w-full h-full overflow-visible ${open ? "z-40" : "z-10"}`}
      data-testid="market-impact-badge-wrap"
    >
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter") toggle();
        }}
        data-testid="market-impact-badge"
        className={`${tileBase} cursor-pointer ${toneCls}`}
        title={`${impactful.length} high-impact events for ${activeIndex}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest opacity-80">
          {tone === "red" ? (
            <AlertTriangle className="w-3 h-3" />
          ) : (
            <TrendingUp className="w-3 h-3" />
          )}

          Index Impact · {daysText(primary.days_remaining)}

          <span className="ml-auto inline-flex items-center gap-0.5 opacity-70">
            {impactful.length > 1 && `+${impactful.length - 1}`}
            <ChevronDown
              className={`w-3 h-3 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </span>
        </div>

        <div
          className="flex items-center text-xs font-semibold leading-tight truncate mt-0.5"
          data-testid="market-impact-name"
        >
          <span className="truncate">
            {activeIndex === "SENSEX"
              ? (primary.constituents || primary.company_name || primary.symbol)
              : primary.symbol}
          </span>

          <span className="ml-3">
            {primary.event_type}
          </span>
        </div>

        <div className="text-[10px] leading-tight opacity-80 font-mono-data">
          {primary.weightage != null
            ? `${primary.weightage.toFixed(2)}% Weightage`
            : "Weightage N/A"}
        </div>
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          data-testid="market-impact-dropdown"
          role="menu"
          className="fixed z-[240] w-72 bg-white dark:bg-slate-800 rounded-md shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
            <span>Upcoming High-Impact Events</span>

            {typeof onOpenIndexEvents === "function" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onOpenIndexEvents();
                }}
                className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline font-semibold"
              >
                View all →
              </button>
            )}
          </div>

          <ul className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-slate-700">
            {impactful.slice(0, 15).map((e) => {
              const wk =
                e.days_remaining <= 7
                  ? "red"
                  : e.days_remaining <= 14
                  ? "blue"
                  : "neutral";

              const cls =
                wk === "red"
                  ? "text-rose-600 dark:text-rose-400"
                  : wk === "blue"
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-slate-500";

              return (
                <li
                  key={e.id}
                  className="px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2"
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      wk === "red"
                        ? "bg-rose-500"
                        : wk === "blue"
                        ? "bg-sky-500"
                        : "bg-slate-400"
                    }`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {e.symbol} · {e.event_type}
                    </div>

                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {e.company_name}
                    </div>
                  </div>

                  <div
                    className={`text-[10px] font-semibold whitespace-nowrap ${cls}`}
                  >
                    {daysText(e.days_remaining)}

                    {e.weightage != null && (
                      <div className="text-[9px] text-slate-500 dark:text-slate-400 font-normal">
                        {e.weightage.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
