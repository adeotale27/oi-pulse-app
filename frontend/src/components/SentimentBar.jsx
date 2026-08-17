import InfoTip from "@/components/InfoTip";

/**
 * Sentiment / bias bar — always reflects WHOLE-DAY OI bias
 * (session open ≈ 9:15 IST → latest snapshot), not the timeframe pill.
 * Same methodology for every index (NIFTY / SENSEX / BANKNIFTY).
 *
 * After market close we still show that session's final day bias (not a blank EOD strip).
 */
export default function SentimentBar({
  ceDelta,
  peDelta,
  marketOpen = true,
  wholeDay = true,
  sessionMinutes = null,
}) {
  const total = Math.abs(ceDelta) + Math.abs(peDelta) || 1;
  const net = peDelta - ceDelta;
  const ratio = Math.max(-1, Math.min(1, net / total));
  const strength = Math.min(1, Math.abs(ratio));
  const isBullish = ratio >= 0;

  const bg = isBullish
    ? `rgba(22, 163, 74, ${0.08 + 0.55 * strength})`
    : `rgba(220, 38, 38, ${0.08 + 0.55 * strength})`;
  const barColor = isBullish ? "#16A34A" : "#DC2626";
  const label = isBullish
    ? "Bullish bias · Put writers dominating"
    : "Bearish bias · Call writers dominating";
  const pct = (strength * 100).toFixed(0);

  const windowNote = wholeDay
    ? (marketOpen ? "whole day · 9:15 → now" : "whole day · 9:15 → session close")
    : null;

  return (
    <div
      className="rounded-sm border border-slate-200 dark:border-slate-700 overflow-hidden"
      data-testid="sentiment-bar"
      data-market={marketOpen ? "open" : "closed"}
      data-scope="session"
    >
      <div className="px-3 py-2 max-md:px-2 max-md:py-1 flex items-center justify-between gap-2" style={{ background: bg }}>
        <div className="flex items-center gap-2 text-xs max-md:text-[10px] font-medium min-w-0 flex-wrap">
          <span className="w-2 h-2 max-md:w-1.5 max-md:h-1.5 rounded-full shrink-0" style={{ background: barColor }} />
          <span className="text-slate-800 dark:text-slate-100 max-md:truncate">{label}</span>
          {windowNote && (
            <span className="hidden md:inline text-[10px] text-slate-500 dark:text-slate-400 font-mono-data">
              · {windowNote}
              {sessionMinutes != null ? ` (${sessionMinutes}m)` : ""}
            </span>
          )}
          <InfoTip
            testId="day-bias-info"
            size="xs"
            title="Whole-day bias"
            className="shrink-0"
          >
            <p>
              This bar shows the <strong>whole session&apos;s OI bias</strong> for the
              active index — from market open (≈ 9:15 IST) through the latest snapshot
              (or session close after EOD). It does <strong>not</strong> follow the
              timeframe pills (1m / 15m / etc.).
            </p>
            <p className="mt-2">
              <strong>Bullish</strong> = Put OI build dominating Call OI build across
              the visible strikes. <strong>Bearish</strong> = the opposite. The same
              method is used for NIFTY, SENSEX and BANK NIFTY — each index has its own
              day bias from its own data.
            </p>
            {!marketOpen && (
              <p className="mt-2 text-slate-500">
                Market is closed — this is the final bias for the last session, not a live tick.
              </p>
            )}
          </InfoTip>
        </div>
        <span className="font-mono-data text-xs font-semibold shrink-0" style={{ color: barColor }}>
          {isBullish ? "+" : "−"}{pct}%
        </span>
      </div>
      <div className="h-2 max-md:h-1 bg-slate-100 dark:bg-slate-800 relative">
        <div
          className="absolute top-0 left-1/2 h-full transition-all duration-500"
          style={{
            width: `${(strength * 50).toFixed(1)}%`,
            transform: isBullish ? "translateX(0)" : "translateX(-100%)",
            background: `linear-gradient(${isBullish ? "90deg" : "270deg"}, ${barColor}00, ${barColor})`,
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-px w-px h-full bg-slate-400" />
      </div>
    </div>
  );
}
