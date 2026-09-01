/** Index ticker regime from session move — not Positions Brains path risk. */

export function getTickerRegime(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null) {
  if (isFlat || !Number.isFinite(Number(changePct))) return "steady";

  const absMove = Math.abs(Number(changePct) || 0);
  const refBasis = Number(prevClose) || 0;
  const livePrice = Number(ltp);
  const hasLive = Number.isFinite(livePrice) && livePrice > 0;
  const moveFromPrev = hasLive && refBasis > 0
    ? Math.abs((livePrice - refBasis) / refBasis) * 100
    : absMove;
  const hi = Number(dayHigh);
  const lo = Number(dayLow);
  const hasSpan = Number.isFinite(hi) && Number.isFinite(lo) && refBasis > 0;
  const intradaySpan = hasSpan ? ((hi - lo) / refBasis) * 100 : 0;
  const signed = Number(changePct) || 0;

  if (moveFromPrev >= 0.7) return signed > 0 ? "bullish" : "risk-off";
  if (moveFromPrev >= 0.18) return "trending";
  if (hasSpan && intradaySpan <= 0.5) return "range";
  if (absMove < 0.18) return "range";
  return "steady";
}

export const TICKER_REGIME_GUIDE = {
  bullish: {
    label: "Bullish",
    text: "Bullish means the index is holding above support and buyers are leading. This often supports continuation, but can also make call-side risk more fragile if momentum gets too aggressive.",
  },
  trending: {
    label: "Trend",
    text: "Trend means the move is directional and persistent. This can still work, but it usually demands tighter risk control and more caution on heavy short-call exposure.",
  },
  "risk-off": {
    label: "Risk-off",
    text: "Risk-off means the market is reducing exposure and defensive flows are dominating. This usually weakens bullish conviction and can favour wider risk ranges or lower premium selling aggression.",
  },
  range: {
    label: "Range",
    text: "Range means the market is oscillating without a fresh directional push. This is often a better environment for theta-friendly, mean-reversion-style selling when the range remains intact.",
  },
  steady: {
    label: "Steady",
    text: "Steady means the market is calm and not showing a strong directional move. This usually means lower urgency and more patience before adding or reducing risk.",
  },
};

export function tickerRegimeLabel(regime) {
  return TICKER_REGIME_GUIDE[regime]?.label || "Steady";
}
