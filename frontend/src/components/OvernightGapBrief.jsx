import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Moon, AlertTriangle, Minimize2, Maximize2, GripHorizontal, PanelLeft, PanelRight } from "lucide-react";
import { api, fetchOIChange, subscribeExtras } from "@/lib/api";
import { readCarryDockSide, snapDockFromClientX, writeCarryDockSide } from "@/lib/carryDock";
import { carryFocusEvents, sellerCarryAdvice, writerBiasLine } from "@/lib/carryFocus";
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

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function readCarryBottom() {
  try {
    const n = Number(localStorage.getItem("oiCarryBriefBottomPx"));
    if (!Number.isFinite(n) || n < 8 || n > 2400) return null;
    // Old builds let the sheet be dragged to the top of the phone and cover the desk.
    if (isPhone() && n > 140) return null;
    return n;
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
 * Phone: chip by default; expanded sheet stays on the dock (not dragged over the chart).
 */
export default function OvernightGapBrief({
  indices = ["NIFTY", "SENSEX", "BANKNIFTY"],
  vix = null,
  activeIndex = null,
}) {
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
  const [vixLive, setVixLive] = useState(null);
  const dragRef = useRef(null);
  const skipClickRef = useRef(false);
  const userPinnedRef = useRef(null);

  const setDockSide = (side) => {
    const next = side === "right" ? "right" : "left";
    setDock(next);
    writeCarryDockSide(next);
  };

  const minimize = () => {
    const until = nextSessionOpenMs(new Date());
    if (triggerKey) writeBriefMinimize(triggerKey, until);
    userPinnedRef.current = "min";
    setMinimized(true);
    setIconOnly(false);
    writeCarryIconOnly(false);
  };

  const expand = () => {
    userPinnedRef.current = "open";
    setIconOnly(false);
    writeCarryIconOnly(false);
    setMinimized(false);
  };

  const dismissUntilOpen = () => {
    minimize();
  };

  const clampBottom = useCallback((raw) => {
    const min = dockClearance();
    const phone = isPhone();
    const max = phone
      ? Math.max(min, 120)
      : Math.max(min, (typeof window !== "undefined" ? window.innerHeight : 800) - 72);
    return Math.min(max, Math.max(min, raw));
  }, []);

  const onCarryPointerDown = (e, kind = "mobile") => {
    const desktop = !isPhone();
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
    // Expanded phone sheet stays docked; only the moon chip can slide a little.
    if (!minimized && isPhone()) return;
    const dy = dragRef.current.startY - e.clientY;
    setBottomPx(clampBottom(dragRef.current.startBottom + dy));
  };

  const onCarryPointerUp = (e) => {
    if (!dragRef.current) return;
    skipClickRef.current = !!dragRef.current?.moved;
    const kind = dragRef.current.kind;
    const moved = dragRef.current.moved;
    const startY = dragRef.current.startY;
    const shouldExpand = minimized && !moved;
    const endX = e.clientX;
    const w = typeof window !== "undefined" ? window.innerWidth : 400;
    if (kind === "dock") {
      if (moved) setDockSide(snapDockFromClientX(endX, w));
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      return;
    }
    if (!minimized && isPhone()) {
      const swipeDown = e.clientY - startY;
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      if (swipeDown > 36) minimize();
      return;
    }
    const edgeDock = dock === "left" ? endX <= 72 : endX >= w - 72;
    if (edgeDock) {
      setIconOnly(true);
      setMinimized(true);
      userPinnedRef.current = "min";
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
    if (shouldExpand && !edgeDock) {
      userPinnedRef.current = "open";
      setMinimized(false);
    }
  };

  const carryPosStyle = isPhone() && !minimized
    ? { bottom: `${dockClearance()}px` }
    : { bottom: bottomPx != null ? `${bottomPx}px` : undefined };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onExtras = (data) => {
      setGift(data?.gift_nifty || null);
      if (data?.vix != null) setVixLive(data.vix);
    };
    return subscribeExtras(onExtras);
  }, []);

  const ist = useMemo(() => getISTParts(now), [now]);
  const events = useMemo(
    () => carryWindowItems(ist.weekday, { indexImpacts }),
    [ist.weekday, indexImpacts],
  );
  const holidayNote = useMemo(() => holidayCarryAdvice(ist.weekday), [ist.weekday]);

  // Auto-show when trigger fires; phone stays a chip unless the user opened it.
  useEffect(() => {
    const key = briefTriggerKey(ist.dateISO, ist.weekday, ist.minutesOfDay);
    if (!key || !shouldAutoShowBrief(ist.weekday, ist.minutesOfDay, ist.dateISO)) {
      setActive(false);
      setMinimized(false);
      setTriggerKey(null);
      userPinnedRef.current = null;
      return;
    }
    setTriggerKey(key);
    const min = readBriefMinimize(key);
    if (userPinnedRef.current === "open") {
      setMinimized(false);
      setActive(true);
      return;
    }
    if (userPinnedRef.current === "min" || min) {
      setMinimized(true);
      setActive(true);
      return;
    }
    setMinimized(isPhone());
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
              atm: data?.current?.atm ?? null,
              pcr: data?.current?.pcr ?? null,
              expiry: data?.current?.expiry ?? null,
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
  const vixNow = (() => {
    const fromLive = vixLive?.last ?? vixLive?.ltp ?? vixLive;
    const raw = vix != null ? vix : fromLive;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const focusEvents = useMemo(() => carryFocusEvents(events), [events]);
  const verdict = useMemo(
    () =>
      carryVerdict({
        biases: biases.map((b) => b.bias).filter(Boolean),
        events,
        giftPct,
        weekday: ist.weekday,
        vix: vixNow,
      }),
    [biases, events, giftPct, ist.weekday, vixNow],
  );
  const advice = sellerCarryAdvice({
    band: verdict.band,
    holidayAdvice: holidayNote,
    vix: vixNow,
    giftPct,
    focusCount: focusEvents.length,
  });
  const orderedBiases = useMemo(() => {
    if (!activeIndex) return biases;
    return [...biases].sort((a, b) => (a.index === activeIndex ? -1 : b.index === activeIndex ? 1 : 0));
  }, [biases, activeIndex]);

  if (!active) return null;

  const bandCls =
    verdict.band === "DO_NOT_CARRY"
      ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100"
      : verdict.band === "REDUCE"
        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100"
        : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100";

  const bandLabel =
    verdict.band === "DO_NOT_CARRY"
      ? "Do not carry shorts"
      : verdict.band === "REDUCE"
        ? "Reduce / hedge shorts"
        : "Carry shorts (sized)";

  const title = "Carry shorts overnight?";

  const dockEdge = dock === "left"
    ? (iconOnly ? "left-1" : "left-3")
    : (iconOnly ? "right-1" : "right-3");
  const expandedDock = dock === "left"
    ? "left-3 right-3 sm:right-auto sm:w-[26rem]"
    : "left-3 right-3 sm:left-auto sm:w-[26rem]";

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
        title="Open carry brief · shorts overnight"
        aria-label="Carry brief"
      >
        <Moon className={iconOnly ? "w-5 h-5" : "w-3.5 h-3.5"} />
        {!iconOnly && (
          <>
            <span>Carry shorts</span>
            <span className="opacity-70 font-mono-data">{verdict.score}/100</span>
            <Maximize2 className="w-3.5 h-3.5 opacity-70" />
          </>
        )}
      </button>
    );
  }

  return (
    <>
    <button
      type="button"
      className="md:hidden fixed z-[60] top-[max(0.5rem,env(safe-area-inset-top))] right-3 h-11 w-11 rounded-full bg-slate-900 text-white shadow-lg inline-flex items-center justify-center"
      onClick={minimize}
      aria-label="Close carry brief"
      data-testid="overnight-gap-brief-close-fab"
    >
      <X className="w-5 h-5" />
    </button>
    <div
      data-testid="overnight-gap-brief"
      data-dock={dock}
      className={`fixed z-40 md:bottom-3 ${expandedDock} flex flex-col rounded-md border-2 shadow-lg overflow-hidden ${bandCls} ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
      style={{
        ...carryPosStyle,
        maxHeight: isPhone()
          ? "min(42dvh, 22rem)"
          : `min(64dvh, calc(100dvh - ${(bottomPx != null ? bottomPx : 16) + 16}px))`,
      }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="flex items-center gap-2 px-2 pt-2 pb-2 shrink-0 bg-slate-900 text-white"
      >
        <button
          type="button"
          className="md:hidden min-h-11 min-w-11 inline-flex items-center justify-center opacity-90 touch-none"
          aria-label="Swipe down to close carry brief"
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
            <div className="text-[10px] uppercase tracking-widest opacity-70">Short options · next open</div>
            <div className="text-sm font-semibold leading-tight">{title}</div>
          </div>
        </div>
        <div className="md:hidden min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest opacity-70">Short options · next open</div>
          <div className="text-sm font-semibold leading-tight">{title}</div>
        </div>
        <button
          type="button"
          onClick={() => setDockSide(dock === "left" ? "right" : "left")}
          className="hidden md:inline-flex opacity-80 hover:opacity-100 p-1.5 rounded"
          aria-label={dock === "left" ? "Move carry brief to the right" : "Move carry brief to the left"}
          title={dock === "left" ? "Move to right" : "Move to left"}
          data-testid="overnight-gap-brief-dock-toggle"
        >
          {dock === "left" ? <PanelRight className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={minimize}
          className="opacity-90 hover:opacity-100 min-h-11 min-w-11 md:min-h-0 md:min-w-0 inline-flex items-center justify-center md:p-1.5 rounded"
          aria-label="Minimize overnight brief until next session"
          title="Minimize until next market open"
          data-testid="overnight-gap-brief-minimize"
        >
          <Minimize2 className="w-5 h-5 md:w-4 md:h-4" />
        </button>
        <button
          type="button"
          onClick={dismissUntilOpen}
          className="opacity-90 hover:opacity-100 min-h-11 min-w-11 md:min-h-0 md:min-w-0 inline-flex items-center justify-center md:p-1.5 rounded"
          aria-label="Close overnight brief"
          data-testid="overnight-gap-brief-dismiss"
        >
          <X className="w-5 h-5 md:w-4 md:h-4" />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2 space-y-2 text-xs overflow-y-auto min-h-0 flex-1">
        <div
          className="flex items-center justify-between gap-2 rounded border border-black/10 dark:border-white/10 bg-white/50 dark:bg-black/20 px-2 py-1.5"
          data-testid="overnight-gap-verdict"
        >
          <span className="font-semibold text-sm">{bandLabel}</span>
          <span className="font-mono-data opacity-70">{verdict.score}/100</span>
        </div>
        <p className="leading-snug opacity-90" data-testid="overnight-gap-advice">
          {advice}
        </p>
        {holidayNote && (
          <div
            className="rounded border border-amber-400/60 bg-amber-100/70 dark:bg-amber-950/40 px-2 py-1.5 text-[11px] leading-snug"
            data-testid="overnight-gap-holiday-note"
          >
            {holidayNote}
          </div>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded bg-white/60 dark:bg-black/25 px-2 py-1.5">
          <span data-testid="overnight-gap-gift">
            <span className="opacity-60 mr-1">GIFT</span>
            {giftPct != null && Number.isFinite(giftPct) ? (
              <span className={`font-mono-data font-semibold ${
                giftPct > 0.05 ? "text-emerald-700" : giftPct < -0.05 ? "text-rose-700" : ""
              }`}>
                {giftPct >= 0 ? "+" : ""}{giftPct.toFixed(2)}%
              </span>
            ) : (
              <span className="opacity-50">—</span>
            )}
          </span>
          <span>
            <span className="opacity-60 mr-1">VIX</span>
            <span className="font-mono-data font-semibold">{vixNow != null ? vixNow.toFixed(1) : "—"}</span>
          </span>
          <span className="opacity-60">{carryHorizonLabel(ist.weekday)}</span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">
            Session OI · which shorts are supported
          </div>
          {loading && biases.length === 0 ? (
            <div className="opacity-60">Loading session OI…</div>
          ) : (
            <div className="space-y-1" data-testid="overnight-gap-biases">
              {orderedBiases.map((row) => {
                const line = writerBiasLine(row);
                const on = row.index === activeIndex;
                return (
                  <div
                    key={row.index}
                    className={`rounded px-2 py-1 ${on ? "bg-white dark:bg-black/40 ring-1 ring-black/10" : "bg-white/60 dark:bg-black/25"}`}
                    data-testid={`overnight-bias-${row.index}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold shrink-0">{row.index}</span>
                      {row.atm != null && (
                        <span className="font-mono-data opacity-60 text-[10px]">ATM {row.atm}</span>
                      )}
                      {row.pcr != null && Number.isFinite(Number(row.pcr)) && (
                        <span className="font-mono-data opacity-60 text-[10px]">PCR {Number(row.pcr).toFixed(2)}</span>
                      )}
                      {row.bias ? (
                        <span className="ml-auto font-mono-data opacity-60 text-[10px]">
                          PE {fmtDelta(row.bias.pe)} · CE {fmtDelta(row.bias.ce)}
                        </span>
                      ) : null}
                    </div>
                    <div className="opacity-80 leading-snug">{line.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Into the next open
          </div>
          {focusEvents.length === 0 ? (
            <div className="opacity-60 px-1">No holiday or heavy index-impact in the carry window.</div>
          ) : (
            <ul className="space-y-0.5" data-testid="overnight-gap-events">
              {focusEvents.map((e) => (
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
    </>
  );
}
