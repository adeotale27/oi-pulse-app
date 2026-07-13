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
  if (T <= 0 || sigma <= 0) {
    // Payoff at expiry.
    return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) return S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2);
  return K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);
}

// Implied volatility via bisection (robust, no derivative surprises).
export function impliedVol(marketPrice, S, K, T, r, isCall) {
  if (marketPrice <= 0 || T <= 0 || S <= 0 || K <= 0) return null;
  const intrinsic = isCall ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (marketPrice < intrinsic - 0.01) return null;
  let lo = 0.0001, hi = 5.0; // 0.01% .. 500%
  let loPx = bsPrice(S, K, T, r, lo, isCall);
  let hiPx = bsPrice(S, K, T, r, hi, isCall);
  // Expand if needed
  let it = 0;
  while (hiPx < marketPrice && hi < 10 && it < 4) { hi *= 2; hiPx = bsPrice(S, K, T, r, hi, isCall); it++; }
  if (marketPrice < loPx || marketPrice > hiPx) return null;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const midPx = bsPrice(S, K, T, r, mid, isCall);
    if (midPx > marketPrice) hi = mid;
    else lo = mid;
    if (Math.abs(midPx - marketPrice) < 1e-4) return mid;
  }
  return 0.5 * (lo + hi);
}

export function greeks(S, K, T, r, sigma, isCall) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { delta: null, gamma: null, theta: null, vega: null };
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
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
  return { delta, gamma, theta, vega };
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
