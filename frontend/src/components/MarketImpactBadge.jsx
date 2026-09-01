import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, TrendingUp, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import usePortaledMenu from "@/hooks/usePortaledMenu";
import {
  upcomingIndexEvents,
  impactTone,
  eventDisplayName,
  daysText,
} from "@/lib/indexEventRisk";

/**
 * Index Impact tile — upcoming constituent events for the selected index
 * (results, board meetings, dividends, AGMs, …). Click opens an in-place
 * dropdown; does not switch dashboard tabs.
 *
 * Color rules:
 *   • RED  if any event is today OR within THIS week (≤7d)
 *   • BLUE if only upcoming next week (8–14d)
 *   • Neutral if further out / no upcoming events
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
    const t = window.setTimeout(() => {
      api
        .get(`/events/${activeIndex}`, { timeout: 8000 })
        .then((r) => {
          if (!cancelled) setEvents(r.data.events || []);
        })
        .catch(() => {
          if (!cancelled) setEvents([]);
        });
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [activeIndex]);

  const upcoming = useMemo(() => upcomingIndexEvents(events), [events]);
  const pastOnly = events.length > 0 && upcoming.length === 0;

  const primary = upcoming[0];
  const indexLabel = INDEX_LABEL[activeIndex] || activeIndex || "this index";
  const tone = impactTone(upcoming);

  const toneCls =
    tone === "red"
      ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 shadow-[0_0_0_2px_rgba(244,63,94,0.15)]"
      : tone === "blue"
      ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200"
      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300";

  const tileBase =
    "w-full min-h-[76px] rounded-sm border px-1.5 py-1 text-left transition-colors hover:brightness-95 flex flex-col gap-0.5 overflow-hidden";

  const toggle = () => {
    setOpen((v) => {
      if (!v) place();
      return !v;
    });
  };

  const emptyCopy = pastOnly
    ? `Calendar for ${indexLabel} is in the past`
    : `There are no upcoming events for ${indexLabel}`;

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
        title={
          primary
            ? `${upcoming.length} upcoming events for ${activeIndex}`
            : emptyCopy
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1 text-[8px] uppercase tracking-widest opacity-80">
          {tone === "red" ? (
            <AlertTriangle className="w-2.5 h-2.5" />
          ) : (
            <TrendingUp className="w-2.5 h-2.5" />
          )}

          <span className="truncate">{primary ? `Index Impact · ${daysText(primary.days_remaining)}` : "Index Impact"}</span>

          <span className="ml-auto inline-flex items-center gap-0.5 opacity-70">
            {upcoming.length > 1 && `+${upcoming.length - 1}`}
            <ChevronDown
              className={`w-2.5 h-2.5 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </span>
        </div>

        {primary ? (
          <>
            <div
              className="flex items-center text-[10px] font-semibold leading-tight truncate mt-0.5"
              data-testid="market-impact-name"
            >
              <span className="truncate">
                {eventDisplayName(primary, activeIndex)}
              </span>
              <span className="ml-2">{primary.event_type}</span>
            </div>
            <div className="text-[9px] leading-tight opacity-80 font-mono-data truncate">
              {primary.weightage != null
                ? `${primary.weightage.toFixed(2)}% Weightage`
                : "Weightage N/A"}
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-semibold leading-snug mt-0.5 truncate" data-testid="market-impact-empty">
              {emptyCopy}
            </div>
            <div className="text-[9px] leading-tight opacity-60">Tap for the event list</div>
          </>
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          data-testid="market-impact-dropdown"
          role="menu"
          className="fixed z-[240] bg-white dark:bg-slate-800 rounded-md shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden overflow-y-auto overscroll-contain"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
            <span>Upcoming index events</span>

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

          {upcoming.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-slate-500 dark:text-slate-400">
              {pastOnly
                ? "Joined events for this index are all dated before today. Upload a fresh NSE event calendar in Admin."
                : `No upcoming constituent events for ${indexLabel}.`}
            </div>
          ) : (
          <ul className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-slate-700">
            {upcoming.slice(0, 15).map((e) => {
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
                      {eventDisplayName(e, activeIndex)} · {e.event_type}
                    </div>

                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {e.company_name}
                      {e.event_date ? ` · ${e.event_date}` : ""}
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
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
