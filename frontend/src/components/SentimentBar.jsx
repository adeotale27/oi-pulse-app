/**
 * Sentiment bar — live bullish/bearish pressure from CE/PE OI change.
 * After market close: do NOT show live "Bullish/Bearish pressure" — show a
 * neutral market-closed strip so traders know OI bias is no longer updating.
 */
export default function SentimentBar({ ceDelta, peDelta, timeframeMin, marketOpen = true }) {
  if (!marketOpen) {
    return (
      <div
        className="rounded-sm border border-slate-200 dark:border-slate-700 overflow-hidden"
        data-testid="sentiment-bar"
        data-market="closed"
      >
        <div className="px-3 py-2 flex items-center justify-between bg-slate-100 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700 dark:text-slate-200">Market closed</span>
            <span className="text-[10px] text-slate-500 font-mono-data">
              · last session bias paused — OI not updating
            </span>
          </div>
          <span className="font-mono-data text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            EOD
          </span>
        </div>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  // net = peDelta - ceDelta.
  //   >0 => put writers dominating (bullish)
  //   <0 => call writers dominating (bearish)
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
    ? "Bullish pressure · Put writers dominating"
    : "Bearish pressure · Call writers dominating";
  const pct = (strength * 100).toFixed(0);

  return (
    <div className="rounded-sm border border-slate-200 overflow-hidden" data-testid="sentiment-bar" data-market="open">
      <div className="px-3 py-2 flex items-center justify-between" style={{ background: bg }}>
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="w-2 h-2 rounded-full" style={{ background: barColor }} />
          <span className="text-slate-800">{label}</span>
          <span className="text-[10px] text-slate-500 font-mono-data">· last {timeframeMin} min</span>
        </div>
        <span className="font-mono-data text-xs font-semibold" style={{ color: barColor }}>
          {isBullish ? "+" : "-"}{pct}%
        </span>
      </div>
      <div className="h-2 bg-slate-100 relative">
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
