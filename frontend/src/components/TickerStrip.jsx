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
  NIFTY:     { label: "NIFTY 50",   gradient: "from-sky-500/10 to-indigo-500/10",     ring: "ring-sky-300",     dot: "bg-sky-500" },
  SENSEX:    { label: "SENSEX",     gradient: "from-amber-500/10 to-orange-500/10",   ring: "ring-amber-300",   dot: "bg-amber-500" },
  BANKNIFTY: { label: "BANK NIFTY", gradient: "from-emerald-500/10 to-teal-500/10",   ring: "ring-emerald-300", dot: "bg-emerald-500" },
};

export default function TickerStrip({ onSelectIndex, activeIndex, spotPrices = {} }) {
  const [tickers, setTickers] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex items-stretch gap-2 flex-wrap" data-testid="ticker-strip">
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
        return (
          <button
            key={t.index}
            type="button"
            onClick={() => onSelectIndex?.(t.index)}
            data-testid={`ticker-${t.index}`}
            className={`text-left rounded-md border bg-gradient-to-br ${s.gradient} px-2.5 sm:px-3 py-1.5 sm:py-2 min-w-[110px] sm:min-w-[132px] flex-1 sm:flex-none hover:brightness-95 transition-all ${
              isActive
                ? `border-transparent ring-2 ${s.ring} shadow-sm`
                : "border-slate-200 dark:border-slate-700"
            }`}
            title={`Prev close ${fmtNum(t.prev_close)} · O ${fmtNum(t.day_open)} · H ${fmtNum(t.day_high)} · L ${fmtNum(t.day_low)}`}
          >
            <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-slate-600 dark:text-slate-400 font-semibold">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                <span className="truncate">{s.label}</span>
              </div>
              <div className={`text-[10px] font-mono-data tabular-nums shrink-0 ${toneCls}`} data-testid={`ticker-${t.index}-pct`}>
                {t.change_pct > 0 ? "+" : ""}{fmtNum(t.change_pct, 2)}%
              </div>
            </div>
            <div className="flex items-end justify-between gap-2 mt-1">
              <div
                className="text-sm font-mono-data font-semibold text-slate-900 dark:text-slate-100 tabular-nums leading-none"
                data-testid={`ticker-${t.index}-ltp`}
              >
                {fmtNum(t.ltp, 2)}
              </div>
              <div
                className={`flex items-center gap-1 text-[11px] font-mono-data tabular-nums leading-none shrink-0 ${toneCls}`}
                data-testid={`ticker-${t.index}-chg`}
              >
                <Arrow className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                <span>
                  {t.change > 0 ? "+" : ""}{fmtNum(t.change, 2)}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
