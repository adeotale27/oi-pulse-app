// Strike Pressure: toward/away of underlying vs live option strike.
// Reuses existing buildup classification and compact OI already on Positions.

import { classifyBuildups } from "./buildup.js";

export const PRESSURE_LABELS = {
  strongToward: "STRONG TOWARD",
  toward: "TOWARD",
  neutral: "NEUTRAL",
  away: "AWAY",
  strongAway: "STRONG AWAY",
  unavailable: "DATA UNAVAILABLE",
};

export function labelFromScore(score) {
  if (!Number.isFinite(score)) return PRESSURE_LABELS.unavailable;
  if (score >= 75) return PRESSURE_LABELS.strongToward;
  if (score >= 35) return PRESSURE_LABELS.toward;
  if (score <= -75) return PRESSURE_LABELS.strongAway;
  if (score <= -35) return PRESSURE_LABELS.away;
  return PRESSURE_LABELS.neutral;
}

export function pressureDir(label) {
  if (label === PRESSURE_LABELS.strongToward || label === PRESSURE_LABELS.toward) return "toward";
  if (label === PRESSURE_LABELS.strongAway || label === PRESSURE_LABELS.away) return "away";
  if (label === PRESSURE_LABELS.unavailable) return "unavailable";
  return "neutral";
}

/** Separate from market pressure: toward is risk for shorts, favourable for longs. */
export function positionImpact({ isShort, label }) {
  const dir = pressureDir(label);
  if (dir === "unavailable" || dir === "neutral") return "NEUTRAL";
  const strong = label === PRESSURE_LABELS.strongToward || label === PRESSURE_LABELS.strongAway;
  if (dir === "toward") {
    if (isShort) return strong ? "HIGH RISK" : "CAUTION";
    return "FAVOURABLE";
  }
  if (isShort) return "FAVOURABLE";
  return strong ? "HIGH RISK" : "CAUTION";
}

function ymd(iso) {
  return String(iso || "").slice(0, 10);
}

function snapForPosition(oiByIndex, row) {
  const idx = row?.index;
  if (!idx || !oiByIndex) return null;
  const snap = oiByIndex[idx];
  if (!snap) return null;
  const se = ymd(snap.expiry);
  const pe = ymd(row.expiryIso || row.expiry_iso);
  if (se && pe && se !== pe) return null;
  return snap;
}

function nearestStrikeRow(strikes, strike) {
  if (!Array.isArray(strikes) || strike == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const s of strikes) {
    const d = Math.abs(Number(s.strike) - Number(strike));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function oiChangePct(cur, prev, side) {
  const key = side === "PE" ? "pe_oi" : "ce_oi";
  const a = Number(cur?.[key]);
  const b = Number(prev?.[key]);
  if (!(b > 0) || !Number.isFinite(a)) return null;
  return ((a - b) / b) * 100;
}

function confirmFromBuildup(code, toward) {
  if (!code || code === "FLAT") return 0;
  if (toward > 0) {
    if (code === "SHORT_BUILD" || code === "LONG_BUILD") return 1;
    if (code === "SHORT_COVER" || code === "LONG_UNWIND") return -1;
  }
  if (toward < 0) {
    if (code === "LONG_UNWIND" || code === "SHORT_COVER") return 1;
    if (code === "SHORT_BUILD" || code === "LONG_BUILD") return -1;
  }
  return 0;
}

/**
 * Pure score. prevAbsDistance: previous |spot-strike|.
 * buildupCode: existing classifyStrike side code (LONG_BUILD, …).
 */
export function scoreStrikePressure({
  spot,
  strike,
  prevAbsDistance,
  oiChangePct: dOi,
  buildupCode,
  nearbyOiChangePct,
} = {}) {
  const S = Number(spot);
  const K = Number(strike);
  if (!(S > 0) || !(K > 0)) {
    return { score: null, label: PRESSURE_LABELS.unavailable, reasons: ["No spot or strike"] };
  }
  const dist = Math.abs(S - K);
  const reasons = [`Distance: ${Math.round(dist)} pts`];
  let score = 0;
  let towardSign = 0;
  if (Number.isFinite(prevAbsDistance)) {
    const delta = prevAbsDistance - dist;
    if (delta > 2) {
      score += 50;
      towardSign = 1;
      reasons.push("Recent distance: decreasing");
    } else if (delta < -2) {
      score -= 50;
      towardSign = -1;
      reasons.push("Recent distance: increasing");
    } else {
      reasons.push("Recent distance: little change");
    }
  } else {
    reasons.push("Recent distance: waiting for next tick");
  }

  const oiN = Number(dOi);
  if (Number.isFinite(oiN) && Math.abs(oiN) >= 0.5) {
    reasons.push(`OI Change: ${oiN >= 0 ? "+" : ""}${Math.round(oiN * 10) / 10}%`);
  }
  if (buildupCode && buildupCode !== "FLAT") {
    reasons.push(`Build-up: ${buildupCode.replace(/_/g, " ")}`);
  }

  if (towardSign !== 0) {
    const c = confirmFromBuildup(buildupCode, towardSign);
    if (c > 0) {
      score += towardSign > 0 ? 30 : -30;
      reasons.push("OI/activity confirms pressure");
    } else if (c < 0) {
      score = Math.round(score * 0.25);
      reasons.push("OI/activity conflicts — confidence reduced");
    }
    if (Number.isFinite(nearbyOiChangePct) && Math.abs(nearbyOiChangePct) >= 1) {
      const nearWith = (towardSign > 0 && nearbyOiChangePct > 0) || (towardSign < 0 && nearbyOiChangePct < 0);
      if (nearWith) score += towardSign > 0 ? 10 : -10;
    }
  } else if (buildupCode && buildupCode !== "FLAT") {
    score = 0;
    reasons.push("No clear distance move — NEUTRAL");
  }

  score = Math.max(-100, Math.min(100, score));
  return { score, label: labelFromScore(score), reasons, dist, spot: S, strike: K };
}

export function formatPressureCompact(result) {
  const label = result?.label || PRESSURE_LABELS.neutral;
  const impact = result?.impact || "NEUTRAL";
  if (label === PRESSURE_LABELS.unavailable) return { arrow: "—", pressure: label, impact: "NEUTRAL" };
  if (pressureDir(label) === "toward") return { arrow: "↑", pressure: label, impact };
  if (pressureDir(label) === "away") return { arrow: "↓", pressure: label, impact };
  return { arrow: "→", pressure: label, impact };
}

export function computeStrikePressureForRow(row, { oiByIndex, prevOiByIndex, prevAbsDistance } = {}) {
  try {
    if (!row || row.exited || !row.isOpt) {
      return { label: PRESSURE_LABELS.neutral, impact: "NEUTRAL", score: 0, reasons: ["Not an open option"] };
    }
    const spot = Number(row.spotUsed);
    const strike = Number(row.strike);
    const side = row.side === "PE" ? "PE" : "CE";
    const snap = snapForPosition(oiByIndex, row);
    const prevSnap = snapForPosition(prevOiByIndex, row);
    let buildupCode = null;
    let dOi = null;
    let nearby = null;
    if (snap?.strikes?.length && prevSnap?.strikes?.length) {
      const rows = classifyBuildups({ current: snap, previous: prevSnap });
      const hit = rows.find((x) => Number(x.strike) === strike) || nearestStrikeRow(rows, strike);
      if (hit) {
        buildupCode = side === "PE" ? hit.pe?.code : hit.ce?.code;
        dOi = side === "PE" ? hit.pe_oi_pct : hit.ce_oi_pct;
      }
      const neighbors = rows.filter((x) => Math.abs(Number(x.strike) - strike) > 0 && Math.abs(Number(x.strike) - strike) <= (Number(snap.step) || 100) * 2);
      if (neighbors.length) {
        const pcts = neighbors.map((n) => (side === "PE" ? n.pe_oi_pct : n.ce_oi_pct)).filter((n) => Number.isFinite(n));
        if (pcts.length) nearby = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      }
    } else if (snap?.strikes?.length && prevSnap?.strikes?.length === undefined) {
      const cur = nearestStrikeRow(snap.strikes, strike);
      const prev = nearestStrikeRow(prevSnap?.strikes, strike);
      dOi = oiChangePct(cur, prev, side);
    }
    const scored = scoreStrikePressure({
      spot,
      strike,
      prevAbsDistance,
      oiChangePct: dOi,
      buildupCode,
      nearbyOiChangePct: nearby,
    });
    const impact = positionImpact({ isShort: !!row.isShort, label: scored.label });
    return {
      ...scored,
      impact,
      optionType: side,
      isShort: !!row.isShort,
      underlying: row.index || "",
      buildupCode,
      oiChangePct: dOi,
    };
  } catch {
    return { label: PRESSURE_LABELS.unavailable, impact: "NEUTRAL", score: null, reasons: ["Calculation skipped"] };
  }
}

export function computeAllStrikePressure(rows, ctx = {}) {
  const prevDist = ctx.prevDistMap || new Map();
  const out = {};
  const nextDist = new Map(prevDist);
  for (const r of rows || []) {
    const key = r.tradingsymbol;
    const dist = r.isOpt && Number(r.spotUsed) > 0 && Number(r.strike) > 0
      ? Math.abs(Number(r.spotUsed) - Number(r.strike))
      : null;
    const prevAbs = key != null ? prevDist.get(key) : null;
    out[key] = computeStrikePressureForRow(r, { ...ctx, prevAbsDistance: prevAbs });
    if (dist != null && key != null) nextDist.set(key, dist);
  }
  return { bySymbol: out, nextDistMap: nextDist };
}
