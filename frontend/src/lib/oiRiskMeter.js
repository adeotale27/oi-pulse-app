/**
 * Intraday OI risk for a non-directional seller.
 * New writing near a short = decide Hold / Reduce / Close.
 */
export function computeOiRisk({
  cePct = 0,
  pePct = 0,
  nearestShortDistPct = null,
  nearestShortSide = null,
  breachedAdjust = false,
} = {}) {
  const ce = Number(cePct) || 0;
  const pe = Number(pePct) || 0;
  const oiPct = Math.max(Math.abs(ce), Math.abs(pe));
  const dist = nearestShortDistPct == null ? null : Math.abs(Number(nearestShortDistPct));
  const writingToward =
    nearestShortSide === "CE" ? ce > 0 : nearestShortSide === "PE" ? pe > 0 : oiPct > 0 && (ce > 0 || pe > 0);

  let action = "Hold";
  let reason = "No sold strikes, or market still away.";
  if (dist == null) {
    return { oiPct, distPct: null, action, reason, writingToward };
  }
  if (breachedAdjust || dist < 0.6) {
    action = "Close";
    reason = dist < 0.6
      ? "Spot is inside 0.6% of a sold strike — exit or hard hedge."
      : "Sold strike is inside your warn band — exit or roll now.";
  } else if (dist < 1.2 || (oiPct >= 8 && writingToward && dist < 2.5)) {
    action = "Reduce";
    reason = oiPct >= 8 && writingToward
      ? "Fresh OI building toward your short — cut size or roll with the trend."
      : "Nearest short is getting close — reduce before it becomes a close.";
  } else {
    action = "Hold";
    reason = "Distance and 15-min OI still favour sitting on theta.";
  }
  return { oiPct, distPct: dist, action, reason, writingToward };
}

export function oiChangePctFromSnapshots(current, previous) {
  if (!current?.strikes || !previous?.strikes) return { cePct: 0, pePct: 0 };
  const prevMap = new Map(previous.strikes.map((s) => [s.strike, s]));
  let ce = 0, pe = 0, baseCE = 0, basePE = 0;
  for (const s of current.strikes) {
    const p = prevMap.get(s.strike);
    if (!p) continue;
    ce += (s.ce_oi || 0) - (p.ce_oi || 0);
    pe += (s.pe_oi || 0) - (p.pe_oi || 0);
    baseCE += p.ce_oi || 0;
    basePE += p.pe_oi || 0;
  }
  return {
    cePct: baseCE > 0 ? (ce / baseCE) * 100 : 0,
    pePct: basePE > 0 ? (pe / basePE) * 100 : 0,
  };
}
