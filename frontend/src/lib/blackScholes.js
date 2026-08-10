// Black-Scholes pricer + implied volatility solver + Greeks.
// All inputs use continuous compounding. Time is in years. Sigma is decimal.

function cnd(x) {
  // Abramowitz & Stegun 7.1.26 rational approximation for the standard
  // normal CDF. Accurate to ~1e-7.
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937,
        b4 = -1.821255978, b5 = 1.330274429, p = 0.2316419;
  const absx = Math.abs(x);
  const t = 1 / (1 + p * absx);
  const npdf = Math.exp(-0.5 * absx * absx) / Math.sqrt(2 * Math.PI);
  const y = 1 - npdf * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
  return x >= 0 ? y : 1 - y;
}

function pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function bsPrice(S, K, T, r, sigma, isCall) {
  S = Number(S); K = Number(K); T = Number(T); r = Number(r); sigma = Number(sigma);
  if (![S, K, T, r, sigma].every(Number.isFinite) || S <= 0 || K <= 0) return null;
  if (T <= 0 || sigma <= 0) {
    // Payoff at expiry.
    return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  if (isCall) return S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2);
  return K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);
}

// Implied volatility via bisection (robust, no derivative surprises).
// Returns decimal sigma, or null if inputs are invalid / price can't be matched
// without hitting an absurd IV ceiling (caller should treat as "no IV").
export function impliedVol(marketPrice, S, K, T, r, isCall) {
  S = Number(S); K = Number(K); T = Number(T); r = Number(r);
  marketPrice = Number(marketPrice);
  if (![marketPrice, S, K, T, r].every(Number.isFinite)) return null;
  if (marketPrice <= 0 || T <= 0 || S <= 0 || K <= 0) return null;
  const intrinsic = isCall ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (marketPrice < intrinsic - 0.01) return null;
  let lo = 0.0001, hi = 3.0; // 0.01% .. 300% — above this is not trustworthy for NSE weeklies
  let loPx = bsPrice(S, K, T, r, lo, isCall);
  let hiPx = bsPrice(S, K, T, r, hi, isCall);
  if (loPx == null || hiPx == null) return null;
  // Expand a little if needed, but never past 5 (500%)
  let it = 0;
  while (hiPx < marketPrice && hi < 5 && it < 4) {
    hi = Math.min(5, hi * 1.5);
    hiPx = bsPrice(S, K, T, r, hi, isCall);
    it++;
  }
  if (hiPx == null || marketPrice < loPx || marketPrice > hiPx) return null;
  let mid = 0.5 * (lo + hi);
  for (let i = 0; i < 60; i++) {
    mid = 0.5 * (lo + hi);
    const midPx = bsPrice(S, K, T, r, mid, isCall);
    if (midPx == null) return null;
    if (midPx > marketPrice) hi = mid;
    else lo = mid;
    if (Math.abs(midPx - marketPrice) < 1e-4) break;
  }
  const sigma = 0.5 * (lo + hi);
  // Reject ceiling solutions — usually means bad spot/strike, not real IV.
  if (!(sigma > 0) || !Number.isFinite(sigma) || sigma >= 4.9) return null;
  return sigma;
}

export function greeks(S, K, T, r, sigma, isCall) {
  S = Number(S); K = Number(K); T = Number(T); r = Number(r); sigma = Number(sigma);
  if (![S, K, T, r, sigma].every(Number.isFinite) || T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: null, gamma: null, theta: null, vega: null };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) {
    return { delta: null, gamma: null, theta: null, vega: null };
  }
  const nd1 = pdf(d1);
  const delta = isCall ? cnd(d1) : cnd(d1) - 1;
  const gamma = nd1 / (S * sigma * sqrtT);
  // Theta per calendar day (annual / 365)
  const thetaAnnual = isCall
    ? -S * nd1 * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * cnd(d2)
    : -S * nd1 * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * cnd(-d2);
  const theta = thetaAnnual / 365;
  // Vega per 1% change in IV
  const vega = S * sqrtT * nd1 / 100;
  const out = { delta, gamma, theta, vega };
  for (const k of Object.keys(out)) {
    if (!Number.isFinite(out[k])) out[k] = null;
  }
  return out;
}

// Time to expiry in YEARS from IST 3:30 PM on expiry date.
export function yearsToExpiry(expiryISO, nowMs = Date.now()) {
  if (!expiryISO) return 0;
  // Expiry closes at 15:30 IST = 10:00 UTC
  const [y, m, d] = expiryISO.split("-").map(Number);
  const expiryMs = Date.UTC(y, m - 1, d, 10, 0);
  const years = (expiryMs - nowMs) / (365 * 24 * 60 * 60 * 1000);
  return Math.max(0, years);
}

/** Minutes remaining until 15:30 IST today (0 if already past). */
export function minutesToCloseIST(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  const nowM = get("hour") * 60 + get("minute");
  const closeM = 15 * 60 + 30;
  return Math.max(0, closeM - nowM);
}

/** Intrinsic value of a European-style option (spot vs strike). */
export function intrinsicValue(S, K, isCall) {
  if (S == null || K == null) return null;
  return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
}

/**
 * Extrinsic (time) premium left in the option price.
 * For a short seller, this is roughly what can still decay in their favour
 * if the option expires / goes to intrinsic.
 */
export function extrinsicPremium(marketPrice, S, K, isCall) {
  if (marketPrice == null || marketPrice < 0 || S == null || K == null) return null;
  const intrinsic = intrinsicValue(S, K, isCall) ?? 0;
  return Math.max(0, marketPrice - intrinsic);
}

/**
 * Estimate remaining premium a short option seller can still collect.
 * - Extrinsic left × |qty|  (dies by expiry close if held)
 * - Also θ × fraction of day left × qty (signed; shorts earn +θ)
 */
export function shortPremiumLeft({
  marketPrice,
  S,
  K,
  isCall,
  quantity,
  thetaPerUnit = null,
  nowMs = Date.now(),
}) {
  const isShort = quantity < 0;
  if (!isShort) return { extrinsicLeft: null, thetaToClose: null };
  const ext = extrinsicPremium(marketPrice, S, K, isCall);
  const absQty = Math.abs(quantity);
  const extrinsicLeft = ext != null ? ext * absQty : null;
  const minsLeft = minutesToCloseIST(nowMs);
  const thetaToClose =
    thetaPerUnit != null && minsLeft > 0
      ? thetaPerUnit * quantity * (minsLeft / (24 * 60))
      : null;
  return { extrinsicLeft, thetaToClose, minutesToClose: minsLeft };
}

// IV rank vs India VIX 52-week range. Since we don't yet persist VIX history,
// we use conservative static bounds appropriate for India VIX (7 - 35 typical).
// If backend provides `vix52Low` / `vix52High` later, plug them in.
export function ivRankVsVix(ivPct, vixNow, vixLow = 7, vixHigh = 35) {
  if (!ivPct) return null;
  // Anchor IV rank to VIX position (VIX itself is 30-day ATM IV).
  // rank = clip(( iv - vixLow ) / ( vixHigh - vixLow ) * 100, 0, 100)
  const rank = Math.max(0, Math.min(100, ((ivPct - vixLow) / (vixHigh - vixLow)) * 100));
  return Math.round(rank);
}

// Classification helpers.
export function classifyIvRank(rank) {
  if (rank == null) return { label: "—", tone: "slate" };
  if (rank >= 70) return { label: "Rich (sell premium)", tone: "rose" };
  if (rank <= 30) return { label: "Cheap (buy premium)", tone: "emerald" };
  return { label: "Fair", tone: "slate" };
}

// Aggregate: for a strike row (with CE + PE LTP), compute all four Greeks.
// Returns { ce_iv, pe_iv, ce_delta, ..., ce_theta, pe_theta ... }
export function strikeAnalytics({ S, K, T, r = 0.065, ceLtp, peLtp, vixNow }) {
  const ce_iv = impliedVol(ceLtp, S, K, T, r, true);
  const pe_iv = impliedVol(peLtp, S, K, T, r, false);
  const ceG = ce_iv ? greeks(S, K, T, r, ce_iv, true) : { delta: null, gamma: null, theta: null, vega: null };
  const peG = pe_iv ? greeks(S, K, T, r, pe_iv, false) : { delta: null, gamma: null, theta: null, vega: null };
  const ce_iv_pct = ce_iv != null ? ce_iv * 100 : null;
  const pe_iv_pct = pe_iv != null ? pe_iv * 100 : null;
  const avg_iv_pct = ce_iv_pct != null && pe_iv_pct != null ? (ce_iv_pct + pe_iv_pct) / 2 : (ce_iv_pct ?? pe_iv_pct);
  const ivRank = ivRankVsVix(avg_iv_pct, vixNow);
  return {
    ce_iv: ce_iv_pct, pe_iv: pe_iv_pct,
    ce_delta: ceG.delta, pe_delta: peG.delta,
    ce_gamma: ceG.gamma, pe_gamma: peG.gamma,
    ce_theta: ceG.theta, pe_theta: peG.theta,
    ce_vega: ceG.vega, pe_vega: peG.vega,
    ivRank,
  };
}
