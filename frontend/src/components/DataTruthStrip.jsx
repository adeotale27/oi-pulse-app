import { useEffect, useMemo, useState } from "react";
import { buildDataTruth, formatIstClock } from "@/lib/dataTruth";

const TONE = {
  live: {
    bar: "bg-emerald-600 text-white border-emerald-700",
    badge: "bg-white text-emerald-800",
    pulse: "bg-white",
  },
  session: {
    // Dark forest green (not mint) — deeper than LIVE emerald-600
    bar: "bg-[#022c22] text-emerald-50 border-[#011f18] dark:bg-[#021f18] dark:border-black",
    badge: "bg-amber-400 text-amber-950",
    pulse: "bg-amber-300",
  },
  warn: {
    bar: "bg-amber-500 text-amber-950 border-amber-600",
    badge: "bg-amber-950 text-amber-100",
    pulse: "bg-amber-950",
  },
  offline: {
    bar: "bg-rose-700 text-rose-50 border-rose-800",
    badge: "bg-rose-100 text-rose-900",
    pulse: "bg-rose-200",
  },
};

/**
 * Impossible-to-misread trust strip: LIVE vs LAST SESSION vs OFFLINE.
 * Especially important for guests sharing / screen-recording the board.
 */
export default function DataTruthStrip({
  dataStatus,
  marketOpen,
  mode,
  snapshotTs,
  emphasize = false,
  mobileTicker = null,
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const truth = useMemo(
    () =>
      buildDataTruth({
        dataStatus,
        marketOpen,
        mode,
        snapshotTs,
      }),
    // tick refreshes relative age wording when cache_age is present
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataStatus, marketOpen, mode, snapshotTs, tick],
  );

  const tone = TONE[truth.tone] || TONE.offline;
  const asOfLive = truth.mode === "LIVE" ? formatIstClock(snapshotTs, true) : null;

  return (
    <div
      data-testid="data-truth-strip"
      data-truth-mode={truth.mode}
      role="status"
      aria-live="polite"
      className={`w-full border-b ${tone.bar} ${emphasize ? "py-2" : "py-1.5"} px-3 sm:px-4`}
    >
      <div className={`flex items-center gap-2 sm:gap-3 text-sm min-w-0 ${mobileTicker ? "flex-nowrap" : "flex-wrap"}`}>
        <span
          className={`inline-flex items-center gap-1.5 font-bold tracking-wide text-xs uppercase px-2 py-0.5 rounded-sm shrink-0 ${tone.badge}`}
          data-testid="data-truth-badge"
        >
          {(truth.mode === "LIVE" || truth.mode === "STALE") && (
            <span className={`w-1.5 h-1.5 rounded-full ${tone.pulse} ${truth.mode === "LIVE" ? "animate-pulse" : ""}`} />
          )}
          {truth.badge}
        </span>
        <span
          className="hidden font-mono-data font-semibold tracking-tight"
          data-testid="data-truth-asof"
        >
          {asOfLive ? `Live data as of ${asOfLive} IST` : truth.asOfLabel}
        </span>
        {mobileTicker ? (
          <div className="md:hidden min-w-0 flex-1 overflow-hidden">
            {mobileTicker}
          </div>
        ) : null}
        <span className="opacity-80 hidden sm:inline">·</span>
        <span className="opacity-90 text-xs sm:text-sm hidden sm:inline" data-testid="data-truth-detail">
          {truth.detail}
        </span>
      </div>
    </div>
  );
}
