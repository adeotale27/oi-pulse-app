import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { bandClass, impactScoreLabel, indiaImpactLabel } from "@/lib/marketIntel";

/** In-app alert only — not a browser/push notification. Delayed so boot is not blocked. */
export default function MarketIntelPopup({ enabled, onOpenPage }) {
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  idxRef.current = idx;

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setIdx(0);
      return undefined;
    }
    let cancelled = false;
    let timer;
    const poll = () => {
      api.get("/market-intel/popup", { timeout: 15000 })
        .then((r) => {
          if (cancelled) return;
          const next = r.data?.items || [];
          setItems((prev) => {
            const curId = prev[idxRef.current]?.event_cluster_id;
            const found = next.findIndex((x) => x.event_cluster_id === curId);
            setIdx(found >= 0 ? found : 0);
            return next;
          });
        })
        .catch(() => {});
    };
    timer = setTimeout(() => {
      poll();
      timer = setInterval(poll, 180000);
    }, 25000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(timer);
    };
  }, [enabled]);

  const n = items.length;
  const item = n ? items[Math.min(idx, n - 1)] : null;
  if (!enabled || !item) return null;

  const dismiss = () => {
    const cid = item.event_cluster_id;
    const next = items.filter((x) => x.event_cluster_id !== cid);
    setItems(next);
    setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
    if (cid) api.post("/market-intel/popup/ack", { event_cluster_id: cid }).catch(() => {});
  };

  const step = (dir) => {
    if (n < 2) return;
    setIdx((i) => (i + dir + n) % n);
  };

  return (
    <div
      className="fixed z-[60] bottom-16 md:bottom-6 right-3 left-3 md:left-auto md:w-80 max-h-[min(52vh,24rem)] overflow-y-auto rounded-lg border border-rose-300 bg-white shadow-lg p-3 space-y-2 pointer-events-auto"
      data-testid="market-intel-popup"
      role="alertdialog"
    >
      <div className="flex items-start gap-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${bandClass(item.impact_band)}`}>{item.impact_band || "HIGH"}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${bandClass(item.impact_band)}`}>{impactScoreLabel(item.impact_score)}</span>
          {n > 1 ? <span className="text-[10px] text-slate-500">{Math.min(idx, n - 1) + 1} / {n}</span> : null}
        </div>
        {n > 1 ? (
          <div className="flex shrink-0 -mr-1">
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 touch-manipulation"
              aria-label="Previous impacting news"
              data-testid="mi-popup-prev"
              onClick={() => step(-1)}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 touch-manipulation"
              aria-label="Next impacting news"
              data-testid="mi-popup-next"
              onClick={() => step(1)}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="text-sm font-semibold text-slate-900 leading-snug">{item.title}</div>
      <div className="text-[11px] text-slate-600">{indiaImpactLabel(item.india_relevance_score)}</div>
      {Array.isArray(item.potential) && (
        <ul className="text-[11px] text-slate-700 list-disc pl-4">
          {item.potential.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="text-[11px] font-semibold text-emerald-800 min-h-11" onClick={() => { dismiss(); onOpenPage?.(); }}>View Market Intelligence</button>
        <button type="button" className="text-[11px] text-slate-500 ml-auto min-h-11" onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
