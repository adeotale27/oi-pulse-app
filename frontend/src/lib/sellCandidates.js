// -----------------------------------------------------------------------------
// Sell Candidates analytics.
//
// This module produces a composite ranking of the "safest strikes to sell"
// given the current OI snapshot, the previous snapshot (for OI-change signals),
// and the current India VIX level.
//
// It combines the following signals into a single 0-100 "sell-safety score"
// per strike per side (CE / PE):
//   1. IV Rank of the strike's implied volatility vs India VIX (rich premium)
//   2. |Delta| distance from ATM (assignment risk)
//   3. Fresh option writing (OI ↑ while LTP flat/down => writers initiating)
//   4. Positioned outside the gamma wall zone on the writer's side
//   5. Dealer-gamma regime (positive/neutral = sticky range, safer to sell)
//   6. VIX not spiking intraday
//   7. OI migration into this strike (writers rolling to defend / attack level)
//   8. Liquidity gate (minimum OI + volume)
//
// The whole file is pure, side-effect-free JS so it can be memoised in React.
// -----------------------------------------------------------------------------

import { impliedVol, greeks, yearsToExpiry, ivRankVsVix } from "./blackScholes";

// Contract multiplier per index (roughly the lot size — good enough for a
// relative-ordering GEX proxy; we only care about signs and magnitudes here).
const CONTRACT_MULT = {
  NIFTY: 50,
  SENSEX: 10,
  BANKNIFTY: 15,
};

// Sensible defaults if the caller doesn't provide.
const DEFAULT_RISK_FREE_RATE = 0.065;

// ---------------------------------------------------------------------------
// Volatility smile: per-strike CE / PE IV, plus a smile-skew premium flag.
// ---------------------------------------------------------------------------
export function computeVolatilitySmile({ strikes, spot, T, r = DEFAULT_RISK_FREE_RATE }) {
  if (!strikes?.length || !spot || !(T > 0)) return { points: [], meanIv: null };
  const points = [];
  const ivs = [];
  for (const s of strikes) {
    const ceIv = s.ce_ltp > 0 ? impliedVol(s.ce_ltp, spot, s.strike, T, r, true) : null;
    const peIv = s.pe_ltp > 0 ? impliedVol(s.pe_ltp, spot, s.strike, T, r, false) : null;
    const ce_iv_pct = ceIv != null ? ceIv * 100 : null;
    const pe_iv_pct = peIv != null ? peIv * 100 : null;
    if (ce_iv_pct != null) ivs.push(ce_iv_pct);
    if (pe_iv_pct != null) ivs.push(pe_iv_pct);
    points.push({ strike: s.strike, ce_iv: ce_iv_pct, pe_iv: pe_iv_pct });
  }
  const meanIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  return { points, meanIv };
}

// ---------------------------------------------------------------------------
// Dealer Gamma Exposure ("GEX-lite").
//
// Convention used (SqueezeMetrics-style, common in retail dashboards):
//   GEX_i = Γ_CE_i × OI_CE_i × spot² × mult × 100
//         - Γ_PE_i × OI_PE_i × spot² × mult × 100
//   GEX = Σ_i GEX_i
//
// Interpretation:
//   GEX > 0  → dealers net long gamma → hedging flows dampen moves → SIDEWAYS
//   GEX < 0  → dealers net short gamma → hedging flows chase moves → TRENDING
//
// Thresholds are empirical — scaled to the magnitudes we see in NSE OI data.
// ---------------------------------------------------------------------------
export function computeDealerGamma({ strikes, spot, T, r = DEFAULT_RISK_FREE_RATE, indexName }) {
  if (!strikes?.length || !spot || !(T > 0)) {
    return { gex: 0, regime: "unknown", label: "—", tone: "slate" };
  }
  const mult = CONTRACT_MULT[indexName] || 50;
  let gex = 0;
  for (const s of strikes) {
    const ceIv = s.ce_ltp > 0 ? impliedVol(s.ce_ltp, spot, s.strike, T, r, true) : null;
    const peIv = s.pe_ltp > 0 ? impliedVol(s.pe_ltp, spot, s.strike, T, r, false) : null;
    const ceG = ceIv ? greeks(spot, s.strike, T, r, ceIv, true).gamma : 0;
    const peG = peIv ? greeks(spot, s.strike, T, r, peIv, false).gamma : 0;
    const ceContrib = (ceG || 0) * (s.ce_oi || 0) * spot * spot * mult;
    const peContrib = (peG || 0) * (s.pe_oi || 0) * spot * spot * mult;
    gex += ceContrib - peContrib;
  }
  // Normalise to trillions for a friendly display. Empirically GEX for
  // NIFTY-scale indices sits in the ±100-1000T range on typical days.
  const gexT = gex / 1e12;
  let regime, label, tone;
  if (gexT > 50) { regime = "positive"; label = "Sticky range"; tone = "emerald"; }
  else if (gexT < -50) { regime = "negative"; label = "Trending / expansion"; tone = "rose"; }
  else { regime = "neutral"; label = "Neutral"; tone = "amber"; }
  return { gex, gexT, regime, label, tone };
}

// ---------------------------------------------------------------------------
// Fresh writing detector.
// A strike shows "fresh call writing" when CE OI increased meaningfully AND
// CE LTP is flat/down (writers accepting the price — bearish for that strike
// staying below). Symmetric for puts.
// ---------------------------------------------------------------------------
export function detectFreshWriting({ current, previous }) {
  const out = { ce: new Map(), pe: new Map() };
  if (!current?.strikes || !previous?.strikes) return out;
  const prevMap = new Map(previous.strikes.map((s) => [s.strike, s]));
  for (const s of current.strikes) {
    const p = prevMap.get(s.strike);
    if (!p) continue;
    const ceDeltaOI = (s.ce_oi || 0) - (p.ce_oi || 0);
    const peDeltaOI = (s.pe_oi || 0) - (p.pe_oi || 0);
    const ceLtpChg = ((s.ce_ltp || 0) - (p.ce_ltp || 0)) / Math.max(1, p.ce_ltp || 1);
    const peLtpChg = ((s.pe_ltp || 0) - (p.pe_ltp || 0)) / Math.max(1, p.pe_ltp || 1);
    // OI up + LTP flat-or-down (< +2%) => fresh writing.
    if (ceDeltaOI > 50_000 && ceLtpChg <= 0.02) {
      out.ce.set(s.strike, { deltaOI: ceDeltaOI, ltpChg: ceLtpChg });
    }
    if (peDeltaOI > 50_000 && peLtpChg <= 0.02) {
      out.pe.set(s.strike, { deltaOI: peDeltaOI, ltpChg: peLtpChg });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OI migration: strike gains OI while an ADJACENT strike loses OI on the same
// side. Signals writers rolling levels.
// ---------------------------------------------------------------------------
export function detectOIMigration({ current, previous, step }) {
  const out = { ce: new Set(), pe: new Set() };
  if (!current?.strikes || !previous?.strikes || !step) return out;
  const prevMap = new Map(previous.strikes.map((s) => [s.strike, s]));
  for (const s of current.strikes) {
    const p = prevMap.get(s.strike);
    if (!p) continue;
    const ceDelta = (s.ce_oi || 0) - (p.ce_oi || 0);
    const peDelta = (s.pe_oi || 0) - (p.pe_oi || 0);
    // Check neighbours ±1 step
    for (const nk of [s.strike - step, s.strike + step]) {
      const cn = current.strikes.find((x) => x.strike === nk);
      const pn = prevMap.get(nk);
      if (!cn || !pn) continue;
      const ceN = (cn.ce_oi || 0) - (pn.ce_oi || 0);
      const peN = (cn.pe_oi || 0) - (pn.pe_oi || 0);
      // Strike gains > 100k CE while neighbour loses > 100k CE
      if (ceDelta > 100_000 && ceN < -100_000) out.ce.add(s.strike);
      if (peDelta > 100_000 && peN < -100_000) out.pe.add(s.strike);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gamma-wall detection (max-OI strikes on each side).
// ---------------------------------------------------------------------------
function findGammaWalls(strikes) {
  let ceWall = null, peWall = null;
  for (const s of strikes) {
    if (!ceWall || (s.ce_oi || 0) > (ceWall.ce_oi || 0)) ceWall = s;
    if (!peWall || (s.pe_oi || 0) > (peWall.pe_oi || 0)) peWall = s;
  }
  return { ceWall: ceWall?.strike, peWall: peWall?.strike };
}

// ---------------------------------------------------------------------------
// VIX regime: intraday change.
// ---------------------------------------------------------------------------
function classifyVix({ vixNow, vixOpen }) {
  if (!vixNow) return { changePct: null, spiking: false };
  const open = vixOpen && vixOpen > 0 ? vixOpen : vixNow;
  const changePct = ((vixNow - open) / open) * 100;
  return { changePct, spiking: changePct > 5 };
}

// ---------------------------------------------------------------------------
// Main entry point. Returns an object with the market verdict + two ranked
// candidate arrays (ce and pe). If it's a "bad day to sell", `verdict.tradeable`
// will be false and `verdict.reasons` will explain why.
// ---------------------------------------------------------------------------
export function computeSellCandidates({
  current,
  previous,
  vixNow,
  vixOpen,
  indexName,
  step,
  vrp,
  r = DEFAULT_RISK_FREE_RATE,
}) {
  const spot = current?.price || current?.atm;
  const expiryISO = current?.expiry;
  const rawT = yearsToExpiry(expiryISO);
  // If the selected expiry has already passed we cannot produce meaningful
  // IV / greeks — the observed LTPs are intrinsic-only and any T > 0 we
  // synthesise would give nonsense IVs. Surface a clear "pick a live weekly"
  // message and abort scoring. The caller reads `expiryStale` in the result.
  const expiryStale = rawT <= 0.0005; // < ~4 hours to expiry
  const T = rawT;
  const strikes = current?.strikes || [];
  // Update guards to return T-normalised dealer so the panel keeps a consistent shape.
  if (expiryStale) {
    return {
      verdict: {
        tradeable: false,
        reasons: ["Selected expiry has already passed. Please pick the next weekly expiry from the sidebar to see live sell candidates."],
      },
      candidates: { ce: [], pe: [] },
      smile: { points: [], meanIv: null },
      dealer: { gex: 0, gexT: 0, regime: "unknown", label: "—", tone: "slate" },
      ivRank: null,
      vix: { now: vixNow, changePct: null },
      walls: {},
      expiryStale: true,
    };
  }
  if (!strikes.length || !spot || !(T > 0)) {
    return {
      verdict: { tradeable: false, reasons: ["Waiting for live snapshot..."] },
      candidates: { ce: [], pe: [] },
      smile: { points: [], meanIv: null },
      dealer: { gex: 0, gexT: 0, regime: "unknown", label: "—", tone: "slate" },
      ivRank: null,
      vix: { now: vixNow, changePct: null },
      walls: {},
      expiryStale,
    };
  }

  // ---- Aggregate signals ----
  const smile = computeVolatilitySmile({ strikes, spot, T, r });
  const dealer = computeDealerGamma({ strikes, spot, T, r, indexName });
  const fresh = detectFreshWriting({ current, previous });
  const migration = detectOIMigration({ current, previous, step });
  const walls = findGammaWalls(strikes);
  const vix = classifyVix({ vixNow, vixOpen });

  // IV Rank based on the smile's mean IV (robust vs a single strike glitch).
  const ivRank = smile.meanIv != null ? ivRankVsVix(smile.meanIv, vixNow) : null;

  // ---- Market-wide verdict for "bad day to sell" ----
  const reasons = [];
  if (dealer.regime === "negative") {
    reasons.push(`Dealer gamma strongly negative (${dealer.gexT.toFixed(1)}T) — dealers hedge into moves, expect trending / expansion.`);
  }
  if (ivRank != null && ivRank < 15) {
    reasons.push(`IV Rank ${ivRank} — premium is very cheap; sellers under-compensated for risk.`);
  }
  if (vix.spiking) {
    reasons.push(`India VIX up ${vix.changePct.toFixed(1)}% intraday — volatility is spiking.`);
  }
  // Hard block: VRP < -1 means IV < realised vol → sellers are receiving less
  // premium than the market's actual movement warrants. Institutional-grade
  // "stop selling" trigger.
  if (vrp && vrp.vrp != null && vrp.vrp < -1) {
    reasons.push(`Volatility Risk Premium ${vrp.vrp.toFixed(2)} — IV (${(vrp.iv ?? 0).toFixed(1)}%) is below realised vol (HV ${((vrp.hv_20 ?? vrp.hv_10) ?? 0).toFixed(1)}%). Sellers under-paid for the market's actual movement.`);
  }
  const tradeable = reasons.length === 0;
  // Advisory notes shown alongside candidates when the market is tradeable but
  // some individual signals are still lukewarm.
  const advisories = [];
  if (tradeable && ivRank != null && ivRank < 30) {
    advisories.push(`IV Rank ${ivRank} — premium is on the cheaper side. Consider smaller size or wait for a VIX spike.`);
  }
  if (tradeable && dealer.regime === "neutral") {
    advisories.push("Dealer gamma is neutral — no strong sticky-range tailwind for premium sellers.");
  }
  if (tradeable && vrp && vrp.vrp != null && vrp.vrp < 1) {
    advisories.push(`VRP ${vrp.vrp.toFixed(2)} — realised vol is catching up to IV. Compression underway; consider tighter DTE / smaller size.`);
  }

  // ---- Per-strike scoring ----
  const scoreStrike = (s, side /* "CE" | "PE" */) => {
    const isCall = side === "CE";
    const ltp = isCall ? s.ce_ltp : s.pe_ltp;
    const oi = isCall ? s.ce_oi : s.pe_oi;
    const vol = isCall ? s.ce_volume : s.pe_volume;
    if (!(ltp > 0)) return null;

    // Liquidity gate.
    if ((oi || 0) < 100_000) return null;

    const iv = impliedVol(ltp, spot, s.strike, T, r, isCall);
    if (!iv || iv <= 0) return null;
    const iv_pct = iv * 100;
    const g = greeks(spot, s.strike, T, r, iv, isCall);
    const strikeIvRank = ivRankVsVix(iv_pct, vixNow);

    // 1. IV Rank (rich premium) — partial credit even at moderate ranks so
    //    normal-VIX days still surface plausible candidates.
    const s1 = strikeIvRank != null ? Math.max(0, Math.min(25, (strikeIvRank / 70) * 25)) : 0;

    // 2. |Delta| distance
    const absD = Math.abs(g.delta ?? 0.5);
    const s2 = Math.max(0, 15 * (1 - Math.min(1, absD / 0.5)));

    // 3. Fresh writing on this strike / side
    const isFresh = (isCall ? fresh.ce : fresh.pe).has(s.strike);
    const s3 = isFresh ? 15 : 0;

    // 4. Outside gamma-wall zone on the writer's side.
    //    CE writer wants strike above the CE wall (where price is capped).
    //    PE writer wants strike below the PE wall (where price is floored).
    let s4 = 0;
    if (isCall && walls.ceWall != null) {
      if (s.strike >= walls.ceWall) s4 = 15;
      else s4 = Math.max(0, 15 - ((walls.ceWall - s.strike) / step) * 3);
    }
    if (!isCall && walls.peWall != null) {
      if (s.strike <= walls.peWall) s4 = 15;
      else s4 = Math.max(0, 15 - ((s.strike - walls.peWall) / step) * 3);
    }

    // 5. Dealer-gamma regime
    const s5 = dealer.regime === "positive" ? 10 : dealer.regime === "neutral" ? 5 : 0;

    // 6. VIX regime
    const s6 = vix.spiking ? 0 : 5;

    // 7. OI migration into this strike
    const isMig = (isCall ? migration.ce : migration.pe).has(s.strike);
    const s7 = isMig ? 10 : 0;

    // 8. Volume gate
    const s8 = (vol || 0) >= 5_000 ? 5 : 0;

    // 9. VRP bonus/penalty (market-wide, applied per-strike so composite score
    //    is comparable across signals). +12 when VRP is rich, +6 when fair,
    //    0 when thin, negative when poor.
    let s9 = 0;
    if (vrp && vrp.vrp != null) {
      if (vrp.vrp >= 3) s9 = 12;
      else if (vrp.vrp >= 1) s9 = 6;
      else if (vrp.vrp >= -1) s9 = 0;
      else s9 = -10;
    }

    const total = Math.round(s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8 + s9);

    // Rationale bullets.
    const rationale = [];
    if (strikeIvRank != null) {
      if (strikeIvRank >= 60) rationale.push(`IV Rank ${strikeIvRank} (rich)`);
      else if (strikeIvRank >= 30) rationale.push(`IV Rank ${strikeIvRank} (fair)`);
      else if (strikeIvRank > 0) rationale.push(`IV Rank ${strikeIvRank} (low)`);
    }
    if (absD <= 0.25) rationale.push(`|Δ| ${absD.toFixed(2)} (safe OTM)`);
    else if (absD <= 0.4) rationale.push(`|Δ| ${absD.toFixed(2)} (moderate assignment risk)`);
    if (isFresh) rationale.push("Fresh writing");
    if (s4 >= 12) rationale.push(isCall ? "Above CE gamma-wall" : "Below PE gamma-wall");
    if (isMig) rationale.push("OI migrating in");
    if (smile.meanIv && iv_pct > smile.meanIv * 1.10) rationale.push("Smile-skew premium");
    if (vrp && vrp.vrp != null) {
      if (vrp.vrp >= 3) rationale.push(`VRP +${vrp.vrp.toFixed(1)} (rich)`);
      else if (vrp.vrp < 0) rationale.push(`VRP ${vrp.vrp.toFixed(1)} (under-paid)`);
    }

    return {
      strike: s.strike,
      side,
      ltp,
      oi,
      volume: vol || 0,
      iv: iv_pct,
      ivRank: strikeIvRank,
      delta: g.delta,
      gamma: g.gamma,
      theta: g.theta,
      vega: g.vega,
      score: total,
      fresh: isFresh,
      migration: isMig,
      rationale,
    };
  };

  let ce = [];
  let pe = [];
  if (tradeable) {
    for (const s of strikes) {
      const c = scoreStrike(s, "CE");
      if (c && c.score >= 30) ce.push(c);
      const p = scoreStrike(s, "PE");
      if (p && p.score >= 30) pe.push(p);
    }
    ce.sort((a, b) => b.score - a.score);
    pe.sort((a, b) => b.score - a.score);
  }

  return {
    verdict: { tradeable, reasons, advisories },
    candidates: { ce, pe },
    smile,
    dealer,
    ivRank,
    vix: { now: vixNow, changePct: vix.changePct, spiking: vix.spiking },
    walls,
    expiryStale,
  };
}
