import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { api, subscribeExtras, unsubscribeExtras } from "@/lib/api";
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

function QuoteChip({ it, copy, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={it.onClick && (it.selectable !== false) ? it.onClick : undefined}
      className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap text-[11px] tabular-nums ${
        it.active ? "text-white font-bold" : "text-white/95"
      } ${it.onClick && it.selectable !== false ? "cursor-pointer" : "cursor-default"} ${it.selectable === false ? "opacity-40 pointer-events-none" : ""}`}
    >
      <span className="uppercase tracking-wide font-semibold text-white/90">{it.label}</span>
      {it.price != null && it.price !== "" ? (
        <span className="font-semibold tabular-nums font-mono-data inline-block min-w-[5.5rem] text-left">{it.price}</span>
      ) : null}
      {it.pct != null && Number.isFinite(it.pct) && (
        <span className={`${pctCls(it.pct)} tabular-nums font-mono-data inline-block min-w-[3.5rem]`}>
          {`${it.pct >= 0 ? "+" : ""}${it.pct.toFixed(2)}%`}
        </span>
      )}
      <span className="text-white/30 pl-2" aria-hidden>
        ·
      </span>
    </button>
  );
}

/**
 * Quote marquee inside the LIVE rail. LIVE / Next Pull stay outside this track.
 * Two identical copies; CSS translates -50% so items exit left and re-enter right.
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
  const [pad, setPad] = useState(1);
  const wrapRef = useRef(null);
  const setRef = useRef(null);
  const tickers = tickersProp != null ? (Array.isArray(tickersProp) ? tickersProp : []) : tickersLocal;

  useEffect(() => {
    if (tickersProp != null) return undefined;
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
    const onData = (d) => { if (alive && d) setExtras(d); };
    subscribeExtras(onData, { delayMs: 5000 });
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
      const prev = Number(t?.prev_close || t?.day_open) || 0;
      const chgPct = Number.isFinite(Number(t?.change_pct)) && t?.change_pct != null && prev
        ? Number(t.change_pct)
        : (ltp && prev ? ((ltp - prev) / prev) * 100 : null);
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

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const setEl = setRef.current;
      if (!wrap || !setEl || !items.length) return;
      const one = setEl.scrollWidth / Math.max(pad, 1);
      if (!one) return;
      const need = Math.max(1, Math.ceil(wrap.clientWidth / one));
      if (need !== pad) setPad(need);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items.length, pad]);

  const giftSessions = extras?.windows?.gift?.sessions || GIFT_SESSION_WINDOWS;
  const loopItems = useMemo(() => {
    if (!items.length) return [];
    const n = Math.max(1, pad);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      for (const it of items) out.push(it);
    }
    return out;
  }, [items, pad]);

  return (
    <div ref={wrapRef} className="min-w-0 w-full overflow-hidden" data-testid="mobile-index-ticker">
      <GiftSessionsModal
        open={giftOpen}
        onOpenChange={setGiftOpen}
        windows={giftSessions}
        serverIst={extras?.server_time_ist}
      />
      <div className="oi-mobile-ticker-track">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            ref={copy === 0 ? setRef : undefined}
            className="oi-mobile-ticker-copy"
            aria-hidden={copy > 0}
          >
            {loopItems.map((it, i) => (
              <QuoteChip
                key={`${copy}-${it.key}-${i}`}
                it={it}
                copy={copy}
                testId={copy === 0 && i < items.length ? `mobile-ticker-${it.key}` : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
