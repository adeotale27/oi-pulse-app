import InfoTip from "@/components/InfoTip";

/**
 * Whole-day OI bias for the active index (9:15 IST → latest snapshot).
 * Compact desk strip — not a second “regime” of the header index tiles.
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
  const pct = (strength * 100).toFixed(0);
  const fill = `${(strength * 50).toFixed(1)}%`;

  const windowNote = wholeDay
    ? (marketOpen ? "9:15 → now" : "9:15 → close")
    : null;

  return (
    <div
      className="rounded-md border border-slate-200 bg-white overflow-hidden"
      data-testid="sentiment-bar"
      data-market={marketOpen ? "open" : "closed"}
      data-scope="session"
    >
      <div className="px-3 py-1.5 flex items-center gap-2 min-w-0">
        <span
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${
            isBullish ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
          }`}
        >
          {isBullish ? "Bullish" : "Bearish"}
        </span>
        <p className="text-[11px] text-slate-700 min-w-0 truncate">
          {isBullish ? "Put writers leading OI" : "Call writers leading OI"}
          {windowNote ? (
            <span className="text-slate-400 font-mono-data">
              {" "}
              · {windowNote}
              {sessionMinutes != null ? ` · ${sessionMinutes}m` : ""}
            </span>
          ) : null}
        </p>
        <InfoTip testId="day-bias-info" size="xs" title="Whole-day OI bias" className="shrink-0">
          <p>
            Session OI build on the active index from ≈ 9:15 IST. It does not follow the 1m / 15m
            pills. Bullish = put writing dominating call writing. Bearish = the opposite.
          </p>
          {!marketOpen && (
            <p className="mt-2 text-slate-500">Market closed — last session&apos;s final bias.</p>
          )}
        </InfoTip>
        <span
          className={`ml-auto shrink-0 font-mono-data text-xs font-semibold ${
            isBullish ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {isBullish ? "+" : "−"}
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 relative" aria-hidden>
        <div className="absolute top-0 left-1/2 -translate-x-px w-px h-full bg-slate-300" />
        <div
          className="absolute top-0 left-1/2 h-full"
          style={{
            width: fill,
            transform: isBullish ? "translateX(0)" : "translateX(-100%)",
            background: isBullish
              ? "linear-gradient(90deg, rgb(16 185 129 / 0.15), rgb(5 150 105))"
              : "linear-gradient(270deg, rgb(244 63 94 / 0.15), rgb(225 29 72))",
          }}
        />
      </div>
    </div>
  );
}
