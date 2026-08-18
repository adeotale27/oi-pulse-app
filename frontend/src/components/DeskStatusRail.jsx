import { KeyRound, AlertTriangle, Clock, CalendarOff, Moon, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDataTruth, formatIstClock } from "@/lib/dataTruth";
import { isKiteCredentialProblem, kiteCredentialTitle } from "@/lib/kiteCredentialHealth";
import { useEffect, useMemo, useState } from "react";

const TRUTH_TONE = {
  live: { bar: "bg-emerald-600/95 text-white border-emerald-700", badge: "bg-white text-emerald-800", pulse: "bg-emerald-600" },
  session: { bar: "bg-[#022c22] text-emerald-50 border-[#011f18]", badge: "bg-amber-400 text-amber-950", pulse: "bg-amber-300" },
  warn: { bar: "bg-amber-500 text-amber-950 border-amber-600", badge: "bg-amber-950 text-amber-100", pulse: "bg-amber-950" },
  offline: { bar: "bg-rose-700 text-rose-50 border-rose-800", badge: "bg-rose-100 text-rose-900", pulse: "bg-rose-200" },
};

/**
 * Optional single slim status rail that merges DataTruth + market closed + Kite token
 * into one row so stacked banners stop stealing chart height.
 */
export default function DeskStatusRail({
  dataStatus,
  marketOpen,
  mode,
  snapshotTs,
  market,
  lastPulledAt,
  status,
  isAdmin = false,
  onOpenCreds,
  mobileTicker = null,
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const truth = useMemo(
    () => buildDataTruth({ dataStatus, marketOpen, mode, snapshotTs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataStatus, marketOpen, mode, snapshotTs, tick],
  );

  const tone = TRUTH_TONE[truth.tone] || TRUTH_TONE.offline;
  const asOfLive = truth.mode === "LIVE" ? formatIstClock(snapshotTs, true) : null;

  const phase = market?.phase || "post_close";
  const marketClosed = market && market.is_market_open === false;
  const closedAtClock = formatIstClock(lastPulledAt || snapshotTs, false);
  const sessionDate = dataStatus?.data_date || market?.session_anchor_date;
  const marketBits = (() => {
    if (!marketClosed) return null;
    const openHm = market.display_open_ist || "09:15";
    const phaseIsClosed = phase === "post_close" || phase === "closed";
    const title = (
      phase === "pre_open" ? (market.banner_title || "Not open yet")
        : phase === "weekend" ? (market.banner_title || "Weekend")
          : phase === "holiday" ? (market.banner_title || "NSE holiday")
            : `Market Closed${closedAtClock ? ` at ${closedAtClock}` : ""}`
    );
    const short =
      phase === "pre_open" ? `Opens ${openHm}`
        : phase === "weekend" ? `Resumes ${openHm}`
          : phase === "holiday" ? "Suspended"
            : "";
    const Icon = phase === "pre_open" ? Sunrise
      : phase === "weekend" || phase === "holiday" ? CalendarOff
        : phase === "post_close" || phaseIsClosed ? Moon
          : Clock;
    return { title, short, Icon };
  })();

  // Only real missing-credentials / dead-token cases — not brief mode=offline flaps.
  const showKite = isAdmin && status && isKiteCredentialProblem(status);
  const kiteTitle = kiteCredentialTitle(status);

  return (
    <div
      data-testid="desk-status-rail"
      role="status"
      aria-live="polite"
      className={`w-full border-b ${tone.bar} py-0.5`}
    >
      <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0 flex-nowrap overflow-x-auto overscroll-x-contain oi-hover-scroll px-1.5">
        <span
          className={`hidden md:inline-flex items-center gap-1 font-bold tracking-wide uppercase shrink-0 rounded-sm px-1.5 py-0.5 ${tone.badge}`}
          data-testid="data-truth-badge"
        >
          {(truth.mode === "LIVE" || truth.mode === "STALE") && (
            <span className={`w-1.5 h-1.5 rounded-full ${tone.pulse} ${truth.mode === "LIVE" ? "animate-pulse" : ""}`} />
          )}
          {truth.badge}
        </span>
        <span
          className={`hidden md:inline font-mono-data font-semibold tracking-tight shrink-0 ${truth.mode === "LIVE" ? "md:hidden" : ""}`}
          data-testid="data-truth-asof"
        >
          {truth.mode === "LAST_SESSION"
            ? (sessionDate || truth.asOfLabel)
            : (asOfLive ? `Live data as of ${asOfLive} IST` : truth.asOfLabel)}
        </span>
        {truth.mode !== "LAST_SESSION" && truth.detail ? (
          <span className="opacity-90 shrink-0 whitespace-nowrap pr-3 hidden md:inline" data-testid="data-truth-detail">
            {truth.detail}
          </span>
        ) : null}
        {mobileTicker ? (
          <div className="min-w-0 flex-1 overflow-hidden" data-testid="desk-index-ticker">
            {mobileTicker}
          </div>
        ) : null}

        {marketBits && (
          <>
            <span className="opacity-50 hidden md:inline ml-auto">·</span>
            <span
              className="hidden md:inline-flex items-center gap-1 opacity-95 shrink-0"
              data-testid="market-status-banner"
            >
              {(() => {
                const Icon = marketBits.Icon;
                return <Icon className="w-3 h-3 shrink-0" strokeWidth={2} />;
              })()}
              <span className="font-semibold whitespace-nowrap">{marketBits.title}</span>
              {marketBits.short ? (
                <span className="opacity-80 hidden lg:inline">{marketBits.short}</span>
              ) : null}
            </span>
          </>
        )}

        {showKite && (
          <span className="ml-auto inline-flex items-center gap-1.5 shrink-0" data-testid="kite-token-banner">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-semibold">{kiteTitle}</span>
            {onOpenCreds && (
              <Button
                data-testid="kite-banner-open-creds"
                size="sm"
                className="h-6 rounded-sm bg-white/95 text-rose-800 hover:bg-white px-2 text-[10px]"
                onClick={onOpenCreds}
              >
                <KeyRound className="w-3 h-3 mr-1" />
                Reconnect
              </Button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
