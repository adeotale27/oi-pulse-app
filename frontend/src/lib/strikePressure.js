// Strike Pressure: underlying path vs strike dominates; OI/premium confirm.

import { classifyBuildups } from "./buildup.js";

export const PRESSURE_LABELS = {
  strongToward: "STRONG TOWARD",
  toward: "TOWARD",
  neutral: "NEUTRAL",
  away: "AWAY",
  strongAway: "STRONG AWAY",
  unavailable: "DATA UNAVAILABLE",
};

const RING = new Map();
const LAST = new Map();
const MAX_AGE_MS = 12 * 60 * 1000;
const WINDOWS = [60_000, 180_000, 300_000, 600_000];

export function resetStrikePressureState() {
  RING.clear();
  LAST.clear();
}

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

function sampleAt(history, ageMs, now) {
  if (!history?.length) return null;
  const target = now - ageMs;
  let best = history[0];
  let bestErr = Math.abs(best.ts - target);
  for (const s of history) {
    const e = Math.abs(s.ts - target);
    if (e < bestErr) {
      best = s;
      bestErr = e;
    }
  }
  if (best.ts > now - ageMs * 0.35 && ageMs >= 60_000) return history[0];
  return best;
}

export function recordDistSample(key, sample) {
  if (!key) return [];
  const now = sample.ts || Date.now();
  let arr = RING.get(key) || [];
  const last = arr[arr.length - 1];
  if (last && now - last.ts < 700 && Math.abs((last.dist ?? 0) - (sample.dist ?? 0)) < 0.05) {
    return arr;
  }
  arr = [...arr, { ...sample, ts: now }].filter((s) => now - s.ts <= MAX_AGE_MS);
  if (arr.length > 90) arr = arr.slice(-90);
  RING.set(key, arr);
  return arr;
}

function hysteresis(key, score) {
  const prev = LAST.get(key);
  let next = score;
  if (Number.isFinite(prev)) {
    if (Math.abs(score - prev) < 10) next = prev;
    else if (prev >= 35 && score >= 22 && score < 35) next = 35;
    else if (prev <= -35 && score <= -22 && score > -35) next = -35;
  }
  LAST.set(key, next);
  return next;
}

/**
 * Underlying path is primary. Confirmation cannot cancel a clear approach.
 */
export function scoreStrikePressure({
  spot,
  strike,
  optionType = "CE",
  prevAbsDistance,
  history = [],
  oiChangePct: dOi,
  buildupCode,
  nearbyOiChangePct,
  optLtp,
  volume,
  dayHigh,
  dayLow,
  dayOpen,
  hysteresisKey,
} = {}) {
  const S = Number(spot);
  const K = Number(strike);
  if (!(S > 0) || !(K > 0)) {
    return { score: null, label: PRESSURE_LABELS.unavailable, reasons: ["No spot or strike"] };
  }
  const dist = Math.abs(S - K);
  const side = optionType === "PE" ? "PE" : "CE";
  const now = Date.now();
  const scale = Math.max(S * 0.0025, 8);
  const reasons = [`Distance: ${Math.round(dist)} pts`];
  let towardPts = 0;
  let votes = 0;
  let agree = 0;

  const consider = (oldDist, label) => {
    if (!Number.isFinite(oldDist)) return;
    const delta = oldDist - dist;
    towardPts += delta;
    votes += 1;
    if (delta > scale * 0.15) agree += 1;
    else if (delta < -scale * 0.15) agree -= 1;
    if (label && Math.abs(delta) >= 1) reasons.push(`${label}: ${delta > 0 ? "↓ toward" : "↑ away"} ${Math.round(Math.abs(delta))} pts`);
  };

  consider(Number(prevAbsDistance), "Last tick");
  for (const w of WINDOWS) {
    const s = sampleAt(history, w, now);
    if (s && Number.isFinite(s.dist) && now - s.ts >= w * 0.4) consider(s.dist, `${Math.round(w / 60000)}m`);
  }
  if (history.length >= 2) consider(history[0].dist, "Session sample");

  const hi = Number(dayHigh);
  const lo = Number(dayLow);
  const open = Number(dayOpen);
  let sessionToward = 0;
  if (hi > lo && hi > 0 && lo > 0) {
    const loc = (S - lo) / (hi - lo);
    reasons.push(`Range pos: ${Math.round(loc * 100)}%`);
    if (side === "PE") {
      if (loc <= 0.42) sessionToward += 1;
      if (loc <= 0.22) sessionToward += 1;
      if (Number.isFinite(open) && S < open) sessionToward += 1;
    } else {
      if (loc >= 0.58) sessionToward += 1;
      if (loc >= 0.78) sessionToward += 1;
      if (Number.isFinite(open) && S > open) sessionToward += 1;
    }
  }

  const crossed = (side === "PE" && S <= K) || (side === "CE" && S >= K);
  const prox = Math.max(0, 1 - dist / (scale * 8));

  let score = 0;
  const netToward = towardPts;
  const dirSign = netToward > scale * 0.2 ? 1 : netToward < -scale * 0.2 ? -1 : sessionToward >= 2 ? 1 : sessionToward <= -1 ? -1 : 0;

  if (dirSign !== 0) {
    const mag = Math.min(50, 18 + (Math.abs(netToward) / scale) * 12 + (history.length >= 3 ? 8 : 0));
    score += dirSign * mag;
  } else if (sessionToward >= 2) {
    score += 38;
    reasons.push("Session path toward strike (high/low)");
  } else if (sessionToward <= -1) {
    score -= 38;
    reasons.push("Session path away from strike");
  }

  score += (dirSign || (score > 0 ? 1 : score < 0 ? -1 : 0)) * Math.round(prox * 15);
  if (crossed && (dirSign >= 0 || sessionToward >= 1)) {
    score = Math.max(score, 78);
    reasons.push("Underlying at/through strike");
  }

  if (history.length >= 3) {
    const a = history[history.length - 1];
    const b = history[Math.max(0, history.length - 3)];
    const dt = Math.max(1, (a.ts - b.ts) / 60000);
    const vel = (b.dist - a.dist) / dt;
    if (Math.abs(vel) >= scale * 0.08) {
      score += Math.max(-18, Math.min(18, vel > 0 ? 10 : -10));
      reasons.push(`Speed: ${vel > 0 ? "toward" : "away"} ${Math.round(Math.abs(vel))} pts/min`);
    }
  }

  const firstLtp = history.find((h) => Number(h.optLtp) > 0)?.optLtp;
  const ltp = Number(optLtp);
  if (ltp > 0 && Number(firstLtp) > 0) {
    const pch = (ltp - firstLtp) / firstLtp;
    const premToward = pch > 0.08;
    const premAway = pch < -0.08;
    if (premToward && score >= 0) {
      score += Math.min(15, Math.round(pch * 40));
      reasons.push(`Option LTP rising`);
    } else if (premAway && score <= 0) {
      score -= Math.min(15, Math.round(Math.abs(pch) * 40));
      reasons.push(`Option LTP falling`);
    }
  }

  const vols = history.map((h) => Number(h.volume)).filter((v) => v > 0);
  if (vols.length >= 2 && Number(volume) > 0) {
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    if (volume > avg * 1.6 && Math.abs(score) >= 20) {
      score += score > 0 ? 6 : -6;
      reasons.push("Volume: HIGH");
    }
  }

  const oiN = Number(dOi);
  if (Number.isFinite(oiN) && Math.abs(oiN) >= 0.5) reasons.push(`OI Change: ${oiN >= 0 ? "+" : ""}${Math.round(oiN * 10) / 10}%`);
  if (buildupCode && buildupCode !== "FLAT") reasons.push(`Build-up: ${buildupCode.replace(/_/g, " ")}`);
  if (buildupCode && buildupCode !== "FLAT" && Math.abs(score) >= 20) {
    score += score > 0 ? 4 : -4;
  }
  if (Number.isFinite(nearbyOiChangePct) && Math.abs(nearbyOiChangePct) >= 1 && Math.abs(score) >= 20) {
    score += score > 0 ? 3 : -3;
  }

  if (dirSign > 0 && score < 35 && (Math.abs(netToward) >= scale * 0.35 || sessionToward >= 2 || crossed)) {
    score = 38;
    reasons.push("Underlying approach kept (OI optional)");
  }
  if (dirSign < 0 && score > -35 && Math.abs(netToward) >= scale * 0.35) {
    score = -38;
  }

  score = Math.max(-100, Math.min(100, score));
  if (hysteresisKey) score = hysteresis(hysteresisKey, score);
  if (!votes && sessionToward === 0 && !crossed && history.length < 2) {
    reasons.push("Waiting for path — using live distance only");
  }
  return {
    score,
    label: labelFromScore(score),
    reasons,
    dist,
    spot: S,
    strike: K,
    optionType: side,
  };
}

export function formatPressureCompact(result) {
  const label = result?.label || PRESSURE_LABELS.neutral;
  const impact = result?.impact || "NEUTRAL";
  if (label === PRESSURE_LABELS.unavailable) return { arrow: "—", pressure: label, impact: "NEUTRAL" };
  if (pressureDir(label) === "toward") return { arrow: "↑", pressure: label, impact };
  if (pressureDir(label) === "away") return { arrow: "↓", pressure: label, impact };
  return { arrow: "→", pressure: label, impact };
}

export function computeStrikePressureForRow(row, ctx = {}) {
  try {
    if (!row || row.exited || !row.isOpt) {
      return { label: PRESSURE_LABELS.neutral, impact: "NEUTRAL", score: 0, reasons: ["Not an open option"] };
    }
    const spot = Number(row.spotUsed);
    const strike = Number(row.strike);
    const side = row.side === "PE" ? "PE" : "CE";
    const key = row.tradingsymbol;
    const dist = spot > 0 && strike > 0 ? Math.abs(spot - strike) : null;
    const tape = (ctx.tickerByIndex && row.index && ctx.tickerByIndex[row.index]) || {};
    const history = dist != null
      ? recordDistSample(key, {
        dist,
        spot,
        optLtp: Number(row.last_price),
        volume: Number(row.volume ?? row.day_volume),
      })
      : (RING.get(key) || []);
    const snap = snapForPosition(ctx.oiByIndex, row);
    const prevSnap = snapForPosition(ctx.prevOiByIndex, row);
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
        const pcts = neighbors.map((n) => (side === "PE" ? n.pe_oi_pct : n.ce_oi_pct)).filter((x) => Number.isFinite(x));
        if (pcts.length) nearby = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      }
    }
    const scored = scoreStrikePressure({
      spot,
      strike,
      optionType: side,
      prevAbsDistance: ctx.prevAbsDistance,
      history,
      oiChangePct: dOi,
      buildupCode,
      nearbyOiChangePct: nearby,
      optLtp: Number(row.last_price),
      volume: Number(row.volume ?? row.day_volume),
      dayHigh: tape.day_high,
      dayLow: tape.day_low,
      dayOpen: tape.day_open,
      hysteresisKey: key,
    });
    const impact = positionImpact({ isShort: !!row.isShort, label: scored.label });
    return {
      ...scored,
      impact,
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
