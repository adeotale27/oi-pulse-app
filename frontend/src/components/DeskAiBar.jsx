import { ChevronDown, ChevronUp, GripHorizontal, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fetchOIChange, fetchJournalPeriod, fetchExtras } from "@/lib/api";
import { upcomingHolidays, todayIST } from "@/lib/holidays";
import { eventDisplayName } from "@/lib/carryFocus";
import { compactBookFromPositions, compactJournalFromPeriod, daysAgoIST, summarizeIndexTape } from "@/lib/deskAiTape";
import { cashSessionFocusIndex, cashSessionFocusLabel, filterCashHeavyMovers, istWeekdaySun0, overnightBiasIndices } from "@/lib/deskFocus";
import MarketIntelCard from "@/components/MarketIntelCard";

const GRID_H_KEY = "oiDeskAiStripH";
const GRID_OPEN_KEY = "oiDeskAiStripOpen";
const MIN_H = 88;
const MAX_H = 280;

function loadHeight() {
  try {
    const n = Number(localStorage.getItem(GRID_H_KEY));
    if (Number.isFinite(n)) return Math.min(MAX_H, Math.max(MIN_H, n));
  } catch { /* noop */ }
  return 140;
}

function loadOpen() {
  try {
    return localStorage.getItem(GRID_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DeskAiBar({
  activeIndex,
  visible = true,
  askAi = true,
  variant = "strip",
  onOpenPanel,
}) {
  const [guide, setGuide] = useState(null);
  const [meta, setMeta] = useState(null);
  const [outside, setOutside] = useState(null);
  const [intel, setIntel] = useState({ oi: [], book: null, adjust: null, journal: null });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => variant === "panel" || loadOpen());
  const [height, setHeight] = useState(loadHeight);
  const drag = useRef(null);

  const run = useCallback(async (force = false) => {
    if (!visible) return;
    setBusy(true);
    try {
      const weekday = istWeekdaySun0();
      const focusIndex = cashSessionFocusIndex(weekday);
      const names = overnightBiasIndices(weekday, activeIndex).slice(0, 3);
      const today = todayIST();
      const [st, outRes, evRes, posRes, extrasRes, journalRes, ...oiPacks] = await Promise.all([
        api.get("/desk-guide").catch(() => ({ data: null })),
        api.get("/desk-outside", { params: activeIndex ? { index: activeIndex } : {} }).catch(() => ({ data: null })),
        api.get(`/events/${focusIndex}`).catch(() => ({ data: null })),
        api.get("/positions").catch(() => ({ data: null })),
        fetchExtras().catch(() => null),
        fetchJournalPeriod(daysAgoIST(30, today), today, "ALL").catch(() => null),
        ...names.map((idx) => fetchOIChange(idx, 15, { also: "session" }).catch(() => null)),
      ]);
      setMeta(st.data);
      const rawOut = outRes.data || null;
      if (rawOut && Array.isArray(rawOut.movers)) {
        rawOut.movers = filterCashHeavyMovers(rawOut.movers);
      }
      setOutside(rawOut);
      const holidays = upcomingHolidays().slice(0, 6).map((h) => ({ name: h.name, date: h.date }));
      const events = (evRes.data?.events || []).slice(0, 8);
      const packed = compactBookFromPositions(posRes.data);
      const oi = oiPacks
        .map((data) => summarizeIndexTape(data?.current, data?.also_windows?.session?.previous || data?.previous))
        .filter(Boolean);
      const journal = compactJournalFromPeriod(journalRes);
      const vix = extrasRes?.vix?.last ?? extrasRes?.vix?.ltp ?? extrasRes?.vix;
      setIntel({ oi, book: packed.book, adjust: packed.adjust, journal });
      const { data } = await api.post("/desk-guide", {
        surface: "desk",
        force: !!force,
        skip_llm: !askAi || !force,
        index: focusIndex,
        session_focus: focusIndex,
        weekday,
        vix: vix != null ? Number(vix) : undefined,
        holidays,
        results: events.map((e) => ({
          name: eventDisplayName(e) || e.name,
          date: e.date,
          daysAway: e.days_remaining ?? e.daysAway,
          index: e.index || focusIndex,
        })),
        book: packed.book,
        adjust: packed.adjust,
        oi,
        journal,
        outside: rawOut,
      });
      setGuide(data);
    } catch {
      /* keep last */
    } finally {
      setBusy(false);
    }
  }, [activeIndex, visible, askAi, variant]);

  useEffect(() => {
    if (!visible || !open) return undefined;
    run(false);
    const id = setInterval(() => run(false), 45 * 1000);
    return () => clearInterval(id);
  }, [run, visible, open]);

  useEffect(() => {
    if (variant !== "strip") return undefined;
    const expand = () => {
      setOpen(true);
      try { localStorage.setItem(GRID_OPEN_KEY, "1"); } catch { /* noop */ }
    };
    window.addEventListener("oi-desk-ai-expand", expand);
    return () => window.removeEventListener("oi-desk-ai-expand", expand);
  }, [variant]);

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(GRID_OPEN_KEY, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  };

  const onDragStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    drag.current = { startY, startH };
    const onMove = (ev) => {
      if (!drag.current) return;
      const next = Math.min(MAX_H, Math.max(MIN_H, drag.current.startH + (ev.clientY - drag.current.startY)));
      setHeight(next);
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setHeight((h) => {
        try { localStorage.setItem(GRID_H_KEY, String(h)); } catch { /* noop */ }
        return h;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!visible) return null;

  const source = guide?.source === "llm" ? "AI" : "rules";
  const llmLive = source === "AI";
  const movers = filterCashHeavyMovers(outside?.movers || []);
  const briefing = (outside?.briefing || guide?.guide || "").trim();
  const isPanel = variant === "panel";
  const focusChip = cashSessionFocusLabel(istWeekdaySun0());

  const chrome = (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
      <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-emerald-50">
        Desk AI
      </span>
      <span
        className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-white text-emerald-800 dark:bg-slate-900 dark:text-emerald-200 dark:border-emerald-800"
        data-testid="desk-ai-session-focus"
        title="Weekly option calendar: Mon–Tue NIFTY, Wed–Thu SENSEX. Heavyweights stay NIFTY + BANKNIFTY."
      >
        {focusChip}
      </span>
      <span
        className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${
          llmLive
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-slate-300 bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        }`}
        data-testid="desk-ai-source"
      >
        {llmLive ? "Live GPT" : "Rules"}
      </span>
      {askAi ? (
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-sm border border-emerald-300 bg-white text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60 dark:bg-slate-800 dark:text-emerald-200 dark:border-emerald-700 cursor-pointer"
          data-testid="desk-ai-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          Ask AI
        </button>
      ) : null}
      {!isPanel && typeof onOpenPanel === "function" ? (
        <button
          type="button"
          onClick={onOpenPanel}
          className="hidden md:inline-flex h-7 px-2 rounded-sm border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          data-testid="desk-ai-open-panel"
        >
          Side panel
        </button>
      ) : null}
      {!isPanel ? (
        <button
          type="button"
          onClick={toggleOpen}
          className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-sm text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 cursor-pointer"
          data-testid="desk-ai-toggle"
          aria-expanded={open}
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );

  const peek = !isPanel && !open ? (
    <div className="mt-1 flex items-center gap-1.5 min-w-0" data-testid="desk-ai-peek">
      <div className="flex flex-wrap gap-1 min-w-0 flex-1 overflow-hidden max-h-6">
        {movers.slice(0, 4).map((m) => {
          const up = Number(m.pct) >= 0;
          return (
            <span
              key={`${m.index}-${m.symbol}`}
              className={`rounded-sm border px-1 py-0 font-mono-data text-[10px] ${
                up ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {m.symbol} {up ? "+" : ""}{Number(m.pct || 0).toFixed(1)}%
            </span>
          );
        })}
        {!movers.length ? (
          <span className="text-[11px] text-slate-500 truncate">{outside?.note || "Outside OI — tap More"}</span>
        ) : null}
      </div>
      {briefing ? (
        <p className="hidden sm:block min-w-0 flex-1 truncate text-[11px] text-slate-600">{briefing}</p>
      ) : null}
    </div>
  ) : null;

  const body = (isPanel || open) ? (
    <div
      className={isPanel ? "flex-1 min-h-0 overflow-y-auto mt-2" : "overflow-y-auto mt-1.5"}
      style={isPanel ? undefined : { height }}
    >
      <MarketIntelCard
        outside={outside}
        guide={guide}
        compact={!isPanel}
        oi={intel.oi}
        book={intel.book}
        adjust={intel.adjust}
        journal={intel.journal}
        title={isPanel ? "Market intelligence" : "Outside the OI chart"}
      />
    </div>
  ) : null;

  if (isPanel) {
    return (
      <section
        id="desk-ai-bar"
        data-testid="desk-ai-bar"
        className="h-full min-h-0 flex flex-col rounded-md border border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white dark:from-emerald-950/30 dark:to-slate-900 px-2.5 py-2"
      >
        {chrome}
        {body}
      </section>
    );
  }

  return (
    <section
      id="desk-ai-bar"
      data-testid="desk-ai-bar"
      className="shrink-0 mb-1.5 rounded-md border border-emerald-200 bg-white/90 shadow-[0_1px_0_rgba(15,55,70,0.04)] dark:bg-emerald-950/20 dark:border-emerald-800 px-2.5 py-1.5"
    >
      {chrome}
      {peek}
      {body}
      {open ? (
        <button
          type="button"
          aria-label="Resize Desk AI"
          data-testid="desk-ai-resize"
          onPointerDown={onDragStart}
          className="flex w-full items-center justify-center h-3 cursor-ns-resize touch-none text-emerald-400 hover:text-emerald-700"
        >
          <GripHorizontal className="w-4 h-4" />
        </button>
      ) : null}
    </section>
  );
}
