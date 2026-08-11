import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";

function fmtNum(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function pickLtp(live, rest) {
  const liveN = live == null ? null : Number(live);
  if (liveN != null && Number.isFinite(liveN) && liveN !== 0) return liveN;
  const restN = rest == null ? null : Number(rest);
  if (restN != null && Number.isFinite(restN) && restN !== 0) return restN;
  return null;
}

function fmtLtp(v, dp = 2) {
  if (v == null || Number.isNaN(Number(v)) || Number(v) === 0) return "—";
  return fmtNum(v, dp);
}

// Per-index visual identity + up/down wash for readable desk tiles.
const INDEX_STYLE = {
  NIFTY:     { label: "NIFTY 50",   short: "NIFTY",  dot: "bg-sky-500" },
  SENSEX:    { label: "SENSEX",     short: "SENSEX", dot: "bg-amber-500" },
  BANKNIFTY: { label: "BANK NIFTY", short: "BANK",   dot: "bg-emerald-500" },
};

function tileTone(up, flat) {
  if (flat) {
    return {
      shell: "border-slate-600/60 bg-slate-800/80",
      label: "text-slate-300",
      price: "text-slate-100",
      chg: "text-slate-400",
    };
  }
  if (up) {
    return {
      shell: "border-emerald-500/50 bg-gradient-to-br from-emerald-950/90 to-emerald-900/50",
      label: "text-emerald-200",
      price: "text-emerald-300",
      chg: "text-emerald-400",
    };
  }
  return {
    shell: "border-rose-500/50 bg-gradient-to-br from-rose-950/90 to-rose-900/50",
    label: "text-rose-200",
    price: "text-rose-300",
    chg: "text-rose-400",
  };
}

export default function TickerStrip({ onSelectIndex, activeIndex, spotPrices = {}, dense = false, layout = "default" }) {
  const [tickers, setTickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isHeader = layout === "header";
  const isRail = layout === "rail";

  useEffect(() => {
    let cancelled = false;
    async function fetchTickers() {
      try {
        const { data } = await api.get("/tickers");
        if (!cancelled) setTickers(data.tickers || []);
      } catch (_e) { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    }
    // If market quiescent (weekend/holiday), fetch once and skip periodic refreshes
    try {
      const closed = isMarketQuiescent();
      fetchTickers();
      if (!closed) {
        const id = setInterval(fetchTickers, 300000); // refresh metadata every 5m
        return () => { cancelled = true; clearInterval(id); };
      }
    } catch (e) {
      fetchTickers();
      const id = setInterval(fetchTickers, 300000); // refresh metadata every 5m
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, []);

  const displayTickers = useMemo(() => {
    return tickers.map((t) => {
      const ltp = pickLtp(spotPrices[t.index], t.ltp);
      const prevClose = t.prev_close || (t.ltp && Number(t.ltp) !== 0 ? t.ltp : 0) || 0;
      const change = ltp != null && prevClose ? ltp - prevClose : 0;
      const change_pct = prevClose ? (change / prevClose) * 100 : 0;
      return { ...t, ltp, change, change_pct };
    });
  }, [tickers, spotPrices]);

  if (loading && !tickers.length) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 py-1">Loading tickers…</div>
    );
  }

  // Slim status-rail: Sensibull-style quote — NAME arrow PRICE chg (pct%)
  if (isRail) {
    return (
      <div className="flex flex-nowrap items-center gap-0.5 min-w-0 overflow-x-auto" data-testid="ticker-strip">
        {displayTickers.map((t) => {
          const s = INDEX_STYLE[t.index] || INDEX_STYLE.NIFTY;
          const up = t.change > 0;
          const flat = Math.abs(t.change) < 0.01 || t.ltp == null || Number(t.ltp) === 0;
          const toneCls = flat ? "text-slate-600 dark:text-slate-300" : up ? "text-emerald-600" : "text-rose-600";
          const isActive = t.index === activeIndex;
          const shortLabel = s.short;
          const ltpLabel = fmtLtp(t.ltp, 2);
          const Arrow = flat ? Minus : up ? TrendingUp : TrendingDown;
          return (
            <button
              key={t.index}
              type="button"
              onClick={() => onSelectIndex?.(t.index)}
              data-testid={`ticker-${t.index}`}
              title={`Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`}
              className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-sm border text-[10px] font-mono-data tabular-nums shrink-0 transition-colors ${
                isActive
                  ? "border-sky-400 bg-white shadow-sm dark:bg-slate-900"
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                {shortLabel}
              </span>
              <Arrow className={`w-3 h-3 shrink-0 ${toneCls}`} strokeWidth={2.5} aria-hidden />
              <span
                className={`font-semibold ${toneCls}`}
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
            </button>
          );
        })}
      </div>
    );
  }

  // Header: colorful up/down desk tiles (readable on dark header).
  const stripClass = isHeader
    ? "flex flex-nowrap items-stretch gap-1.5 min-w-0 w-auto max-w-full overflow-hidden"
    : dense
      ? "grid grid-cols-3 gap-1.5"
      : "grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-stretch";

  return (
    <div className={stripClass} data-testid="ticker-strip">
      {displayTickers.map((t) => {
        const s = INDEX_STYLE[t.index] || INDEX_STYLE.NIFTY;
        const up = t.change > 0;
        const flat = Math.abs(t.change) < 0.01 || t.ltp == null || Number(t.ltp) === 0;
        const tones = isHeader
          ? tileTone(up, flat)
          : {
              shell: flat
                ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                : up
                  ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/50 dark:to-slate-900"
                  : "border-rose-300 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/50 dark:to-slate-900",
              label: flat ? "text-slate-600 dark:text-slate-400" : up ? "text-emerald-800 dark:text-emerald-200" : "text-rose-800 dark:text-rose-200",
              price: flat ? "text-slate-900 dark:text-slate-100" : up ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
              chg: flat ? "text-slate-500" : up ? "text-emerald-600" : "text-rose-600",
            };
        const Arrow = flat ? Minus : up ? TrendingUp : TrendingDown;
        const isActive = t.index === activeIndex;
        const shortLabel = s.short;
        const useCompact = dense || isHeader;
        const ltpLabel = fmtLtp(t.ltp, 2);
        return (
          <button
            key={t.index}
            type="button"
            onClick={() => onSelectIndex?.(t.index)}
            data-testid={`ticker-${t.index}`}
            className={`text-left rounded-md border ${tones.shell} ${
              isHeader
                ? "px-2.5 py-1.5 shrink-0 min-w-[8.25rem] max-w-[11rem]"
                : dense
                  ? "px-1.5 py-1.5"
                  : "px-3 py-2 w-full md:w-auto md:min-w-[140px] md:flex-none"
            } hover:brightness-110 transition-all ${
              isActive ? "ring-2 ring-sky-400/70 shadow-md" : ""
            }`}
            title={`Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`}
          >
            <div className={`flex items-center justify-between gap-1 text-[9px] uppercase tracking-widest font-semibold ${tones.label} ${useCompact ? "gap-0.5" : "gap-3"}`}>
              <div className="flex items-center gap-1 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                <span className="truncate">{useCompact ? shortLabel : s.label}</span>
              </div>
              <div className={`text-[10px] font-mono-data tabular-nums shrink-0 ${tones.chg}`} data-testid={`ticker-${t.index}-pct`}>
                {flat ? "0.00%" : `${t.change_pct > 0 ? "+" : ""}${fmtNum(t.change_pct, 2)}%`}
              </div>
            </div>
            <div className={`mt-1 ${useCompact ? "space-y-0.5" : "flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:mt-1.5"}`}>
              <div
                className={`${useCompact ? "text-[12px]" : "text-base sm:text-sm"} font-mono-data font-bold tabular-nums leading-none ${tones.price}`}
                data-testid={`ticker-${t.index}-ltp`}
              >
                {ltpLabel}
              </div>
              <div
                className={`inline-flex items-center gap-1 font-mono-data tabular-nums leading-none ${tones.chg} ${
                  useCompact ? "text-[10px]" : "gap-1.5 text-xs sm:text-[11px]"
                }`}
                data-testid={`ticker-${t.index}-chg`}
              >
                <Arrow className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>
                  {flat ? "—" : `${t.change > 0 ? "+" : ""}${fmtNum(t.change, 2)}`}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
