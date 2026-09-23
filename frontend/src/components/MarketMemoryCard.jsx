import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import InfoTip from "@/components/InfoTip";

export default function MarketMemoryCard({ index }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef(null);
  useEffect(() => {
    let live = true;
    api.get(`/market-memory/${index}`, { timeout: 8000 }).then((r) => {
      if (!live) return;
      setData(r.data);
      setPulse(true);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 850);
    }).catch(() => live && setData({ levels: [] }));
    return () => {
      live = false;
      clearTimeout(pulseTimer.current);
    };
  }, [index]);
  const levels = data?.levels || [];
  const freshnessTone = Number(data?.freshnessSeconds) < 90
    ? "market-memory-freshness-live"
    : "market-memory-freshness-stale";
  const freshness = data?.freshnessSeconds == null
    ? "Freshness unavailable"
    : data.freshnessSeconds < 60
      ? `Updated ${data.freshnessSeconds}s ago`
      : `Updated ${Math.floor(data.freshnessSeconds / 60)}m ago`;
  const formatReaction = (value) => value == null ? "—" : `${value > 0 ? "+" : ""}${value} pts`;
  const formatContext = (context) => {
    if (!context || typeof context !== "object") return null;
    const parts = [];
    if (context.pcr != null) parts.push(`PCR ${Number(context.pcr).toFixed(2)}`);
    if (context.vix != null && typeof context.vix !== "object") parts.push(`VIX ${Number(context.vix).toFixed(2)}`);
    if (context.expiry) parts.push(`Expiry ${context.expiry}`);
    return parts.join(" · ");
  };
  return (
    <section className={`rounded-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 ${pulse ? "market-memory-pulse" : ""}`} data-testid="market-memory-card">
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
        <span>Market Memory</span>
        <InfoTip title="How to read Market Memory" size="xs" testId="market-memory-info">
          <div className="space-y-2">
            <p>Market Memory records how price behaved when it previously reached a structural level. It is context, not a forecast or trade signal.</p>
            <p><b>Interactions</b> = meaningful touches, rejections, breakouts, and failed breakouts. Repeated snapshots during one visit are grouped.</p>
            <p><b>Average reaction</b> = the average absolute move after a recorded test. It shows typical movement, not direction or guaranteed follow-through.</p>
            <p><b>Distance</b> = live price minus the level. Positive means price is above it; negative means price is below it.</p>
            <p><b>Strength</b> combines reaction history and recency. Old reactions fade in relevance.</p>
          </div>
        </InfoTip>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          {levels.length ? "Previous reactions around today’s important levels" : "Learning from live OI snapshots."}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${freshnessTone}`} data-testid="market-memory-freshness">{freshness}</span>
          {levels.length ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{levels.length} memories</span> : null}
        </div>
      </div>
      {levels.length ? <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {levels.slice(0, 3).map((row) => (
          <div key={`${row.level}-${row.levelType}`} className={`rounded border border-slate-100 bg-slate-50/70 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-800/50 ${pulse ? "market-memory-level-refresh" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-data text-xs font-semibold">{Number(row.level).toLocaleString("en-IN")}</span>
              <span className={`text-[9px] font-bold ${row.levelType === "SUPPORT" ? "text-emerald-600" : row.levelType === "RESISTANCE" ? "text-rose-600" : "text-amber-600"}`}>{row.levelType}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">{row.strength || "—"} · {(row.rejectionCount || 0) + (row.touchCount || 0) + (row.breakoutCount || 0) + (row.failedBreakoutCount || 0)} interactions · {row.currentDistance == null ? "—" : `${row.currentDistance} pts`}</div>
            <div className="mt-1 text-[10px] text-slate-600 dark:text-slate-300">Typical {formatReaction(row.averageSignedReaction)} · {row.failureRate == null ? "—" : `${row.failureRate}% break risk`}</div>
          </div>
        ))}
      </div> : null}
      <Button type="button" variant="ghost" className="mt-1 h-7 px-0 text-[10px] uppercase tracking-wide" onClick={() => setOpen(true)}>View Full Memory</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[92vw] lg:max-w-[1100px] xl:max-w-[1220px]" data-testid="market-memory-detail">
          <SheetHeader>
            <div className="flex items-center gap-1.5">
              <SheetTitle>Market Memory · {index}</SheetTitle>
              <InfoTip title="Market Memory guide" testId="market-memory-detail-info">
                <div className="space-y-2">
                  <p>These are historical reactions from the existing OI snapshot stream.</p>
                  <p><b>Interactions:</b> touches, rejections, breakouts, and failed breakouts grouped into meaningful visits.</p>
                  <p><b>Avg reaction:</b> average absolute price move after a test. It does not say whether the next move will be up or down.</p>
                  <p><b>Distance:</b> current price minus the level. Negative means price is below the level.</p>
                </div>
              </InfoTip>
            </div>
            <p className="text-xs leading-5 text-slate-500">Market Memory shows how the index reacted around a level before. Use it with current OI, price action, and data freshness—not as a standalone entry signal.</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400"><span>{freshness}</span>{data?.price != null ? <span>Live price {Number(data.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span> : null}</div>
          </SheetHeader>
          <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-[11px] leading-4 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
            <div><b className="text-slate-800 dark:text-slate-100">Level</b><br />The rounded structural price zone being remembered. The small range below it is the level tolerance band.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Type</b><br />Support means reactions below price, resistance means reactions above price, and structural means there is not enough directional evidence.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Strength</b><br />A recency-weighted memory score based on touches, rejections, and failed breakouts. It is not probability.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Interactions</b><br />Meaningful visits to the zone: touches, rejections, clean breakouts, and failed breakouts. Repeated polling ticks are grouped.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Avg reaction</b><br />Typical absolute move after a test. “Largest” is the biggest recorded move; neither guarantees the next move.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Direction</b><br />Signed reaction: positive is upward and negative is downward. Up/down lines show the average for each direction separately.</div>
            <div><b className="text-slate-800 dark:text-slate-100">5d / 20d</b><br />Recent average reaction versus the longer stored window. A large difference means the level’s behavior may be changing.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Failure</b><br />Break rate shows how often tests became breakouts. Failed retest is the share of breakouts that later returned through the level.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Distance</b><br />Live price minus level. Positive means price is above it; negative means price is below it. Near zero means price is testing the zone.</div>
            <div><b className="text-slate-800 dark:text-slate-100">Context</b><br />PCR, VIX, and expiry captured at the latest interaction when available. It describes the environment, not a recommendation.</div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs"><thead className="text-left text-[10px] uppercase text-slate-500"><tr><th className="sticky left-0 z-10 bg-slate-50 py-2 pr-4 dark:bg-slate-900">Level</th><th>Type</th><th>Strength</th><th>Interactions</th><th>Avg reaction</th><th>Direction</th><th>5d / 20d</th><th>Failure</th><th>Distance</th><th>Context</th></tr></thead>
              <tbody>{(data?.levels || []).map((row) => <tr key={`${row.level}-${row.levelType}`} className="border-t border-slate-100 dark:border-slate-800"><td className="sticky left-0 z-10 bg-white py-2 pr-4 font-mono-data dark:bg-slate-900">{Number(row.level).toLocaleString("en-IN")}<div className="text-[9px] text-slate-400">{row.zoneLow}–{row.zoneHigh}</div></td><td>{row.levelType}</td><td className={row.strength === "HIGH" ? "font-semibold text-emerald-600" : "text-amber-600"}>{row.strength || "—"}</td><td>{(row.rejectionCount || 0) + (row.touchCount || 0) + (row.breakoutCount || 0) + (row.failedBreakoutCount || 0)}<div className="text-[9px] text-slate-400">{row.touchCount || 0} touch · {row.rejectionCount || 0} reject</div></td><td>{row.averageReaction == null ? "—" : `${row.averageReaction} pts`}<div className="text-[9px] text-slate-400">{row.largestReaction == null ? "" : `largest ${row.largestReaction} pts`}</div></td><td>{formatReaction(row.averageSignedReaction)}<div className="text-[9px] text-slate-400">up {formatReaction(row.averageUpReaction)} · down {formatReaction(row.averageDownReaction)}</div></td><td>{row.recentAverageReaction == null ? "—" : `${row.recentAverageReaction}`} / {row.historicalAverageReaction == null ? "—" : row.historicalAverageReaction}</td><td>{row.failureRate == null ? "—" : `${row.failureRate}% break`}<div className="text-[9px] text-slate-400">{row.failedBreakoutRate == null ? "—" : `${row.failedBreakoutRate}% failed retest`}</div></td><td>{row.currentDistance == null ? "—" : `${row.currentDistance} pts`}</td><td className="text-[10px] text-slate-500">{formatContext(row.lastContext) || "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
