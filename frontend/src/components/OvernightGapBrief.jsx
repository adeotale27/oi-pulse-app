import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Moon, AlertTriangle, TrendingUp, TrendingDown, Minimize2, Maximize2, GripHorizontal, PanelLeft, PanelRight } from "lucide-react";
import { api, fetchOIChange, subscribeExtras } from "@/lib/api";
import { readCarryDockSide, snapDockFromClientX, writeCarryDockSide } from "@/lib/carryDock";
import {
  briefTriggerKey,
  carryHorizonLabel,
  carryVerdict,
  carryWindowItems,
  dayLabel,
  holidayCarryAdvice,
  nextSessionOpenMs,
  readBriefMinimize,
  writeBriefMinimize,
  sessionBiasFromSnapshots,
  shouldAutoShowBrief,
} from "@/lib/overnightBrief";

function readCarryBottom() {
  try {
    const n = Number(localStorage.getItem("oiCarryBriefBottomPx"));
    if (Number.isFinite(n) && n >= 8 && n <= 2400) return n;
  } catch { /* noop */ }
  return null;
}

function writeCarryBottom(px) {
  try { localStorage.setItem("oiCarryBriefBottomPx", String(Math.round(px))); } catch { /* noop */ }
}

function readCarryIconOnly() {
  try { return localStorage.getItem("oiCarryBriefIconOnly") === "1"; } catch { return false; }
}

function writeCarryIconOnly(on) {
  try { localStorage.setItem("oiCarryBriefIconOnly", on ? "1" : "0"); } catch { /* noop */ }
}

function dockClearance() {
  if (typeof window === "undefined") return 12;
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  const safe = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)")) || 0;
  return mobile ? 52 + (Number.isFinite(safe) ? safe : 0) : 12;
}

function getISTParts(dt = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(dt);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = map[get("weekday")] ?? 0;
  const h = Number(get("hour") || 0);
  const m = Number(get("minute") || 0);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  return {
    weekday,
    minutesOfDay: h * 60 + m,
    dateISO: `${y}-${mo}-${d}`,
  };
}

function fmtDelta(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * Sticky “Should I carry?” overnight gap brief.
 * Auto-opens from 14:00 IST on a trading day through next market open.
 * Desktop: left by default; drag the header or use the dock button to move it.
 * Phone: panel is height-capped with a sticky close bar so it cannot trap the screen.
 */
export default function OvernightGapBrief({ indices = ["NIFTY", "SENSEX", "BANKNIFTY"] }) {
  const [now, setNow] = useState(() => new Date());
  const [active, setActive] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [triggerKey, setTriggerKey] = useState(null);
  const [biases, setBiases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gift, setGift] = useState(null);
  const [indexImpacts, setIndexImpacts] = useState([]);
  const [bottomPx, setBottomPx] = useState(() => readCarryBottom());
  const [iconOnly, setIconOnly] = useState(() => readCarryIconOnly());
  const [dock, setDock] = useState(() => readCarryDockSide());
  const dragRef = useRef(null);
  const skipClickRef = useRef(false);

  const setDockSide = (side) => {
    const next = side === "right" ? "right" : "left";
    setDock(next);
    writeCarryDockSide(next);
  };

  const clampBottom = useCallback((raw) => {
    const min = dockClearance();
    const max = Math.max(min, (typeof window !== "undefined" ? window.innerHeight : 800) - 72);
    return Math.min(max, Math.max(min, raw));
  }, []);

  const onCarryPointerDown = (e, kind = "mobile") => {
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    if (kind === "mobile" && desktop) return;
    if (kind === "dock" && !desktop) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startBottom = bottomPx != null ? bottomPx : dockClearance();
    dragRef.current = { kind, startY: e.clientY, startX: e.clientX, startBottom, moved: false };
  };

  const onCarryPointerMove = (e) => {
    if (!dragRef.current) return;
    if (Math.abs(e.clientY - dragRef.current.startY) > 6 || Math.abs(e.clientX - dragRef.current.startX) > 6) {
      dragRef.current.moved = true;
    }
    if (dragRef.current.kind === "dock") return;
    const dy = dragRef.current.startY - e.clientY;
    setBottomPx(clampBottom(dragRef.current.startBottom + dy));
  };

  const onCarryPointerUp = (e) => {
    if (!dragRef.current) return;
    skipClickRef.current = !!dragRef.current?.moved;
    const kind = dragRef.current.kind;
    const moved = dragRef.current.moved;
    const shouldExpand = minimized && !moved;
    const endX = e.clientX;
    const w = typeof window !== "undefined" ? window.innerWidth : 400;
    if (kind === "dock") {
      if (moved) setDockSide(snapDockFromClientX(endX, w));
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      return;
    }
    const edgeDock = dock === "left" ? endX <= 72 : endX >= w - 72;
    if (edgeDock) {
      setIconOnly(true);
      setMinimized(true);
      writeCarryIconOnly(true);
    } else if (Math.abs(endX - (dock === "left" ? 0 : w)) > 120) {
      setIconOnly(false);
      writeCarryIconOnly(false);
    }
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    setBottomPx((prev) => {
      const next = clampBottom(prev != null ? prev : dockClearance());
      writeCarryBottom(next);
      return next;
    });
    if (shouldExpand && !edgeDock) setMinimized(false);
  };

  const carryPosStyle = {
    bottom: bottomPx != null ? `${bottomPx}px` : undefined,
  };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onExtras = (data) => {
      setGift(data?.gift_nifty || null);
    };
    return subscribeExtras(onExtras);
  }, []);

  const ist = useMemo(() => getISTParts(now), [now]);
  const events = useMemo(
    () => carryWindowItems(ist.weekday, { indexImpacts }),
    [ist.weekday, indexImpacts],
  );
  const holidayNote = useMemo(() => holidayCarryAdvice(ist.weekday), [ist.weekday]);

  // Auto-show when trigger fires; respect minimize-until-next-open.
  useEffect(() => {
    const key = briefTriggerKey(ist.dateISO, ist.weekday, ist.minutesOfDay);
    if (!key || !shouldAutoShowBrief(ist.weekday, ist.minutesOfDay, ist.dateISO)) {
      // Past the carry window / next session started → hide completely.
      setActive(false);
      setMinimized(false);
      setTriggerKey(null);
      return;
    }
    setTriggerKey(key);
    const min = readBriefMinimize(key);
    if (min) {
      setMinimized(true);
      setActive(true);
      return;
    }
    setMinimized(false);
    setActive(true);
  }, [ist.dateISO, ist.weekday, ist.minutesOfDay]);

  const loadBiases = useCallback(async () => {
    if (!active || minimized || !indices?.length) return;
    setLoading(true);
    try {
      const rows = await Promise.all(
        indices.map(async (idx) => {
          try {
            const data = await fetchOIChange(idx, 15, { also: "session" });
            const sessPrev = data?.also_windows?.session?.previous;
            const bias = sessionBiasFromSnapshots(data?.current, sessPrev);
            return {
              index: idx,
              bias,
              minutes: data?.also_windows?.session?.minutes ?? null,
              price: data?.current?.price ?? null,
            };
          } catch {
            return { index: idx, bias: null, minutes: null, price: null };
          }
        }),
      );
      setBiases(rows);
    } finally {
      setLoading(false);
    }
  }, [active, minimized, indices]);

  const loadIndexImpacts = useCallback(async () => {
    if (!active || minimized || !indices?.length) return;
    const packs = await Promise.all(
      indices.map(async (idx) => {
        try {
          const { data } = await api.get(`/events/${idx}`);
          return { index: idx, events: data?.events || [] };
        } catch {
          return { index: idx, events: [] };
        }
      }),
    );
    setIndexImpacts(packs);
  }, [active, minimized, indices]);

  useEffect(() => {
    loadBiases();
  }, [loadBiases]);

  useEffect(() => {
    loadIndexImpacts();
  }, [loadIndexImpacts]);

  const giftPct = gift?.change_pct != null ? Number(gift.change_pct) : null;
  const verdict = useMemo(
    () =>
      carryVerdict({
        biases: biases.map((b) => b.bias).filter(Boolean),
        events,
        giftPct,
        weekday: ist.weekday,
      }),
    [biases, events, giftPct, ist.weekday],
  );

  const minimize = () => {
    const until = nextSessionOpenMs(new Date());
    if (triggerKey) writeBriefMinimize(triggerKey, until);
    setMinimized(true);
    setIconOnly(false);
    writeCarryIconOnly(false);
  };

  const expand = () => {
    setIconOnly(false);
    writeCarryIconOnly(false);
    setMinimized(false);
  };

  const dismissUntilOpen = () => {
    minimize();
  };

  if (!active) return null;

  const bandCls =
    verdict.band === "DO_NOT_CARRY"
      ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100"
      : verdict.band === "REDUCE"
        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100"
        : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100";

  const bandLabel =
    verdict.band === "DO_NOT_CARRY"
      ? "Do not carry"
      : verdict.band === "REDUCE"
        ? "Reduce / hedge"
        : "Carry OK (sized)";

  const title =
    ist.weekday === 0
      ? "Overnight gap brief · Sunday night"
      : "Overnight gap brief · Should I carry?";

  const dockEdge = dock === "left"
    ? (iconOnly ? "left-1" : "left-3")
    : (iconOnly ? "right-1" : "right-3");
  const expandedDock = dock === "left"
    ? "left-3 right-3 sm:right-auto sm:w-[26rem]"
    : "left-3 right-3 sm:left-auto sm:w-[26rem]";

  if (minimized) {
    return (
      <button
        type="button"
        data-testid="overnight-gap-brief-chip"
        data-icon-only={iconOnly ? "1" : "0"}
        data-dock={dock}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          expand();
        }}
        className={`fixed z-40 md:bottom-3 flex items-center rounded-full border-2 shadow-lg text-xs font-semibold touch-none ${bandCls} ${dockEdge} ${
          iconOnly ? "p-2.5" : "gap-2 px-3 py-2"
        } ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
        style={carryPosStyle}
        onPointerDown={(e) => onCarryPointerDown(e, "mobile")}
        onPointerMove={onCarryPointerMove}
        onPointerUp={onCarryPointerUp}
        onPointerCancel={onCarryPointerUp}
        title="Open overnight gap brief · drag to the edge for moon only"
        aria-label="Carry brief"
      >
        <Moon className={iconOnly ? "w-5 h-5" : "w-3.5 h-3.5"} />
        {!iconOnly && (
          <>
            <span>Carry brief</span>
            <span className="opacity-70 font-mono-data">{verdict.score}/100</span>
            <Maximize2 className="w-3.5 h-3.5 opacity-70" />
          </>
        )}
      </button>
    );
  }

  return (
    <div
      data-testid="overnight-gap-brief"
      data-dock={dock}
      className={`fixed z-40 md:bottom-3 ${expandedDock} flex flex-col rounded-md border-2 shadow-lg overflow-hidden ${bandCls} ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
      style={{
        ...carryPosStyle,
        maxHeight: `min(72dvh, calc(100dvh - ${(bottomPx != null ? bottomPx : 56) + 16}px))`,
      }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="sticky top-0 z-10 flex items-start gap-2 px-3 pt-2 pb-2 shrink-0 border-b border-black/10 dark:border-white/10 bg-inherit rounded-t-md"
      >
        <button
          type="button"
          className="md:hidden mt-0.5 min-h-11 min-w-11 inline-flex items-center justify-center opacity-80 touch-none"
          aria-label="Drag carry brief"
          data-testid="overnight-gap-brief-drag"
          onPointerDown={(e) => onCarryPointerDown(e, "mobile")}
          onPointerMove={onCarryPointerMove}
          onPointerUp={onCarryPointerUp}
          onPointerCancel={onCarryPointerUp}
        >
          <GripHorizontal className="w-5 h-5" />
        </button>
        <div
          className="hidden md:flex items-center gap-1.5 min-w-0 flex-1 cursor-grab active:cursor-grabbing touch-none"
          data-testid="overnight-gap-brief-dock-drag"
          onPointerDown={(e) => onCarryPointerDown(e, "dock")}
          onPointerMove={onCarryPointerMove}
          onPointerUp={onCarryPointerUp}
          onPointerCancel={onCarryPointerUp}
          title="Drag to the left or right of the desk"
        >
          <Moon className="w-4 h-4 shrink-0 opacity-80" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest opacity-70">Should I carry?</div>
            <div className="text-sm font-semibold leading-tight">{title}</div>
          </div>
        </div>
        <div className="md:hidden min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest opacity-70">Should I carry?</div>
          <div className="text-sm font-semibold leading-tight">{title}</div>
        </div>
        <button
          type="button"
          onClick={() => setDockSide(dock === "left" ? "right" : "left")}
          className="hidden md:inline-flex opacity-70 hover:opacity-100 p-1.5 rounded"
          aria-label={dock === "left" ? "Move carry brief to the right" : "Move carry brief to the left"}
          title={dock === "left" ? "Move to right" : "Move to left"}
          data-testid="overnight-gap-brief-dock-toggle"
        >
          {dock === "left" ? <PanelRight className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={minimize}
          className="opacity-80 hover:opacity-100 min-h-11 min-w-11 md:min-h-0 md:min-w-0 inline-flex items-center justify-center md:p-1.5 rounded"
          aria-label="Minimize overnight brief until next session"
          title="Minimize until next market open"
          data-testid="overnight-gap-brief-minimize"
        >
          <Minimize2 className="w-5 h-5 md:w-4 md:h-4" />
        </button>
        <button
          type="button"
          onClick={dismissUntilOpen}
          className="opacity-80 hover:opacity-100 min-h-11 min-w-11 md:min-h-0 md:min-w-0 inline-flex items-center justify-center md:p-1.5 rounded"
          aria-label="Close overnight brief"
          data-testid="overnight-gap-brief-dismiss"
        >
          <X className="w-5 h-5 md:w-4 md:h-4" />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2 space-y-2.5 text-xs overflow-y-auto min-h-0 flex-1">
        <div
          className="flex items-center justify-between gap-2 rounded border border-black/10 dark:border-white/10 bg-white/50 dark:bg-black/20 px-2 py-1.5"
          data-testid="overnight-gap-verdict"
        >
          <span className="font-semibold text-sm">{bandLabel}</span>
          <span className="font-mono-data opacity-70">{verdict.score}/100 risk</span>
        </div>
        <p className="leading-snug opacity-90" data-testid="overnight-gap-advice">
          {verdict.advice}
        </p>
        <p className="text-[10px] opacity-60">
          Minimize keeps a chip until next session open (admin market hours). Tap the chip anytime to re-read.
        </p>
        {holidayNote && (
          <div
            className="rounded border border-amber-400/60 bg-amber-100/70 dark:bg-amber-950/40 px-2 py-1.5 text-[11px] leading-snug"
            data-testid="overnight-gap-holiday-note"
          >
            {holidayNote}
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">
            Whole-day bias · 9:15 → close
          </div>
          {loading && biases.length === 0 ? (
            <div className="opacity-60">Loading session bias…</div>
          ) : (
            <div className="space-y-1" data-testid="overnight-gap-biases">
              {biases.map((row) => {
                const b = row.bias;
                const bull = b?.bullish;
                return (
                  <div
                    key={row.index}
                    className="flex items-center gap-2 rounded bg-white/60 dark:bg-black/25 px-2 py-1"
                    data-testid={`overnight-bias-${row.index}`}
                  >
                    <span className="font-semibold w-20 shrink-0">{row.index}</span>
                    {b ? (
                      <>
                        {bull ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        )}
                        <span className={bull ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>
                          {b.label} {b.pct}%
                        </span>
                        <span className="ml-auto font-mono-data opacity-60 text-[10px]">
                          PE {fmtDelta(b.pe)} · CE {fmtDelta(b.ce)}
                        </span>
                      </>
                    ) : (
                      <span className="opacity-50">No session data</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-2 rounded bg-white/60 dark:bg-black/25 px-2 py-1.5"
          data-testid="overnight-gap-gift"
        >
          <span className="font-semibold shrink-0">GIFT Nifty</span>
          {giftPct != null && Number.isFinite(giftPct) ? (
            <span
              className={`font-mono-data font-semibold ${
                giftPct > 0.05 ? "text-emerald-700" : giftPct < -0.05 ? "text-rose-700" : "opacity-80"
              }`}
            >
              {giftPct >= 0 ? "+" : ""}
              {giftPct.toFixed(2)}%
              {gift?.last != null ? (
                <span className="opacity-60 font-normal ml-1">· {Number(gift.last).toFixed(0)}</span>
              ) : null}
            </span>
          ) : (
            <span className="opacity-50">No overnight print yet</span>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Events & index impact · {carryHorizonLabel(ist.weekday)}
          </div>
          {events.length === 0 ? (
            <div className="opacity-60 px-1">No major scheduled events or index impacts in carry window.</div>
          ) : (
            <ul className="space-y-0.5 max-h-36 overflow-y-auto" data-testid="overnight-gap-events">
              {events.slice(0, 10).map((e) => (
                <li key={`${e.date}|${e.name}`} className="leading-snug px-1">
                  <span className="font-medium">{dayLabel(e.daysAway, ist.weekday)}</span>
                  {" · "}
                  {e.name}
                  {e.source === "index-impact" ? (
                    <span className="opacity-60"> [INDEX]</span>
                  ) : e.impact ? (
                    <span className="opacity-60"> [{String(e.impact).toUpperCase()}]</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {verdict.notes?.length > 0 && (
          <div className="text-[10px] opacity-60 border-t border-black/10 dark:border-white/10 pt-1.5">
            {verdict.notes.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}
