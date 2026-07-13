// Long / Short Build-up classifier — the F&O bias signal every trader lives by.
// Combines ΔPrice (LTP change) with ΔOI to classify each strike & side:
//
//   ΔPrice ↑  +  ΔOI ↑   → LONG BUILD-UP        (fresh buyers, bullish for that side)
//   ΔPrice ↓  +  ΔOI ↑   → SHORT BUILD-UP       (fresh writers, bearish for that side)
//   ΔPrice ↑  +  ΔOI ↓   → SHORT COVERING       (writers exiting, bullish squeeze)
//   ΔPrice ↓  +  ΔOI ↓   → LONG UNWINDING       (buyers exiting, bearish)
//
// For CE (call) side: LONG BUILD-UP is bullish (buyers accumulating calls).
// For PE (put) side:  LONG BUILD-UP is bearish (buyers accumulating puts).
// SHORT BUILD-UP on CE = call writing = bearish (resistance forming).
// SHORT BUILD-UP on PE = put writing = bullish (support forming).
//
// The `bias` value returned is a per-strike bullish score (-1..+1) blending both sides.

// Thresholds — very small moves are noise; anything less than these counts as flat.
const OI_NOISE = 0.5;   // percent
const LTP_NOISE = 0.3;  // percent

function classifyOne(dOiPct, dLtpPct) {
  const oiUp = dOiPct > OI_NOISE;
  const oiDown = dOiPct < -OI_NOISE;
  const pxUp = dLtpPct > LTP_NOISE;
  const pxDown = dLtpPct < -LTP_NOISE;
  if (oiUp && pxUp) return { code: "LONG_BUILD", label: "Long Build-up", short: "LB", tone: "emerald" };
  if (oiUp && pxDown) return { code: "SHORT_BUILD", label: "Short Build-up", short: "SB", tone: "rose" };
  if (oiDown && pxUp) return { code: "SHORT_COVER", label: "Short Covering", short: "SC", tone: "sky" };
  if (oiDown && pxDown) return { code: "LONG_UNWIND", label: "Long Unwinding", short: "LU", tone: "amber" };
  return { code: "FLAT", label: "Flat", short: "—", tone: "slate" };
}

// Per-strike bias: +1 bullish, -1 bearish. Combines CE & PE classifications.
// CE  LONG_BUILD  = bullish (call buyers accumulating)          → +0.5
// CE  SHORT_BUILD = bearish (call writers, resistance forming)   → -1.0
// CE  SHORT_COVER = bullish (call writers running, squeeze)     → +1.0
// CE  LONG_UNWIND = bearish (call buyers giving up)             → -0.5
// PE  LONG_BUILD  = bearish (put buyers, hedging / bearish)     → -0.5
// PE  SHORT_BUILD = bullish (put writers, support forming)      → +1.0
// PE  SHORT_COVER = bearish (put writers running)               → -1.0
// PE  LONG_UNWIND = bullish (put buyers give up)                → +0.5
const CE_BIAS = { LONG_BUILD: 0.5, SHORT_BUILD: -1.0, SHORT_COVER: 1.0, LONG_UNWIND: -0.5, FLAT: 0 };
const PE_BIAS = { LONG_BUILD: -0.5, SHORT_BUILD: 1.0, SHORT_COVER: -1.0, LONG_UNWIND: 0.5, FLAT: 0 };

export function classifyStrike(row) {
  // row must contain { ce_oi_pct, ce_ltp_pct, pe_oi_pct, pe_ltp_pct }
  const ce = classifyOne(row.ce_oi_pct, row.ce_ltp_pct);
  const pe = classifyOne(row.pe_oi_pct, row.pe_ltp_pct);
  const bias = CE_BIAS[ce.code] + PE_BIAS[pe.code];
  const biasClamped = Math.max(-1, Math.min(1, bias / 2));
  return { ce, pe, bias: biasClamped };
}

export function classifyBuildups({ current, previous }) {
  if (!current?.strikes?.length || !previous?.strikes?.length) return [];
  const prevMap = new Map();
  previous.strikes.forEach((s) => prevMap.set(s.strike, s));
  return current.strikes.map((s) => {
    const p = prevMap.get(s.strike);
    if (!p) return null;
    const ce_oi_pct = p.ce_oi ? ((s.ce_oi - p.ce_oi) / p.ce_oi) * 100 : 0;
    const pe_oi_pct = p.pe_oi ? ((s.pe_oi - p.pe_oi) / p.pe_oi) * 100 : 0;
    const ce_ltp_pct = p.ce_ltp ? ((s.ce_ltp - p.ce_ltp) / p.ce_ltp) * 100 : 0;
    const pe_ltp_pct = p.pe_ltp ? ((s.pe_ltp - p.pe_ltp) / p.pe_ltp) * 100 : 0;
    const cls = classifyStrike({ ce_oi_pct, ce_ltp_pct, pe_oi_pct, pe_ltp_pct });
    return {
      strike: s.strike,
      ce_oi: s.ce_oi, pe_oi: s.pe_oi,
      ce_ltp: s.ce_ltp, pe_ltp: s.pe_ltp,
      ce_oi_pct, pe_oi_pct, ce_ltp_pct, pe_ltp_pct,
      ...cls,
    };
  }).filter(Boolean);
}

// Aggregate bias across the ATM band (ATM ± n strikes).
export function aggregateBuildupBias(rows, atm, bandStrikes = 3) {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const atmIdx = sorted.findIndex((r) => r.strike === atm);
  if (atmIdx < 0) return { score: 0, label: "Neutral", tone: "slate", counts: {} };
  const lo = Math.max(0, atmIdx - bandStrikes);
  const hi = Math.min(sorted.length, atmIdx + bandStrikes + 1);
  const band = sorted.slice(lo, hi);
  const scoreSum = band.reduce((acc, r) => acc + r.bias, 0);
  const score = band.length ? Math.round((scoreSum / band.length) * 100) : 0;
  // Count each classification for a summary line.
  const counts = {};
  for (const r of band) {
    const kCE = `CE_${r.ce.code}`;
    const kPE = `PE_${r.pe.code}`;
    counts[kCE] = (counts[kCE] || 0) + 1;
    counts[kPE] = (counts[kPE] || 0) + 1;
  }
  let label = "Neutral", tone = "slate";
  if (score >= 50) { label = "Strong Bullish"; tone = "emerald"; }
  else if (score >= 20) { label = "Bullish"; tone = "emerald"; }
  else if (score <= -50) { label = "Strong Bearish"; tone = "rose"; }
  else if (score <= -20) { label = "Bearish"; tone = "rose"; }
  return { score, label, tone, counts, band };
}
