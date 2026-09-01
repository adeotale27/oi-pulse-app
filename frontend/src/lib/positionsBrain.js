// Positions Brains — book-risk decision layer (pure helpers).
// Reads the live short book. Does not invent market regime from heat,
// fake strikes, or a 50% cut when the named leg is unknown.

import { classifyDayCapital } from "./capitalGuard.js";
import { optionSide, optionSideLabel } from "./optionSide.js";

export const BRAIN_SECTION_ORDER_KEY = "oi_positions_brain_order_v2";

export const BRAIN_SECTION_DEFS = [
  { id: "verdict", label: "Decision" },
  { id: "heat", label: "Why this heat" },
  { id: "book", label: "Book facts" },
  { id: "watch", label: "Watch / do not add" },
  { id: "overnight", label: "Overnight" },
  { id: "plan", label: "If / then" },
];

export const DEFAULT_BRAIN_ORDER = BRAIN_SECTION_DEFS.map((s) => s.id);

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function openShortOptions(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((r) => !r.exited && r.isShort && r.isOpt);
}

export function isShortItm(row) {
  const side = optionSide(row);
  const S = Number(row?.spotUsed);
  const K = Number(row?.strike);
  if (!side || !Number.isFinite(S) || !Number.isFinite(K)) return false;
  return side === "CE" ? S > K : S < K;
}

/** Spot-distance in percent. Prefer the live field; fall back to strike vs spot. */
export function strikeDistancePct(row) {
  if (row?.distancePct != null && Number.isFinite(Number(row.distancePct))) {
    return Math.abs(Number(row.distancePct));
  }
  const S = Number(row?.spotUsed);
  const K = Number(row?.strike);
  if (!Number.isFinite(S) || !Number.isFinite(K) || S === 0) return null;
  return Math.abs((K - S) / S) * 100;
}

/** |Δ| × |qty| — relative sensitivity, not rupees. */
export function riskWeight(row) {
  return Math.abs(num(row?.delta)) * Math.abs(num(row?.quantity));
}

export function positionLabel(row) {
  const sym = row?.tradingsymbol || row?.display_name || row?.strike || "position";
  const side = optionSideLabel(optionSide(row));
  return side ? `${sym} ${side}` : String(sym);
}

export function normalizeBrainOrder(order) {
  const seen = new Set();
  const next = [];
  const incoming = Array.isArray(order) ? order.map(String) : [];
  for (const id of incoming) {
    if (!DEFAULT_BRAIN_ORDER.includes(id) || seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  for (const id of DEFAULT_BRAIN_ORDER) {
    if (seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  return next;
}

function greeksUsable(row) {
  return row?.delta != null && Number.isFinite(Number(row.delta)) && row?.greeksHealth !== "no_spot" && row?.greeksHealth !== "iv_na";
}

/**
 * Rank a short for "problem first": too-close, ITM, near expiry, then sensitivity.
 * Higher score = more urgent.
 */
export function stressScore(row) {
  const dist = strikeDistancePct(row);
  const dte = row?.dte == null ? 99 : num(row.dte, 99);
  let s = riskWeight(row);
  if (row?.breachedAdjust) s += 80;
  if (isShortItm(row)) s += 50;
  if (dte <= 1) s += 40;
  else if (dte <= 2) s += 18;
  if (dist != null && dist <= 0.8) s += 35;
  else if (dist != null && dist <= 1.5) s += 18;
  return s;
}

function itmReason(row) {
  const side = optionSide(row);
  if (side === "CE") return "Spot is through this short call — upside is already eating the strike.";
  if (side === "PE") return "Spot is through this short put — downside is already eating the strike.";
  return "This short is in the money.";
}

function watchReason(row) {
  const dist = strikeDistancePct(row);
  const dte = row?.dte == null ? null : num(row.dte);
  if (isShortItm(row)) return itmReason(row);
  if (row?.breachedAdjust) {
    return dist != null
      ? `Too close — spot is ${dist.toFixed(2)}% from this strike (adjust band).`
      : "Too close to the strike versus your adjust threshold.";
  }
  if (dte != null && dte <= 1) return "Expiry is today or tomorrow — gamma and pin risk dominate theta.";
  if (dist != null && dist <= 1.2) return `Spot is only ${dist.toFixed(2)}% away; delta will accelerate first here.`;
  if (Math.abs(num(row.delta)) > 0.35) return "High delta for a short — this leg is already directional.";
  return "Largest sensitivity in the book — do not add size here.";
}

function actionForHeat(heat, worst) {
  if (!worst) {
    return {
      mode: "EMPTY",
      urgency: "LOW",
      label: "NO SHORT BOOK",
      action: "Nothing to manage until you sell premium.",
      summary: "No open sold options. Brains only scores a live short book.",
    };
  }
  const name = positionLabel(worst);
  if (heat >= 70) {
    return {
      mode: "HIGH RISK",
      urgency: "HIGH",
      label: "REDUCE THE STRESSED LEG",
      action: `Cut or hedge ${name} before adding anything else.`,
      summary: "Carry is no longer paying for the path risk on the closest short.",
    };
  }
  if (heat >= 45) {
    return {
      mode: "WATCH",
      urgency: "MEDIUM",
      label: "HOLD CORE — NO ADDS ON THE HOT STRIKE",
      action: `Do not add to ${name}. Keep a reduce ready if it tags Too close.`,
      summary: "Theta is still usable if you refuse to press the clustered strike.",
    };
  }
  return {
    mode: "SAFE",
    urgency: "LOW",
    label: "HOLD — LET TIME WORK",
    action: `Leave ${name} unless it enters the adjust band. Adds only away from this strike.`,
    summary: "Shorts are still far enough that patience beats churn.",
  };
}

/**
 * @returns decision object consumed by PositionsBrainPanel
 */
export function computePositionsBrain({ rows = [], stats = {}, vix = null } = {}) {
  const shorts = openShortOptions(rows);
  const calls = shorts.filter((r) => optionSide(r) === "CE");
  const puts = shorts.filter((r) => optionSide(r) === "PE");
  const netDelta = num(stats.netDelta);
  const netTheta = num(stats.netTheta);
  const shortCount = shorts.length || num(stats.shortCount);
  const minutesToClose = stats.minutesToClose;
  const minMinutesToExpiry = stats.minMinutes;

  const itmShorts = shorts.filter(isShortItm);
  const expiryShorts = shorts.filter((r) => r.dte != null && num(r.dte) <= 1);
  const tooClose = shorts.filter((r) => r.breachedAdjust);
  const priced = shorts.filter(greeksUsable);

  const callRisk = calls.reduce((s, r) => s + riskWeight(r), 0);
  const putRisk = puts.reduce((s, r) => s + riskWeight(r), 0);
  const totalSideRisk = callRisk + putRisk;
  const callShare = totalSideRisk > 0 ? Math.round((callRisk / totalSideRisk) * 100) : 50;
  const putShare = 100 - callShare;

  const weights = shorts.map(riskWeight);
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;
  const topWeight = shorts.length ? Math.max(...weights) : 0;
  const topShare = topWeight / weightSum;

  const contributors = [];
  const add = (id, label, score, note) => {
    const v = Math.max(0, Math.round(score));
    if (v <= 0) return;
    contributors.push({ id, label, score: v, note });
  };

  const closeRatio = shortCount > 0 ? tooClose.length / shortCount : 0;
  add("close", "Too-close shorts", closeRatio * 36, `${tooClose.length}/${shortCount || 0} in the adjust band`);

  const absD = Math.abs(netDelta);
  add(
    "delta",
    "Net delta tilt",
    absD < 10 ? 0 : absD < 30 ? 12 : 24,
    `Net Δ ${netDelta.toFixed(1)}`,
  );

  add("itm", "In-the-money shorts", Math.min(22, itmShorts.length * 9), itmShorts.length ? `${itmShorts.length} ITM short(s)` : "");
  add("expiry", "Near-expiry gamma", Math.min(20, expiryShorts.length * 8), expiryShorts.length ? `${expiryShorts.length} with ≤1 DTE` : "");
  add("conc", "Strike concentration", topShare > 0.6 ? 18 : topShare > 0.45 ? 12 : 0, `Largest short is ${(topShare * 100).toFixed(0)}% of book sensitivity`);
  add("theta", "Time working against you", netTheta < -50 ? 16 : netTheta < 0 ? 8 : 0, `Daily time money ₹${Math.round(netTheta)}`);
  add("size", "Crowded short book", shortCount > 8 ? 8 : 0, `${shortCount} open shorts`);

  const heatRaw = contributors.reduce((s, c) => s + c.score, 0);
  const heat = clamp(heatRaw, 0, 100);
  const thetaBonus = netTheta > 0 && absD < 10 ? 6 : 0;
  const health = clamp(Math.round(100 - heat + thetaBonus), 0, 100);

  const pricedRatio = shortCount ? priced.length / shortCount : 1;
  const dataQuality = clamp(Math.round(40 + pricedRatio * 55 + (shortCount ? 5 : 0)), 20, 98);
  const confidence = clamp(
    Math.round(dataQuality - (heat >= 70 ? 10 : 0) - (pricedRatio < 0.6 ? 12 : 0)),
    20,
    96,
  );

  const ranked = shorts.slice().sort((a, b) => stressScore(b) - stressScore(a));
  const worst = ranked[0] || null;
  const best = shorts.length
    ? shorts.slice().sort((a, b) => {
      const da = strikeDistancePct(a) ?? 0;
      const db = strikeDistancePct(b) ?? 0;
      if (db !== da) return db - da;
      return (num(b.dte, 0) - num(a.dte, 0));
    }).find((r) => r !== worst) || ranked[ranked.length - 1]
    : null;

  const decision = actionForHeat(heat, worst);

  const nearestCall = calls.slice().sort((a, b) => (strikeDistancePct(a) ?? 99) - (strikeDistancePct(b) ?? 99))[0] || null;
  const nearestPut = puts.slice().sort((a, b) => (strikeDistancePct(a) ?? 99) - (strikeDistancePct(b) ?? 99))[0] || null;

  // Short calls hurt on a rally; short puts hurt on a selloff. Not index "regime".
  let threat;
  if (!calls.length && !puts.length) {
    threat = { direction: "none", label: "No short-option path risk", why: "No sold calls or puts to stress." };
  } else if (callRisk > putRisk || (callRisk === putRisk && netDelta > 0 && calls.length)) {
    threat = { direction: "upside", label: "A fast move up", why: "Short calls carry more sensitivity than short puts." };
  } else if (putRisk > callRisk || puts.length) {
    threat = { direction: "downside", label: "A fast move down", why: "Short puts carry more sensitivity than short calls." };
  } else {
    threat = { direction: "upside", label: "A fast move up", why: "Short calls carry more sensitivity than short puts." };
  }

  const watchList = ranked.slice(0, 3).map((row) => ({
    symbol: positionLabel(row),
    tradingsymbol: row.tradingsymbol,
    side: optionSide(row),
    strike: row.strike,
    distancePct: strikeDistancePct(row),
    dte: row.dte,
    breachedAdjust: !!row.breachedAdjust,
    itm: isShortItm(row),
    reason: watchReason(row),
  }));

  let overnightBand = "LOW";
  let overnightNote = "Gap risk looks contained for this short book.";
  const overnightBits = [];
  if (expiryShorts.length) {
    overnightBits.push(`${expiryShorts.length} short(s) with ≤1 DTE`);
  }
  if (itmShorts.length) overnightBits.push(`${itmShorts.length} ITM short(s)`);
  if (vix != null && Number(vix) > 18) overnightBits.push(`India VIX ${Number(vix).toFixed(1)}`);
  if (absD > 20) overnightBits.push(`net Δ ${netDelta.toFixed(1)}`);
  if (overnightBits.length >= 2 || (expiryShorts.length && itmShorts.length) || (vix != null && Number(vix) > 22)) {
    overnightBand = "HIGH";
    overnightNote = `Do not hold full size into the next open: ${overnightBits.join(", ")}.`;
  } else if (overnightBits.length) {
    overnightBand = "MEDIUM";
    overnightNote = `Overnight is workable if you refuse adds: ${overnightBits.join(", ")}.`;
  }

  const callStrike = nearestCall?.strike != null ? Number(nearestCall.strike) : null;
  const putStrike = nearestPut?.strike != null ? Number(nearestPut.strike) : null;
  let plan = [];
  if (putStrike != null && callStrike != null) {
    plan.push(`If spot stays between ${putStrike} (short put) and ${callStrike} (short call): hold and let theta work.`);
  } else if (callStrike != null) {
    plan.push(`If spot stays below ${callStrike}: the short-call book can keep working.`);
  } else if (putStrike != null) {
    plan.push(`If spot stays above ${putStrike}: the short-put book can keep working.`);
  } else {
    plan.push("If you have no sold options: Brains has nothing to manage.");
  }
  if (worst) {
    const dist = strikeDistancePct(worst);
    const name = positionLabel(worst);
    plan.push(
      dist != null
        ? `If ${name} tags Too close or spot closes another ${Math.max(0.2, dist * 0.4).toFixed(1)}% into it: reduce that leg, not the whole book.`
        : `If ${name} tags Too close: reduce that leg, not the whole book.`,
    );
  }
  plan.push("If India VIX jumps or net Δ doubles: stop adding shorts until the tilt is back under 10.");
  if (minutesToClose != null && Number(minutesToClose) > 0 && Number(minutesToClose) < 45 && heat >= 45) {
    plan.push("Under 45 minutes to close with a warm book: prefer reduce over a new hedge you cannot manage overnight.");
  }

  let deployment =
    heat >= 70
      ? "Do not deploy more short premium. Cut the named leg first."
      : heat >= 45
        ? "Keep existing carry. New shorts only farther from the watch strike, small size."
        : "Normal size is fine if the new strike is farther than the current nearest short.";

  let mode = decision.mode;
  let urgency = decision.urgency;
  let label = decision.label;
  let action = decision.action;
  let summary = decision.summary;

  const cap = classifyDayCapital({
    bookedPct: stats.dayBookedPct,
    leftover: stats.leftover,
    wallet: stats.wallet,
  });
  if (cap.level === "caution" && cap.doLine) {
    deployment = cap.doLine;
    plan.unshift(cap.doLine);
  } else if (cap.stopSellIdeas) {
    mode = "CAPITAL";
    urgency = "HIGH";
    label = cap.level === "defend" ? "Stop the day" : "No new shorts";
    action = cap.doLine;
    summary = cap.headline;
    deployment = "Do not sell more premium. A GOOD book score is path risk, not a green light after a capital hit.";
    plan = [cap.doLine, ...cap.dontLines, ...plan.slice(0, 2)];
  }

  return {
    shortCount,
    heat,
    health,
    confidence,
    dataQuality,
    mode,
    urgency,
    label,
    action,
    summary,
    deployment,
    netDelta,
    netTheta,
    callShare,
    putShare,
    callCount: calls.length,
    putCount: puts.length,
    threat,
    nearestCall: nearestCall
      ? { symbol: positionLabel(nearestCall), strike: nearestCall.strike, distancePct: strikeDistancePct(nearestCall) }
      : null,
    nearestPut: nearestPut
      ? { symbol: positionLabel(nearestPut), strike: nearestPut.strike, distancePct: strikeDistancePct(nearestPut) }
      : null,
    worst: worst
      ? {
        symbol: positionLabel(worst),
        reason: watchReason(worst),
        distancePct: strikeDistancePct(worst),
        dte: worst.dte,
      }
      : null,
    best: best && best !== worst
      ? {
        symbol: positionLabel(best),
        distancePct: strikeDistancePct(best),
        dte: best.dte,
      }
      : null,
    contributors: contributors.sort((a, b) => b.score - a.score),
    watchList,
    overnightBand,
    overnightNote,
    plan,
    itmCount: itmShorts.length,
    vix: vix == null ? null : Number(vix),
    minutesToClose: minutesToClose == null ? null : Number(minutesToClose),
    minMinutesToExpiry: minMinutesToExpiry == null ? null : Number(minMinutesToExpiry),
  };
}
