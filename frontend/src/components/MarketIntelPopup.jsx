import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** In-app alert only — not a browser/push notification. Delayed so boot is not blocked. */
export default function MarketIntelPopup({ enabled, onOpenPage }) {
  const [item, setItem] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    const poll = () => {
      api.get("/market-intel/popup", { timeout: 15000 })
        .then((r) => {
          if (cancelled) return;
          const next = (r.data?.items || [])[0];
          setItem(next || null);
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

  if (!enabled || !item) return null;

  const dismiss = () => {
    const cid = item.event_cluster_id;
    setItem(null);
    if (cid) api.post("/market-intel/popup/ack", { event_cluster_id: cid }).catch(() => {});
  };

  return (
    <div
      className="fixed z-[60] bottom-16 md:bottom-6 right-3 left-3 md:left-auto md:w-80 rounded-lg border border-rose-300 bg-white shadow-lg p-3 space-y-2 pointer-events-auto"
      data-testid="market-intel-popup"
      role="alertdialog"
    >
      <div className="text-[10px] font-bold text-rose-800">VERY HIGH IMPACT</div>
      <div className="text-sm font-semibold text-slate-900 leading-snug">{item.title}</div>
      <div className="text-[11px] text-slate-600">India {item.india_relevance_score} · Impact {item.impact_score}</div>
      {Array.isArray(item.potential) && (
        <ul className="text-[11px] text-slate-700 list-disc pl-4">
          {item.potential.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className="text-[11px] font-semibold text-emerald-800" onClick={() => { dismiss(); onOpenPage?.(); }}>View Market Intelligence</button>
        <button type="button" className="text-[11px] text-slate-500 ml-auto" onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
