import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";
import { INDEX_CHIP_CAP } from "@/lib/universe";
import { pickIndexLtp } from "@/lib/indexQuotes";
import InfoTip from "@/components/InfoTip";
import { getTickerRegime, TICKER_REGIME_GUIDE as REGIME_GUIDE, tickerRegimeLabel } from "@/lib/tickerRegime";

function fmtNum(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtLtp(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v)) || Number(v) === 0) return "—";
  return fmtNum(v, dp);
}

// Per-index visual identity — match Sidebar INDEX_THEME (sky / amber / emerald).
const INDEX_STYLE = {
  NIFTY: {
    label: "NIFTY 50",
    short: "NIFTY",
    dot: "bg-sky-500",
    selectedBorder: "border-sky-500",
    idleShell: "bg-gradient-to-br from-sky-50 to-cyan-50 text-sky-900 border-sky-100 hover:from-sky-100 hover:to-cyan-100",
    activeShell: "bg-gradient-to-br from-sky-500 to-cyan-600 text-white border-sky-500 shadow-md shadow-sky-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  GIFTNIFTY: {
    label: "GIFT NIFTY",
    short: "GIFTN",
    dot: "bg-violet-500",
    selectedBorder: "border-violet-500",
    idleShell: "bg-gradient-to-br from-violet-50 to-indigo-50 text-violet-900 border-violet-100 hover:from-violet-100 hover:to-indigo-100",
    activeShell: "bg-gradient-to-br from-violet-500 to-indigo-600 text-white border-violet-500 shadow-md shadow-violet-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  SENSEX: {
    label: "SENSEX",
    short: "SENSEX",
    dot: "bg-orange-500",
    selectedBorder: "border-orange-500",
    idleShell: "bg-gradient-to-br from-amber-50 to-orange-50 text-orange-800 border-orange-100 hover:from-amber-100 hover:to-orange-100",
    activeShell: "bg-gradient-to-br from-amber-500 to-orange-600 text-white border-orange-500 shadow-md shadow-orange-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  BANKNIFTY: {
    label: "BANK NIFTY",
    short: "BNF",
    dot: "bg-emerald-500",
    selectedBorder: "border-emerald-500",
    idleShell: "bg-gradient-to-br from-emerald-50 to-teal-50 text-teal-800 border-teal-100 hover:from-emerald-100 hover:to-teal-100",
    activeShell: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-emerald-500 shadow-md shadow-emerald-500/20",
    idleChgUp: "text-emerald-800",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  CRUDEOIL: {
    label: "CRUDE OIL",
    short: "CRUDE",
    dot: "bg-slate-600",
    selectedBorder: "border-slate-500",
    idleShell: "bg-gradient-to-br from-slate-50 to-zinc-100 text-slate-800 border-slate-200 hover:from-slate-100",
    activeShell: "bg-gradient-to-br from-slate-600 to-zinc-700 text-white border-slate-600 shadow-md shadow-slate-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  GOLD: {
    label: "GOLD",
    short: "GOLD",
    dot: "bg-yellow-500",
    selectedBorder: "border-yellow-500",
    idleShell: "bg-gradient-to-br from-yellow-50 to-amber-50 text-amber-900 border-yellow-200 hover:from-yellow-100",
    activeShell: "bg-gradient-to-br from-yellow-500 to-amber-600 text-white border-yellow-500 shadow-md shadow-yellow-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  SILVER: {
    label: "SILVER",
    short: "SILVER",
    dot: "bg-zinc-400",
    selectedBorder: "border-zinc-400",
    idleShell: "bg-gradient-to-br from-zinc-50 to-slate-100 text-zinc-800 border-zinc-200 hover:from-zinc-100",
    activeShell: "bg-gradient-to-br from-zinc-500 to-slate-600 text-white border-zinc-500 shadow-md shadow-zinc-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
  NATURALGAS: {
    label: "NATURAL GAS",
    short: "NG",
    dot: "bg-cyan-600",
    selectedBorder: "border-cyan-500",
    idleShell: "bg-gradient-to-br from-cyan-50 to-sky-50 text-cyan-900 border-cyan-200 hover:from-cyan-100",
    activeShell: "bg-gradient-to-br from-cyan-600 to-sky-700 text-white border-cyan-600 shadow-md shadow-cyan-500/20",
    idleChgUp: "text-emerald-700",
    idleChgDn: "text-rose-700",
    activeChg: "text-white/90",
  },
};

function useDragScroll(ref, enabled) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      el.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      el.scrollLeft = startScroll - dx;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = enabled ? "grab" : "";
      if (moved) {
        e.preventDefault();
        const block = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          el.removeEventListener("click", block, true);
        };
        el.addEventListener("click", block, true);
      }
    };
    el.style.cursor = "grab";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.style.cursor = "";
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [ref, enabled]);
}

function headerTileTone(indexKey, up, flat, isActive) {
  const s = INDEX_STYLE[indexKey] || INDEX_STYLE.NIFTY;
  if (isActive) {
    return {
      shell: s.activeShell,
      label: "text-white",
      price: "text-white",
      chg: flat ? "text-white/80" : s.activeChg,
    };
  }
  return {
    shell: s.idleShell,
    label: "",
    price: "text-slate-950",
    chg: flat ? "text-slate-500" : up ? s.idleChgUp : s.idleChgDn,
  };
}

function regimeChip(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null) {
  return tickerRegimeLabel(getTickerRegime(changePct, isFlat, prevClose, dayHigh, dayLow, ltp));
}

export default function TickerStrip({ onSelectIndex, activeIndex, spotPrices = {}, dense = false, layout = "default", tickers: tickersProp = null, enabledIndices = null }) {
  const [tickersLocal, setTickersLocal] = useState([]);
  const [loadingLocal, setLoadingLocal] = useState(tickersProp == null);
  const owned = tickersProp != null;
  const tickers = owned ? tickersProp : tickersLocal;
  const loading = owned ? tickers.length === 0 : loadingLocal;
  const scrollerRef = useRef(null);
  const isHeader = layout === "header";
  const isRail = layout === "rail";

  useEffect(() => {
    if (tickersProp != null) {
      return undefined;
    }
    let cancelled = false;
    async function loadTickersOnce() {
      try {
        const { data } = await api.get("/tickers");
        if (!cancelled) setTickersLocal(data.tickers || []);
      } catch (_e) { /* silent */ }
      finally {
        if (!cancelled) setLoadingLocal(false);
      }
    }
    try {
      const closed = isMarketQuiescent();
      loadTickersOnce();
      if (!closed) {
        const id = setInterval(loadTickersOnce, 300000);
        return () => { cancelled = true; clearInterval(id); };
      }
    } catch {
      loadTickersOnce();
      const id = setInterval(loadTickersOnce, 300000);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [tickersProp]);

  const displayTickers = useMemo(() => {
    return tickers.map((t) => {
      const ltp = pickIndexLtp({ idx: t.index, live: spotPrices[t.index], tickerLtp: t.ltp });
      const prevClose = t.prev_close || (t.ltp && Number(t.ltp) !== 0 ? t.ltp : 0) || 0;
      const change = ltp != null && prevClose ? ltp - prevClose : 0;
      const change_pct = prevClose ? (change / prevClose) * 100 : 0;
      return { ...t, ltp, change, change_pct };
    });
  }, [tickers, spotPrices]);

  const many = displayTickers.length > INDEX_CHIP_CAP;
  useDragScroll(scrollerRef, many && (isHeader || isRail));
  const enabledSet = Array.isArray(enabledIndices) && enabledIndices.length
    ? new Set(enabledIndices)
    : null;
  const indexSelectable = (idx) => !enabledSet || enabledSet.has(idx);

  if (loading && !tickers.length) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 py-1">Loading tickers…</div>
    );
  }

  // Slim status-rail: Sensibull-style quote — NAME arrow PRICE chg (pct%)
  if (isRail) {
    return (
      <div
        ref={scrollerRef}
        className={`flex flex-nowrap items-center gap-0.5 min-w-0 overflow-x-auto overscroll-x-contain oi-hover-scroll ${many ? "snap-x snap-mandatory" : ""}`}
        data-testid="ticker-strip"
      >
        {displayTickers.map((t) => {
          const s = INDEX_STYLE[t.index] || INDEX_STYLE.NIFTY;
          const up = t.change > 0;
          const flat = Math.abs(t.change) < 0.01 || t.ltp == null || Number(t.ltp) === 0;
          const toneCls = flat ? "text-slate-600 dark:text-slate-300" : up ? "text-emerald-600" : "text-rose-600";
          const isActive = t.index === activeIndex;
          const selectable = indexSelectable(t.index);
          const shortLabel = s.short;
          const ltpLabel = fmtLtp(t.ltp, 2);
          const Arrow = flat ? Minus : up ? TrendingUp : TrendingDown;
          const regime = getTickerRegime(t.change_pct, flat, t.prev_close, t.day_high, t.day_low, t.ltp);
          const Tag = selectable ? "button" : "div";
          return (
            <div
              key={t.index}
              className={`inline-flex items-center gap-0.5 shrink-0 ${many ? "snap-start" : ""}`}
            >
            <Tag
              type={selectable ? "button" : undefined}
              onClick={selectable ? () => onSelectIndex?.(t.index) : undefined}
              data-testid={`ticker-${t.index}`}
              aria-disabled={selectable ? undefined : "true"}
            title={selectable
              ? `Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`
              : `${s.label} is on the quote strip but not enabled for the desk`}
              className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-sm border text-[11px] tabular-nums transition-colors ${
                !selectable
                  ? "border-transparent"
                  : isActive
                  ? `${s.selectedBorder} border-2 bg-white shadow-sm dark:bg-slate-900`
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-800 dark:text-slate-100">
                {shortLabel}
              </span>
              <Arrow className={`w-3 h-3 shrink-0 ${toneCls}`} strokeWidth={2.5} aria-hidden />
              <span
                className="font-semibold text-slate-950 dark:text-slate-50"
                data-testid={`ticker-${t.index}-ltp`}
              >
                {ltpLabel}
              </span>
              <span className={toneCls} data-testid={`ticker-${t.index}-chg`}>
                {flat || ltpLabel === "—"
                  ? ""
                  : `${t.change > 0 ? "+" : ""}${fmtNum(t.change, 2)}`}
              </span>
              <span className={toneCls} data-testid={`ticker-${t.index}-pct`}>
                {flat || ltpLabel === "—"
                  ? "(0.00%)"
                  : `(${t.change_pct > 0 ? "+" : ""}${fmtNum(t.change_pct, 2)}%)`}
              </span>
            </Tag>
              <div className="inline-flex items-center gap-1 h-6 rounded-full border border-slate-200 bg-white px-1 py-[1px] shadow-[0_1px_0_rgba(15,23,42,0.04)] text-[7px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span>{REGIME_GUIDE[regime]?.label || "Steady"}</span>
                <InfoTip
                  title="Market regime"
                  size="xs"
                  className="shrink-0"
                  testId={`rail-regime-tip-${t.index}`}
                >
                  <div className="space-y-1.5">
                    <div><b>Current regime:</b> {REGIME_GUIDE[regime]?.label || "Steady"}</div>
                    <div>{REGIME_GUIDE[regime]?.text || REGIME_GUIDE.steady.text}</div>
                  </div>
                </InfoTip>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Header: sidebar-matching brand tiles (sky / amber / emerald).
  const stripClass = isHeader
    ? `flex flex-nowrap items-stretch gap-1.5 min-w-0 w-full overflow-x-auto overscroll-x-contain oi-hover-scroll ${many ? "snap-x snap-mandatory cursor-grab" : "max-w-full"}`
    : dense
      ? "grid grid-cols-3 gap-1.5"
      : "grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-stretch";

  return (
    <div ref={isHeader ? scrollerRef : undefined} className={stripClass} data-testid="ticker-strip">
      {displayTickers.map((t) => {
        const s = INDEX_STYLE[t.index] || INDEX_STYLE.NIFTY;
        const up = t.change > 0;
        const flat = Math.abs(t.change) < 0.01 || t.ltp == null || Number(t.ltp) === 0;
        const isActive = t.index === activeIndex;
        const tones = isHeader
          ? headerTileTone(t.index, up, flat, isActive)
          : {
              shell: flat
                ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                : up
                  ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/50 dark:to-slate-900"
                  : "border-rose-300 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/50 dark:to-slate-900",
              label: flat ? "text-slate-700 dark:text-slate-300" : up ? "text-emerald-900 dark:text-emerald-200" : "text-rose-900 dark:text-rose-200",
              price: "text-slate-950 dark:text-slate-50",
              chg: flat ? "text-slate-500" : up ? "text-emerald-600" : "text-rose-600",
            };
        const Arrow = flat ? Minus : up ? TrendingUp : TrendingDown;
        const shortLabel = String(s.short || s.label || "INDEX").toUpperCase();
        const useCompact = dense || isHeader;
        const ltpLabel = fmtLtp(t.ltp, 2);
        const selectable = indexSelectable(t.index);
        const regimeLabel = regimeChip(t.change_pct, flat, t.prev_close, t.day_high, t.day_low, t.ltp);
        const TileTag = selectable ? "button" : "div";
        return (
          <div
            key={t.index}
            className={`text-left border-2 ${tones.shell} ${
              isHeader
                ? `header-index-tile overflow-hidden shrink-0 ${many ? "min-w-[6.7rem] max-w-[9.25rem] snap-start" : "min-w-[7.1rem] max-w-[10.5rem]"}`
                : dense
                  ? "px-1.5 py-1.5"
                  : "px-3 py-2 w-full md:w-auto md:min-w-[140px] md:flex-none"
            } ${isActive && selectable ? "shadow-md" : ""} ${isHeader ? "rounded-full" : "rounded-md"}`}
          >
          <TileTag
            type={selectable ? "button" : undefined}
            onClick={selectable ? () => onSelectIndex?.(t.index) : undefined}
            data-testid={`ticker-${t.index}`}
            aria-disabled={selectable ? undefined : "true"}
            className={`w-full text-left ${
              isHeader ? "px-2 py-1.5" : ""
            } ${selectable ? "hover:brightness-[0.99] transition-all" : ""}`}
            title={selectable
              ? `Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`
              : `${s.label} is on the quote strip but not enabled for the desk`}
          >
            <div className={`flex items-center justify-between gap-1 uppercase tracking-wide font-semibold ${tones.label || ""} ${
              isHeader ? "text-[10px]" : useCompact ? "text-[9px] tracking-widest font-semibold gap-0.5" : "text-[9px] tracking-widest font-semibold gap-3"
            }`}>
              <div className="flex items-center gap-1 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive && isHeader ? "bg-white/90" : s.dot}`} />
                <span className="truncate">{useCompact ? shortLabel : s.label}</span>
              </div>
              <div className={`font-mono-data tabular-nums shrink-0 font-semibold ${tones.chg} ${isHeader ? "text-[10px]" : "text-[10px]"}`} data-testid={`ticker-${t.index}-pct`}>
                {flat ? "0.00%" : `${t.change_pct > 0 ? "+" : ""}${fmtNum(t.change_pct, 2)}%`}
              </div>
            </div>
            <div className={`mt-1 ${useCompact ? "space-y-0.5" : "flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:mt-1.5"}`}>
              <div
                className={`${isHeader ? "text-sm" : useCompact ? "text-[12px]" : "text-base sm:text-sm"} font-mono-data font-bold tabular-nums leading-none ${tones.price}`}
                data-testid={`ticker-${t.index}-ltp`}
              >
                {ltpLabel}
              </div>
              <div
                className={`inline-flex items-center gap-1 font-mono-data tabular-nums leading-none ${tones.chg} ${
                  isHeader ? "text-[10px]" : useCompact ? "text-[10px]" : "gap-1.5 text-xs sm:text-[11px]"
                }`}
                data-testid={`ticker-${t.index}-chg`}
              >
                <Arrow className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>
                  {flat ? "0.00" : `${t.change > 0 ? "+" : ""}${fmtNum(t.change, 2)}`}
                </span>
              </div>
            </div>
          </TileTag>
            {isHeader && (
              <div className="mx-1.5 mb-1.5 rounded-[8px] border border-slate-200 bg-white/80 px-1.5 py-1 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                <div className="flex items-center justify-between gap-1 text-[8px] uppercase tracking-[0.14em] text-slate-500">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-slate-600">Regime</span>
                    <InfoTip
                      title="Market regime"
                      size="xs"
                      className="shrink-0"
                      testId={`regime-tip-${t.index}`}
                    >
                      <div className="space-y-1.5">
                        <div><b>Current regime:</b> {REGIME_GUIDE[getTickerRegime(t.change_pct, flat, t.prev_close, t.day_high, t.day_low, t.ltp)]?.label || "Steady"}</div>
                        <div>{REGIME_GUIDE[getTickerRegime(t.change_pct, flat, t.prev_close, t.day_high, t.day_low, t.ltp)]?.text || REGIME_GUIDE.steady.text}</div>
                        <div className="mt-1 pt-1 border-t border-slate-200 dark:border-slate-700">
                          <div><b>Range:</b> price oscillates inside a band; mean reversion is often more relevant.</div>
                          <div><b>Trend:</b> directional move remains persistent; risk control matters more.</div>
                          <div><b>Bullish:</b> buyers are leading and momentum is supportive.</div>
                          <div><b>Risk-off:</b> fear or defensive flow is taking over.</div>
                          <div><b>Steady:</b> market is quiet and no fresh directional edge is obvious.</div>
                        </div>
                      </div>
                    </InfoTip>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-[2px] font-mono-data text-[8px] font-semibold text-slate-800">{regimeLabel}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
