import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Moon, AlertTriangle, Minimize2, Maximize2, GripHorizontal, AlignLeft, AlignCenter, AlignRight, Sparkles } from "lucide-react";
import { api, fetchOIChange, subscribeExtras } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import {
  CARRY_PANEL_WIDTH,
  clampCarryLeft,
  readCarryLeft,
  snapCarryLeft,
  snapDockFromClientX,
  writeCarryLeft,
} from "@/lib/carryDock";
import { carryCase, eventDisplayName, sellerCarryAdvice, summarizeBook, writerBiasLine } from "@/lib/carryFocus";
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
import { DESK_IDS } from "@/lib/universe";

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

const CARRY_AI_KEY = "oiCarryDeskAi";

function readCarryAi() {
  try { return localStorage.getItem(CARRY_AI_KEY) === "1"; } catch { return false; }
}

function writeCarryAi(on) {
  try { localStorage.setItem(CARRY_AI_KEY, on ? "1" : "0"); } catch { /* noop */ }
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
 * Desktop: drag the header horizontally (left / middle / right) or use snap buttons.
 * Phone: chip by default; expanded sheet is full-width at the dock (not over the chart).
 */
export default function OvernightGapBrief({
  indices = DESK_IDS,
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
  const [leftPx, setLeftPx] = useState(() => readCarryLeft());
  const [vixLive, setVixLive] = useState(null);
  const [book, setBook] = useState(null);
  const [guide, setGuide] = useState(null);
  const [carryAi, setCarryAi] = useState(() => readCarryAi());
  const dragRef = useRef(null);
  const skipClickRef = useRef(false);
  const userPinnedRef = useRef(null);

  const setLeft = (px) => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const next = clampCarryLeft(px, w, isPhone() ? 280 : CARRY_PANEL_WIDTH);
    setLeftPx(next);
    writeCarryLeft(next);
  };

  const snap = (mode) => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    setLeft(snapCarryLeft(mode, w, isPhone() ? 280 : CARRY_PANEL_WIDTH));
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
    if (kind === "move" && !desktop) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startBottom = bottomPx != null ? bottomPx : dockClearance();
    const startLeft = leftPx != null ? leftPx : 12;
    dragRef.current = { kind, startY: e.clientY, startX: e.clientX, startBottom, startLeft, moved: false };
  };

  const onCarryPointerMove = (e) => {
    if (!dragRef.current) return;
    if (Math.abs(e.clientY - dragRef.current.startY) > 6 || Math.abs(e.clientX - dragRef.current.startX) > 6) {
      dragRef.current.moved = true;
    }
    const kind = dragRef.current.kind;
    if (kind === "move" || kind === "both") {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const panel = minimized || isPhone() ? 72 : CARRY_PANEL_WIDTH;
      setLeftPx(clampCarryLeft(dragRef.current.startLeft + (e.clientX - dragRef.current.startX), w, panel));
      if (kind === "move") return;
    }
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
    if (kind === "move" || kind === "both") {
      if (moved && leftPx != null) writeCarryLeft(leftPx);
      if (kind === "move") {
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
        return;
      }
    }
    if (!minimized && isPhone()) {
      const swipeDown = e.clientY - startY;
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      if (swipeDown > 36) minimize();
      return;
    }
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    setBottomPx((prev) => {
      const next = clampBottom(prev != null ? prev : dockClearance());
      writeCarryBottom(next);
      return next;
    });
    if (shouldExpand) {
      userPinnedRef.current = "open";
      setMinimized(false);
    }
  };

  const carryPosStyle = (() => {
    const bottom = isPhone() && !minimized
      ? `${dockClearance()}px`
      : (bottomPx != null ? `${bottomPx}px` : undefined);
    if (isPhone() && !minimized) return { bottom };
    const left = leftPx != null ? `${leftPx}px` : "12px";
    return { bottom, left, right: "auto" };
  })();

  useEffect(() => {
    if (leftPx != null) return;
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const n = clampCarryLeft(12, w, CARRY_PANEL_WIDTH);
    setLeftPx(n);
    writeCarryLeft(n);
  }, [leftPx]);

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
      const rows = [];
      for (const idx of indices) {
        try {
          const data = await fetchOIChange(idx, 15, { also: "session" });
          const sessPrev = data?.also_windows?.session?.previous;
          const bias = sessionBiasFromSnapshots(data?.current, sessPrev);
          rows.push({
            index: idx,
            bias,
            minutes: data?.also_windows?.session?.minutes ?? null,
            price: data?.current?.price ?? null,
            atm: data?.current?.atm ?? null,
            pcr: data?.current?.pcr ?? null,
            expiry: data?.current?.expiry ?? null,
          });
        } catch {
          rows.push({ index: idx, bias: null, minutes: null, price: null });
        }
      }
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

  const loadBook = useCallback(async () => {
    if (!active || minimized) return;
    try {
      const { data } = await api.get("/positions");
      setBook(summarizeBook(data?.positions || []));
    } catch {
      setBook(null);
    }
  }, [active, minimized]);

  useEffect(() => {
    loadBook();
    if (!active || minimized) return undefined;
    const id = setInterval(loadBook, 60_000);
    return () => clearInterval(id);
  }, [loadBook, active, minimized]);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings")
      .then((r) => {
        if (cancelled || typeof r.data?.desk_ai_carry !== "boolean") return;
        setCarryAi(r.data.desk_ai_carry);
        writeCarryAi(r.data.desk_ai_carry);
      })
      .catch(() => { /* keep local */ });
    return () => { cancelled = true; };
  }, []);

  const toggleCarryAi = (on) => {
    setCarryAi(!!on);
    writeCarryAi(!!on);
    api.post("/desk-ai", { desk_ai_carry: !!on }).catch(() => { /* local still applies */ });
  };

  const giftPct = gift?.change_pct != null ? Number(gift.change_pct) : null;
  const vixNow = (() => {
    const fromLive = vixLive?.last ?? vixLive?.ltp ?? vixLive;
    const raw = vix != null ? vix : fromLive;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const kase = useMemo(
    () =>
      carryCase({
        weekday: ist.weekday,
        vix: vixNow,
        giftPct,
        biases,
        events,
        book,
        holidayAdvice: holidayNote,
      }),
    [ist.weekday, vixNow, giftPct, biases, events, book, holidayNote],
  );
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
    focusCount: kase.results.length + kase.holidays.length,
  });
  const orderedBiases = useMemo(() => {
    if (!activeIndex) return biases;
    return [...biases].sort((a, b) => (a.index === activeIndex ? -1 : b.index === activeIndex ? 1 : 0));
  }, [biases, activeIndex]);

  const payloadRef = useRef({});
  payloadRef.current = {
    why: kase.why,
    whyNot: kase.whyNot,
    results: kase.results,
    holidays: kase.holidays,
    book,
    vix: vixNow,
    giftPct,
    weekday: ist.weekday,
    band: verdict.band,
  };

  useEffect(() => {
    if (!active || minimized || !carryAi || isPhone()) {
      setGuide(null);
      return undefined;
    }
    let cancelled = false;
    const run = async () => {
      const p = payloadRef.current;
      try {
        const { data } = await api.post("/desk-guide", {
          surface: "carry",
          why: p.why,
          whyNot: p.whyNot,
          results: (p.results || []).map((e) => ({
            name: eventDisplayName(e),
            date: e.date,
            daysAway: e.daysAway,
            index: e.index,
          })),
          holidays: (p.holidays || []).map((e) => ({ name: eventDisplayName(e), date: e.date })),
          book: p.book,
          vix: p.vix,
          giftPct: p.giftPct,
          weekday: p.weekday,
          band: p.band,
        });
        if (!cancelled) setGuide(data || null);
      } catch {
        if (!cancelled) setGuide(null);
      }
    };
    run();
    const id = setInterval(run, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, minimized, carryAi]);

  if (!active) return null;

  const bandCls =
    verdict.band === "DO_NOT_CARRY"
      ? "border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100"
      : verdict.band === "REDUCE"
        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100"
        : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100";

  const bandLabel =
    verdict.band === "DO_NOT_CARRY"
      ? "Do not hold overnight"
      : verdict.band === "REDUCE"
        ? "Reduce overnight size"
        : "Overnight hold is sized";

  const title = "Hold overnight?";
  const dockHint = snapDockFromClientX(
    (leftPx ?? 12) + 80,
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  const guideText = (() => {
    const raw = (guide?.guide || "").trim();
    if (!raw) return "";
    if (/WHAT CHANGED|OPTION BUYER|OPTION SELLER|WHY IT MATTERS/i.test(raw)) return "";
    return raw;
  })();
  const phoneOpen = typeof window !== "undefined" && isPhone();

  if (minimized) {
    return (
      <button
        type="button"
        data-testid="overnight-gap-brief-chip"
        data-icon-only={iconOnly ? "1" : "0"}
        data-dock={dockHint}
        onClick={() => {
          if (skipClickRef.current) {
            skipClickRef.current = false;
            return;
          }
          expand();
        }}
        className={`fixed z-40 md:bottom-3 flex items-center rounded-full border-2 shadow-lg text-xs font-semibold touch-none ${bandCls} ${
          iconOnly ? "p-2.5" : "gap-2 px-3 py-2"
        } ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
        style={carryPosStyle}
        onPointerDown={(e) => onCarryPointerDown(e, "both")}
        onPointerMove={onCarryPointerMove}
        onPointerUp={onCarryPointerUp}
        onPointerCancel={onCarryPointerUp}
        title="Open carry brief · drag to move"
        aria-label="Carry brief"
      >
        <Moon className={iconOnly ? "w-5 h-5" : "w-3.5 h-3.5"} />
        {!iconOnly && (
          <>
            <span>Overnight</span>
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
      data-dock={dockHint}
      className={`fixed z-40 md:bottom-3 flex flex-col rounded-xl border-2 shadow-lg ${bandCls} ${
        phoneOpen ? "left-3 right-3" : ""
      } ${bottomPx == null ? "bottom-[3.25rem] md:bottom-3" : ""}`}
      style={{
        ...carryPosStyle,
        ...(phoneOpen
          ? {}
          : {
              width: `min(${CARRY_PANEL_WIDTH}px, calc(100vw - 16px))`,
              maxHeight: "min(28rem, calc(100vh - 20px))",
            }),
      }}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-current/15">
        <button
          type="button"
          className="md:hidden p-1 opacity-70 touch-none"
          aria-label="Swipe down to close carry brief"
          data-testid="overnight-gap-brief-drag"
          onPointerDown={(e) => onCarryPointerDown(e, "mobile")}
          onPointerMove={onCarryPointerMove}
          onPointerUp={onCarryPointerUp}
          onPointerCancel={onCarryPointerUp}
        >
          <GripHorizontal className="w-4 h-4" />
        </button>
        <div
          className="hidden md:flex items-center gap-1.5 min-w-0 flex-1 cursor-grab active:cursor-grabbing touch-none"
          data-testid="overnight-gap-brief-dock-drag"
          onPointerDown={(e) => onCarryPointerDown(e, "move")}
          onPointerMove={onCarryPointerMove}
          onPointerUp={onCarryPointerUp}
          onPointerCancel={onCarryPointerUp}
          title="Drag anywhere horizontally"
        >
          <Moon className="w-4 h-4 shrink-0 opacity-80" />
          <div className="min-w-0 text-sm font-semibold leading-tight">{title}</div>
        </div>
        <div className="md:hidden min-w-0 flex-1 text-sm font-semibold leading-tight">{title}</div>
        <label
          className="hidden md:inline-flex items-center gap-1.5 shrink-0 text-[10px] font-bold uppercase tracking-widest"
          data-testid="overnight-gap-ai-toggle"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI
          <Switch
            checked={!!carryAi}
            onCheckedChange={toggleCarryAi}
            className="scale-90 origin-center"
            data-testid="overnight-gap-ai-switch"
          />
        </label>
        <div className="hidden md:inline-flex items-center rounded-md bg-white/50 dark:bg-black/20 p-0.5" data-testid="overnight-gap-brief-dock-toggle">
          <button type="button" onClick={() => snap("left")} className="p-1 rounded opacity-80 hover:opacity-100" aria-label="Snap carry brief left" title="Left">
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => snap("center")} className="p-1 rounded opacity-80 hover:opacity-100" aria-label="Snap carry brief to center" title="Center">
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => snap("right")} className="p-1 rounded opacity-80 hover:opacity-100" aria-label="Snap carry brief right" title="Right">
            <AlignRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={minimize}
          className="opacity-80 hover:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded"
          aria-label="Minimize overnight brief until next session"
          title="Minimize until next market open"
          data-testid="overnight-gap-brief-minimize"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={dismissUntilOpen}
          className="opacity-80 hover:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded"
          aria-label="Close overnight brief"
          data-testid="overnight-gap-brief-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-2.5 pb-2.5 pt-1.5 space-y-1.5 text-xs md:overflow-y-auto">
        <div
          className="flex items-center justify-between gap-2 rounded-md bg-white/70 dark:bg-black/20 px-2 py-1"
          data-testid="overnight-gap-verdict"
        >
          <span className="font-semibold">{bandLabel}</span>
          <span className="font-mono-data opacity-70">{verdict.score}/100</span>
        </div>
        <p className="leading-snug opacity-90" data-testid="overnight-gap-advice">
          {advice}
        </p>

        {guideText && carryAi && !phoneOpen ? (
          <div
            className="rounded-md border border-violet-400/70 bg-violet-50/90 dark:bg-violet-950/40 px-2 py-1.5 leading-snug font-medium max-h-24 overflow-y-auto"
            data-testid="overnight-gap-guide"
          >
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-violet-800 dark:text-violet-200 mb-0.5 font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              Desk AI · {guide?.source === "llm" ? "Live GPT" : "rules"}
            </div>
            {guideText}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" data-testid="overnight-gap-case">
          <div className="rounded-md bg-white/70 dark:bg-black/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Why carry</div>
            <ul className="space-y-1 leading-snug">
              {kase.why.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md bg-white/70 dark:bg-black/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Why not</div>
            <ul className="space-y-1 leading-snug">
              {kase.whyNot.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-0.5" data-testid="overnight-gap-gift">
          <span>
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
          <span className="opacity-70">{carryHorizonLabel(ist.weekday)}</span>
          {book?.shortCount != null ? (
            <span className="opacity-70">Book {book.shortCount} short{book.shortCount === 1 ? "" : "s"}</span>
          ) : null}
        </div>

        <div data-testid="overnight-gap-biases">
          {loading && biases.length === 0 ? (
            <div className="opacity-60">Loading session OI…</div>
          ) : (
            <div className="space-y-0.5">
              {orderedBiases.map((row) => {
                const line = writerBiasLine(row);
                const on = row.index === activeIndex;
                const bag = book?.byIndex?.[row.index];
                return (
                  <div
                    key={row.index}
                    className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-0.5 ${on ? "bg-white/80 dark:bg-black/30" : ""}`}
                    data-testid={`overnight-bias-${row.index}`}
                  >
                    <span className="font-semibold w-[5.5rem] shrink-0">{row.index}</span>
                    <span className="font-medium">{line.short}</span>
                    {row.bias ? (
                      <span className="ml-auto font-mono-data opacity-60 text-[10px]">
                        PE {fmtDelta(row.bias.pe)} · CE {fmtDelta(row.bias.ce)}
                      </span>
                    ) : (
                      <span className="ml-auto opacity-50">—</span>
                    )}
                    {bag ? (
                      <span className="w-full sm:w-auto sm:ml-0 text-[10px] opacity-60">
                        You: {bag.pe} PE short{bag.pe === 1 ? "" : "s"} · {bag.ce} CE
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-0.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Results &amp; next open
          </div>
          {kase.results.length === 0 && kase.holidays.length === 0 && kase.other.length === 0 ? (
            <div className="opacity-60 px-0.5">No holiday or heavy index-impact in the carry window.</div>
          ) : (
            <ul className="space-y-1" data-testid="overnight-gap-events">
              {kase.results.map((e) => (
                <li key={`r|${e.date}|${e.name}`} className="leading-snug px-0.5 break-words">
                  <span className="font-medium">Result · {dayLabel(e.daysAway, ist.weekday)}</span>
                  {" · "}
                  {eventDisplayName(e)}
                </li>
              ))}
              {kase.holidays.map((e) => (
                <li key={`h|${e.date}|${e.name}`} className="leading-snug px-0.5 break-words">
                  <span className="font-medium">Holiday · {dayLabel(e.daysAway, ist.weekday)}</span>
                  {" · "}
                  {eventDisplayName(e)}
                </li>
              ))}
              {kase.other.map((e) => (
                <li key={`o|${e.date}|${e.name}`} className="leading-snug px-0.5 break-words">
                  <span className="font-medium">{dayLabel(e.daysAway, ist.weekday)}</span>
                  {" · "}
                  {eventDisplayName(e)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
