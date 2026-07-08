/**
 * Sentiment bar - shows a thick horizontal bar whose color/intensity
 * indicates bullish (green, PE OI building) vs bearish (red, CE OI building)
 * pressure based on the aggregate OI change vs previous snapshot.
 */
export default function SentimentBar({ ceDelta, peDelta, timeframeMin }) {
  // net = peDelta - ceDelta.
  //   >0 => put writers dominating (bullish)
  //   <0 => call writers dominating (bearish)
  const total = Math.abs(ceDelta) + Math.abs(peDelta) || 1;
  const net = peDelta - ceDelta;
  const ratio = Math.max(-1, Math.min(1, net / total));
  const strength = Math.min(1, Math.abs(ratio));
  const isBullish = ratio >= 0;

  // Interpolate: 0 strength = pale, 1 strength = deep saturated
  const bg = isBullish
    ? `rgba(22, 163, 74, ${0.08 + 0.55 * strength})`
    : `rgba(220, 38, 38, ${0.08 + 0.55 * strength})`;
  const barColor = isBullish ? "#16A34A" : "#DC2626";
  const label = isBullish ? "Bullish pressure · Put writers dominating" : "Bearish pressure · Call writers dominating";
  const pct = (strength * 100).toFixed(0);

  return (
    <div className="rounded-sm border border-slate-200 overflow-hidden" data-testid="sentiment-bar">
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
