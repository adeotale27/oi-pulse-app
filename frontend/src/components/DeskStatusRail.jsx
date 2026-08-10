import { KeyRound, AlertTriangle, Clock, CalendarOff, Moon, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildDataTruth, formatIstClock } from "@/lib/dataTruth";
import { useEffect, useMemo, useState } from "react";

const TRUTH_TONE = {
  live: { bar: "bg-emerald-600/95 text-white border-emerald-700", badge: "bg-white text-emerald-800", pulse: "bg-white" },
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
  const marketBits = (() => {
    if (!marketClosed) return null;
    const openHm = market.display_open_ist || "09:15";
    const closeHm = market.display_close_ist || "15:40";
    const title = market.banner_title || (
      phase === "pre_open" ? "Not open yet"
        : phase === "weekend" ? "Weekend"
          : phase === "holiday" ? "NSE holiday"
            : "Markets closed"
    );
    const short =
      phase === "pre_open" ? `Opens ${openHm}`
        : phase === "weekend" ? `Resumes ${openHm}`
          : phase === "holiday" ? "Suspended"
            : `Closed ${closeHm}`;
    const Icon = phase === "pre_open" ? Sunrise
      : phase === "weekend" || phase === "holiday" ? CalendarOff
        : phase === "post_close" ? Moon
          : Clock;
    return { title, short, Icon, sessionDate: dataStatus?.data_date || market.session_anchor_date };
  })();

  const kiteOk = status?.kite_ok === true || (status?.mode === "kite" && !status?.last_error && status?.has_kite_credentials);
  const tokenIssue = status?.kite_token_issue === true
    || status?.mode === "offline"
    || !status?.has_kite_credentials
    || (typeof status?.last_error === "string" && /token|api_key|unauthorized|forbidden|incorrect/i.test(status.last_error));
  const showKite = isAdmin && status && !(kiteOk && !tokenIssue)
    && !(
      (phase === "weekend" || phase === "holiday" || phase === "post_close")
      && status.has_kite_credentials
      && !status.last_error
    );
  const kiteTitle = !status?.has_kite_credentials
    ? "Kite not connected"
    : status?.last_error
      ? "Kite token dead"
      : "Kite offline";

  return (
    <div
      data-testid="desk-status-rail"
      role="status"
      aria-live="polite"
      className={`w-full border-b ${tone.bar} px-3 sm:px-4 py-1`}
    >
      <div className="flex items-center gap-2 sm:gap-3 text-[11px] flex-wrap min-w-0">
        <span
          className={`inline-flex items-center gap-1.5 font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-sm shrink-0 ${tone.badge}`}
          data-testid="data-truth-badge"
        >
          {(truth.mode === "LIVE" || truth.mode === "STALE") && (
            <span className={`w-1.5 h-1.5 rounded-full ${tone.pulse} ${truth.mode === "LIVE" ? "animate-pulse" : ""}`} />
          )}
          {truth.badge}
        </span>
        <span className="font-mono-data font-semibold truncate" data-testid="data-truth-asof">
          {asOfLive ? `as of ${asOfLive}` : truth.asOfLabel}
        </span>

        {marketBits && (
          <>
            <span className="opacity-50">·</span>
            <span className="inline-flex items-center gap-1 opacity-95" data-testid="market-status-banner">
              {(() => {
                const Icon = marketBits.Icon;
                return <Icon className="w-3 h-3 shrink-0" strokeWidth={2} />;
              })()}
              <span className="font-semibold">{marketBits.title}</span>
              <span className="opacity-80 hidden sm:inline">{marketBits.short}</span>
              {marketBits.sessionDate && (
                <span className="font-mono-data opacity-80 hidden md:inline">· {marketBits.sessionDate}</span>
              )}
              {lastPulledAt && (
                <span className="font-mono-data opacity-70 hidden lg:inline">
                  · snap {formatIstClock(lastPulledAt, false)}
                </span>
              )}
            </span>
          </>
        )}

        <span className="opacity-70 hidden xl:inline truncate" data-testid="data-truth-detail">
          · {truth.detail}
        </span>

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
