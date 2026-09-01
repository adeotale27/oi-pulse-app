/** Index ticker regime from session tape — not Positions Brains path risk.

Uses net % vs previous close and the day's high–low span.
Ranging = chop (range wider than the net move). Quiet = both tiny.
Trend = most of the day's travel is one-way. Bullish / risk-off = strong net %.
*/

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

export function tickerRegimeSnapshot(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null) {
  const pct = Number(changePct);
  const ref = Number(prevClose) || 0;
  const live = Number(ltp);
  const hasLive = Number.isFinite(live) && live > 0;
  const hi = Number(dayHigh);
  const lo = Number(dayLow);
  const hasSpan = Number.isFinite(hi) && Number.isFinite(lo) && ref > 0 && hi >= lo;

  let netPct = Number.isFinite(pct) ? pct : NaN;
  if (hasLive && ref > 0) {
    netPct = ((live - ref) / ref) * 100;
  }
  const spanPct = hasSpan ? ((hi - lo) / ref) * 100 : 0;
  const loc = hasSpan && hi > lo && hasLive ? (live - lo) / (hi - lo) : null;

  return {
    isFlat: !!isFlat,
    netPct,
    spanPct,
    hasLive,
    hasSpan,
    loc,
  };
}

export function classifyTickerRegime(snap) {
  if (!snap || snap.isFlat || !Number.isFinite(snap.netPct)) return "steady";
  const absNet = Math.abs(snap.netPct);
  const span = Number(snap.spanPct) || 0;
  const net = snap.netPct;

  // Chop: a real day range, but net from prev close is only a slice of it.
  if (snap.hasSpan && span >= 0.22 && absNet <= span * 0.45 && absNet < 0.45) {
    return "range";
  }
  if (absNet >= 0.7) return net > 0 ? "bullish" : "risk-off";
  if (absNet >= 0.22) {
    if (snap.hasSpan && span > 0 && absNet >= span * 0.55) return "trending";
    if (absNet >= 0.45) return net > 0 ? "bullish" : "risk-off";
    return "trending";
  }
  return "steady";
}

export function getTickerRegime(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null) {
  return classifyTickerRegime(
    tickerRegimeSnapshot(changePct, isFlat, prevClose, dayHigh, dayLow, ltp),
  );
}

export const TICKER_REGIME_GUIDE = {
  bullish: {
    label: "Bullish",
    text: "Net move from previous close is strongly up. Buyers are in control of the session print — short-call risk is more fragile than short-put risk.",
  },
  trending: {
    label: "Trend",
    text: "Most of today’s high–low is a one-way move from previous close, not a round trip. Directional; size and hedges matter more than fade-the-range.",
  },
  "risk-off": {
    label: "Risk-off",
    text: "Net move from previous close is strongly down. Defensive flow; short-put risk is more fragile than short-call risk.",
  },
  range: {
    label: "Ranging",
    text: "The day’s high–low is wider than the net change from previous close, so price is chopping in a band. Mean-reversion / theta selling is more relevant than chasing a trend — until the band breaks.",
  },
  steady: {
    label: "Quiet",
    text: "Both the net move and the day’s range are small. No fresh directional edge from the index tape alone.",
  },
};

export function tickerRegimeWhy(snap, key) {
  if (!snap || !Number.isFinite(snap.netPct)) return "Not enough price to classify.";
  const net = `${snap.netPct >= 0 ? "+" : ""}${round1(snap.netPct)}% from prev close`;
  if (!snap.hasSpan) {
    return `${net}. Day high–low not on the tape, so this is from net % only.`;
  }
  const span = `day range ${round1(snap.spanPct)}% of prev close`;
  if (key === "range") {
    return `${net}. ${span}. Net is a small slice of the range → ranging (chop, not a one-way day).`;
  }
  if (key === "trending") {
    return `${net}. ${span}. Most of the day’s travel is that net move → trend.`;
  }
  if (key === "bullish" || key === "risk-off") {
    return `${net}. ${span}. Strong session move.`;
  }
  return `${net}. ${span}. Both small → quiet.`;
}

export function describeTickerRegime(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null) {
  const snap = tickerRegimeSnapshot(changePct, isFlat, prevClose, dayHigh, dayLow, ltp);
  const key = classifyTickerRegime(snap);
  const guide = TICKER_REGIME_GUIDE[key] || TICKER_REGIME_GUIDE.steady;
  return {
    key,
    label: guide.label,
    text: guide.text,
    why: tickerRegimeWhy(snap, key),
  };
}

export function tickerRegimeChipClass(key, { onDark = false } = {}) {
  if (onDark) {
    return "bg-white/15 text-white border-white/25";
  }
  return (
    {
      bullish: "bg-emerald-50 text-emerald-800 border-emerald-200",
      trending: "bg-sky-50 text-sky-800 border-sky-200",
      "risk-off": "bg-rose-50 text-rose-800 border-rose-200",
      range: "bg-amber-50 text-amber-900 border-amber-200",
      steady: "bg-slate-100 text-slate-600 border-slate-200",
    }[key] || "bg-slate-100 text-slate-600 border-slate-200"
  );
}

export function tickerRegimeLabel(regime) {
  return TICKER_REGIME_GUIDE[regime]?.label || TICKER_REGIME_GUIDE.steady.label;
}
