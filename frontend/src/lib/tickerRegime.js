/** Session regime from OHLC tape — not net-% vs previous close alone. */

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function round1(x) {
  return Math.round(Number(x) * 10) / 10;
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

export const TICKER_REGIME_GUIDE = {
  "bull-trend": {
    label: "BULL TREND",
    text: "Session is travelling one way higher from the open (or recovered a gap and held the upper range).",
  },
  "bear-trend": {
    label: "BEAR TREND",
    text: "Session is travelling one way lower from the open. Directional, not automatically risk-off.",
  },
  "risk-off": {
    label: "RISK-OFF",
    text: "Crash-style tape: very large one-way drop, price pinned to the low. A normal down-trend day is BEAR TREND, not this.",
  },
  range: {
    label: "RANGING",
    text: "Meaningful day range but net travel is a small slice — two-way chop.",
  },
  steady: {
    label: "QUIET",
    text: "Both net move and day range are small versus the index’s own scale.",
  },
  unavailable: {
    label: "UNAVAILABLE",
    text: "Not enough previous close / open / live price to classify.",
  },
};

export function tickerRegimeSnapshot(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null, dayOpen = null) {
  const prev = n(prevClose);
  const live = n(ltp);
  const hasLive = live > 0;
  let price = hasLive ? live : NaN;
  if (!(price > 0) && prev > 0 && Number.isFinite(n(changePct))) {
    price = prev * (1 + n(changePct) / 100);
  }
  const open = n(dayOpen) > 0 ? n(dayOpen) : (prev > 0 ? prev : NaN);
  const hi0 = n(dayHigh);
  const lo0 = n(dayLow);
  const hi = Math.max(...[hi0, open, price].filter((x) => x > 0));
  const lo = Math.min(...[lo0, open, price].filter((x) => x > 0));
  const hasSpan = hi > 0 && lo > 0 && hi >= lo && prev > 0;
  const rangePts = hasSpan ? hi - lo : 0;
  const netPct = price > 0 && prev > 0 ? ((price - prev) / prev) * 100 : n(changePct);
  const gapPct = open > 0 && prev > 0 ? ((open - prev) / prev) * 100 : 0;
  const intraPct = price > 0 && open > 0 ? ((price - open) / open) * 100 : NaN;
  const spanPct = hasSpan ? (rangePts / prev) * 100 : 0;
  const loc = hasSpan && rangePts > 0 && price > 0 ? (price - lo) / rangePts : null;
  const effIntra = hasSpan && rangePts > 0 && Number.isFinite(intraPct) ? Math.abs(price - open) / rangePts : null;
  const effNet = hasSpan && rangePts > 0 && price > 0 ? Math.abs(price - prev) / rangePts : null;
  return {
    isFlat: !!isFlat,
    netPct,
    gapPct,
    intraPct,
    spanPct,
    loc,
    effIntra,
    effNet,
    hasLive,
    hasSpan,
    prev,
    open,
    high: hi,
    low: lo,
    price,
    rangePts,
  };
}

export function classifyTickerRegime(snap) {
  if (!snap || snap.isFlat) {
    if (snap && Number.isFinite(snap.spanPct) && snap.spanPct < 0.18) return "steady";
  }
  if (!snap || !Number.isFinite(snap.netPct) || !(snap.prev > 0)) return "unavailable";
  const absNet = Math.abs(snap.netPct);
  const span = Number(snap.spanPct) || 0;
  const intra = Number.isFinite(snap.intraPct) ? snap.intraPct : snap.netPct;
  const absIntra = Math.abs(intra);
  const loc = snap.loc;
  const eff = Number(snap.effIntra ?? snap.effNet) || 0;
  const gap = Number(snap.gapPct) || 0;

  if (span < 0.18 && absNet < 0.18 && absIntra < 0.18) return "steady";

  const recoveringUp = gap < -0.12 && intra > 0.2 && (loc == null || loc >= 0.5);
  const reversingDown = gap > 0.12 && intra < -0.25 && (loc == null || loc <= 0.5);
  if (recoveringUp) return "bull-trend";

  const nearLow = loc != null && loc <= 0.18;
  const nearHigh = loc != null && loc >= 0.72;
  const downCont = intra < -0.12 && (snap.price <= snap.open || !Number.isFinite(snap.open));
  // RISK-OFF is a crash/air-pocket tape, not a normal one-way down day (~0.5–1.3%).
  const strongDown =
    downCont &&
    nearLow &&
    eff >= 0.7 &&
    span >= 1.15 &&
    absIntra >= 1.45 &&
    absNet >= 1.45;
  if (strongDown && !recoveringUp) return "risk-off";
  if (reversingDown && nearLow && span >= 1.4 && absIntra >= 1.6 && absNet >= 1.2) return "risk-off";

  if (span >= 0.22 && absNet <= span * 0.42 && absIntra <= Math.max(0.35, span * 0.5) && loc != null && loc > 0.28 && loc < 0.72) {
    return "range";
  }
  if (span >= 0.28 && absNet < 0.22 && absIntra < 0.28 && (eff < 0.42 || (loc != null && loc > 0.3 && loc < 0.7))) {
    return "range";
  }

  if (intra > 0.1 && (nearHigh || (loc != null && loc >= 0.58 && eff >= 0.42) || (eff >= 0.55 && intra > 0))) {
    return "bull-trend";
  }
  if (intra < -0.1 && (nearLow || (loc != null && loc <= 0.42 && eff >= 0.42) || (eff >= 0.55 && intra < 0))) {
    return "bear-trend";
  }
  if (absNet >= 0.22 && span > 0 && absNet >= span * 0.55) {
    return snap.netPct > 0 ? "bull-trend" : "bear-trend";
  }
  if (absNet >= 0.45 && intra > 0) return "bull-trend";
  if (absNet >= 0.45 && intra < 0 && !nearLow) return "bear-trend";
  if (absNet >= 0.45 && intra < 0 && nearLow && span < 0.4) return "bear-trend";
  if (span >= 0.22 && absNet < 0.45) return "range";
  return "steady";
}

export function getTickerRegime(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null, dayOpen = null) {
  return classifyTickerRegime(
    tickerRegimeSnapshot(changePct, isFlat, prevClose, dayHigh, dayLow, ltp, dayOpen),
  );
}

export function tickerRegimeWhy(snap, key) {
  if (!snap || key === "unavailable" || !Number.isFinite(snap.netPct)) {
    return "Not enough previous close / live price to classify.";
  }
  const bits = [];
  if (Number.isFinite(snap.gapPct)) bits.push(`Gap ${snap.gapPct >= 0 ? "+" : ""}${round2(snap.gapPct)}%`);
  if (Number.isFinite(snap.intraPct)) bits.push(`from open ${snap.intraPct >= 0 ? "+" : ""}${round2(snap.intraPct)}%`);
  bits.push(`vs prev ${snap.netPct >= 0 ? "+" : ""}${round1(snap.netPct)}%`);
  if (snap.hasSpan) {
    bits.push(`range ${round1(snap.spanPct)}%`);
    if (snap.loc != null) bits.push(`in range ${Math.round(snap.loc * 100)}%`);
    if (snap.effIntra != null) bits.push(`efficiency ${Math.round(snap.effIntra * 100)}%`);
  }
  const why = {
    "bull-trend": "One-way bid from the open, or gap recovered into the upper range.",
    "bear-trend": "One-way offer from the open. Mild/moderate decline is trend, not risk-off.",
    "risk-off": "Crash-style drop pinned to the low. A normal trending-down session is BEAR TREND.",
    range: "Wide two-way range; net move is only a slice of the day’s travel.",
    steady: "Small net and small range — quiet tape.",
  }[key] || "";
  return `${bits.join(" · ")}. ${why}`;
}

export function describeTickerRegime(changePct, isFlat, prevClose = 0, dayHigh = null, dayLow = null, ltp = null, dayOpen = null) {
  try {
    const snap = tickerRegimeSnapshot(changePct, isFlat, prevClose, dayHigh, dayLow, ltp, dayOpen);
    const key = classifyTickerRegime(snap);
    const guide = TICKER_REGIME_GUIDE[key] || TICKER_REGIME_GUIDE.steady;
    return {
      key,
      label: guide.label,
      text: guide.text,
      why: tickerRegimeWhy(snap, key),
      snap,
    };
  } catch {
    const guide = TICKER_REGIME_GUIDE.unavailable;
    return { key: "unavailable", label: guide.label, text: guide.text, why: guide.text, snap: null };
  }
}

export function tickerRegimeChipClass(key, { onDark = false } = {}) {
  if (onDark) return "bg-white/15 text-white border-white/25";
  return (
    {
      "bull-trend": "bg-emerald-50 text-emerald-800 border-emerald-200",
      bullish: "bg-emerald-50 text-emerald-800 border-emerald-200",
      "bear-trend": "bg-orange-50 text-orange-900 border-orange-200",
      trending: "bg-sky-50 text-sky-800 border-sky-200",
      "risk-off": "bg-rose-50 text-rose-800 border-rose-200",
      range: "bg-amber-50 text-amber-900 border-amber-200",
      steady: "bg-slate-100 text-slate-600 border-slate-200",
      unavailable: "bg-slate-50 text-slate-500 border-slate-200",
    }[key] || "bg-slate-100 text-slate-600 border-slate-200"
  );
}

export function tickerRegimeLabel(regime) {
  return TICKER_REGIME_GUIDE[regime]?.label || TICKER_REGIME_GUIDE.steady.label;
}
