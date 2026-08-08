import { useEffect, useState } from "react";
import TickerStrip from "@/components/TickerStrip";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { fetchExtras, subscribeExtras, unsubscribeExtras } from "@/lib/api";
import { GIFT_SESSION_WINDOWS } from "@/lib/marketTimes";

/**
 * Mobile-only market strip that scrolls with the dashboard body so the
 * sticky chrome can stay compact. Desktop keeps these in the Header.
 */
export default function MobileMarketStrip({
  activeIndex,
  onSelectIndex,
  spotPrices,
}) {
  const [extras, setExtras] = useState({ vix: null, gift_nifty: null, windows: {} });
  const [giftOpen, setGiftOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchExtras()
      .then((d) => {
        if (alive && d) setExtras(d);
      })
      .catch(() => {});
    const onData = (d) => {
      if (alive && d) setExtras(d);
    };
    subscribeExtras(onData);
    return () => {
      alive = false;
      unsubscribeExtras(onData);
    };
  }, []);

  const vix = extras?.vix;
  const gift = extras?.gift_nifty;
  const giftSessions = extras?.windows?.gift?.sessions || GIFT_SESSION_WINDOWS;
  const vixLast = vix?.last ?? vix?.ltp;
  const vixPct = Number(vix?.change_pct ?? 0);
  const giftLast = gift?.last;
  const giftPct = Number(gift?.change_pct ?? 0);

  const pctCls = (p) =>
    p > 0.05 ? "text-emerald-600" : p < -0.05 ? "text-rose-600" : "text-slate-500";

  return (
    <div className="space-y-2 md:hidden" data-testid="mobile-market-strip">
      <GiftSessionsModal
        open={giftOpen}
        onOpenChange={setGiftOpen}
        windows={giftSessions}
        serverIst={extras?.server_time_ist}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/80">
          <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            <span>India VIX</span>
            <span className={`font-mono-data ${pctCls(vixPct)}`}>
              {vixLast != null ? `${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%` : "—"}
            </span>
          </div>
          <div className="mt-0.5 font-mono-data text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {vixLast != null ? Number(vixLast).toFixed(2) : "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setGiftOpen(true)}
          className="rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5 text-left dark:border-slate-700 dark:bg-slate-900/80"
        >
          <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-widest text-slate-500">
            <span>GIFT Nifty</span>
            <span className={`font-mono-data ${pctCls(giftPct)}`}>
              {giftLast != null ? `${giftPct >= 0 ? "+" : ""}${giftPct.toFixed(2)}%` : "—"}
            </span>
          </div>
          <div className="mt-0.5 font-mono-data text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {giftLast != null
              ? Number(giftLast).toLocaleString(undefined, { maximumFractionDigits: 2 })
              : "—"}
          </div>
        </button>
      </div>
      <TickerStrip
        activeIndex={activeIndex}
        onSelectIndex={onSelectIndex}
        spotPrices={spotPrices}
        dense
      />
    </div>
  );
}
