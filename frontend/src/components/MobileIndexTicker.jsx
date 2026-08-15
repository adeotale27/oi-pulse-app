import { useEffect, useMemo, useState } from "react";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { api, fetchExtras, subscribeExtras, unsubscribeExtras } from "@/lib/api";
import { GIFT_SESSION_WINDOWS } from "@/lib/marketTimes";
import { DESK_IDS, INDEX_SHORT } from "@/lib/universe";
import { pickIndexLtp } from "@/lib/indexQuotes";

function fmt(v, dp = 2) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function pctCls(p) {
  if (p == null || !Number.isFinite(p)) return "text-white/70";
  if (p > 0.05) return "text-emerald-200";
  if (p < -0.05) return "text-rose-200";
  return "text-white/70";
}

/**
 * Phone-only marquee for VIX / GIFT / NIFTY / SENSEX / BNF.
 * Sits inside the top LIVE status bar so quote cards do not eat chart space.
 */
export default function MobileIndexTicker({
  activeIndex,
  onSelectIndex,
  spotPrices = {},
  tickers: tickersProp = null,
  indices = DESK_IDS,
}) {
  const [tickersLocal, setTickersLocal] = useState([]);
  const [extras, setExtras] = useState({ vix: null, gift_nifty: null, windows: {} });
  const [giftOpen, setGiftOpen] = useState(false);
  const tickers = Array.isArray(tickersProp) && tickersProp.length ? tickersProp : tickersLocal;

  useEffect(() => {
    if (Array.isArray(tickersProp) && tickersProp.length) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/tickers");
        if (!cancelled) setTickersLocal(data.tickers || []);
      } catch {
        /* keep last */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tickersProp]);

  useEffect(() => {
    let alive = true;
    fetchExtras()
      .then((d) => { if (alive && d) setExtras(d); })
      .catch(() => {});
    const onData = (d) => { if (alive && d) setExtras(d); };
    subscribeExtras(onData);
    return () => {
      alive = false;
      unsubscribeExtras(onData);
    };
  }, []);

  const items = useMemo(() => {
    const out = [];
    const vixLast = extras?.vix?.last ?? extras?.vix?.ltp;
    const vixPct = Number(extras?.vix?.change_pct ?? 0);
    out.push({
      key: "VIX",
      label: "VIX",
      price: vixLast != null ? Number(vixLast).toFixed(2) : "—",
      pct: vixLast != null ? vixPct : null,
      onClick: null,
    });
    const giftLast = extras?.gift_nifty?.last;
    const giftPct = Number(extras?.gift_nifty?.change_pct ?? 0);
    out.push({
      key: "GIFT",
      label: "GIFT",
      price: giftLast != null ? fmt(giftLast, 1) : "—",
      pct: giftLast != null ? giftPct : null,
      onClick: () => setGiftOpen(true),
    });
    const order = (Array.isArray(indices) && indices.length) ? indices : DESK_IDS;
    const byIndex = Object.fromEntries((tickers || []).map((t) => [t.index, t]));
    for (const idx of order) {
      const t = byIndex[idx];
      const ltp = pickIndexLtp({ idx, live: spotPrices[idx], tickerLtp: t?.ltp });
      const prev = Number(t?.prev_close) || 0;
      const chgPct = ltp && prev ? ((ltp - prev) / prev) * 100 : null;
      out.push({
        key: idx,
        label: INDEX_SHORT[idx] || idx,
        price: Number.isFinite(ltp) && ltp ? fmt(ltp, 2) : "—",
        pct: chgPct,
        onClick: () => onSelectIndex?.(idx),
        active: idx === activeIndex,
      });
    }
    return out;
  }, [extras, tickers, spotPrices, activeIndex, onSelectIndex, indices]);

  const giftSessions = extras?.windows?.gift?.sessions || GIFT_SESSION_WINDOWS;
  const loop = [...items, ...items];

  return (
    <div className="min-w-0 overflow-hidden" data-testid="mobile-index-ticker">
      <GiftSessionsModal
        open={giftOpen}
        onOpenChange={setGiftOpen}
        windows={giftSessions}
        serverIst={extras?.server_time_ist}
      />
      <div className="oi-mobile-ticker-track gap-3 pr-6">
        {loop.map((it, i) => (
          <button
            key={`${it.key}-${i}`}
            type="button"
            data-testid={i < items.length ? `mobile-ticker-${it.key}` : undefined}
            onClick={it.onClick || undefined}
            className={`inline-flex items-center gap-1 shrink-0 font-mono-data text-[10px] tabular-nums ${
              it.active ? "text-white font-bold" : "text-white/95"
            } ${it.onClick ? "cursor-pointer" : "cursor-default"}`}
          >
            <span className="uppercase tracking-wider font-semibold text-white/80">{it.label}</span>
            <span className="font-semibold">{it.price}</span>
            {it.pct != null && Number.isFinite(it.pct) && (
              <span className={pctCls(it.pct)}>
                {`${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(2)}%`}
              </span>
            )}
            <span className="text-white/30 pl-2" aria-hidden>
              ·
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
