import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { isMarketQuiescent } from "@/lib/marketTimes";

function fmtNum(v, dp = 2) {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Per-index visual identity — matches the new Sidebar selector styling for
// visual consistency across the app.
const INDEX_STYLE = {
  NIFTY:     { label: "NIFTY 50",   gradient: "from-sky-500/10 to-indigo-500/10",     borderActive: "border-sky-400 dark:border-sky-500",     dot: "bg-sky-500" },
  SENSEX:    { label: "SENSEX",     gradient: "from-amber-500/10 to-orange-500/10",   borderActive: "border-amber-400 dark:border-amber-500",   dot: "bg-amber-500" },
  BANKNIFTY: { label: "BANK NIFTY", gradient: "from-emerald-500/10 to-teal-500/10",   borderActive: "border-emerald-400 dark:border-emerald-500", dot: "bg-emerald-500" },
};

export default function TickerStrip({ onSelectIndex, activeIndex, spotPrices = {}, dense = false, layout = "default" }) {
  const [tickers, setTickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isHeader = layout === "header";

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
      const ltp = spotPrices[t.index] ?? t.ltp;
      const prevClose = t.prev_close || t.ltp || 0;
      const change = ltp != null && prevClose != null ? ltp - prevClose : 0;
      const change_pct = prevClose ? (change / prevClose) * 100 : 0;
      return { ...t, ltp, change, change_pct };
    });
  }, [tickers, spotPrices]);

  if (loading && !tickers.length) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 py-1">Loading tickers…</div>
    );
  }

  // Header: shrink-to-content tiles (do not stretch across leftover width on zoom).
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
        const flat = Math.abs(t.change) < 0.01;
        const toneCls =
          flat ? "text-slate-500"
            : up ? "text-emerald-600"
              : "text-rose-600";
        const Arrow =
          flat ? Minus
            : up ? TrendingUp
              : TrendingDown;
        const isActive = t.index === activeIndex;
        const shortLabel =
          t.index === "BANKNIFTY" ? "BANK" : t.index === "NIFTY" ? "NIFTY" : "SENSEX";
        const useCompact = dense || isHeader;
        return (
          <button
            key={t.index}
            type="button"
            onClick={() => onSelectIndex?.(t.index)}
            data-testid={`ticker-${t.index}`}
            className={`text-left rounded-md border bg-gradient-to-br ${s.gradient} ${
              isHeader
                ? "px-2 py-1.5 shrink-0 min-w-[7.25rem] max-w-[9rem]"
                : dense
                  ? "px-1.5 py-1.5"
                  : "px-3 py-2 w-full md:w-auto md:min-w-[140px] md:flex-none"
            } hover:brightness-95 transition-all ${
              isActive
                ? `${s.borderActive} border shadow-sm ring-1 ring-current/10`
                : "border-slate-200 dark:border-slate-700"
            }`}
            title={`Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`}
          >
            <div className={`flex items-center justify-between gap-1 text-[9px] uppercase tracking-widest text-slate-600 dark:text-slate-400 font-semibold ${useCompact ? "gap-0.5" : "gap-3"}`}>
              <div className="flex items-center gap-1 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                <span className="truncate">{useCompact ? shortLabel : s.label}</span>
              </div>
              {!useCompact && (
                <div className={`text-[10px] font-mono-data tabular-nums shrink-0 ${toneCls}`} data-testid={`ticker-${t.index}-pct`}>
                  {t.change_pct > 0 ? "+" : ""}{fmtNum(t.change_pct, 2)}%
                </div>
              )}
            </div>
            <div className={`mt-1 ${useCompact ? "space-y-0.5" : "flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:mt-1.5"}`}>
              <div
                className={`${useCompact ? "text-[11px]" : "text-base sm:text-sm"} font-mono-data font-semibold text-slate-900 dark:text-slate-100 tabular-nums leading-none`}
                data-testid={`ticker-${t.index}-ltp`}
              >
                {fmtNum(t.ltp, 2)}
              </div>
              <div
                className={`inline-flex items-center gap-1 font-mono-data tabular-nums leading-none ${toneCls} ${
                  useCompact ? "text-[10px]" : "gap-1.5 text-xs sm:text-[11px]"
                }`}
                data-testid={`ticker-${t.index}-chg`}
              >
                {!useCompact && <Arrow className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden />}
                <span>
                  {useCompact
                    ? `${t.change_pct > 0 ? "+" : ""}${fmtNum(t.change_pct, 2)}%`
                    : `${t.change > 0 ? "+" : ""}${fmtNum(t.change, 2)}`}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
