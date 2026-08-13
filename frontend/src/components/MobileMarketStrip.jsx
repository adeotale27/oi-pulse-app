import { useEffect, useState } from "react";
import GiftSessionsModal from "@/components/GiftSessionsModal";
import { fetchExtras, subscribeExtras, unsubscribeExtras } from "@/lib/api";
import { GIFT_SESSION_WINDOWS } from "@/lib/marketTimes";

/**
 * Mobile-only VIX / GIFT metrics. Index switching lives in sticky chrome.
 * Desktop keeps these in the Header.
 */
export default function MobileMarketStrip() {
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
    <div className="md:hidden" data-testid="mobile-market-strip">
      <GiftSessionsModal
        open={giftOpen}
        onOpenChange={setGiftOpen}
        windows={giftSessions}
        serverIst={extras?.server_time_ist}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            India VIX
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="font-mono-data text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {vixLast != null ? Number(vixLast).toFixed(2) : "—"}
            </span>
            <span className={`font-mono-data text-[11px] font-semibold ${pctCls(vixPct)}`}>
              {vixLast != null ? `${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%` : ""}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setGiftOpen(true)}
          className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-left dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            GIFT Nifty
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="font-mono-data text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {giftLast != null
                ? Number(giftLast).toLocaleString(undefined, { maximumFractionDigits: 1 })
                : "—"}
            </span>
            <span className={`font-mono-data text-[11px] font-semibold ${pctCls(giftPct)}`}>
              {giftLast != null ? `${giftPct >= 0 ? "+" : ""}${giftPct.toFixed(2)}%` : ""}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}
