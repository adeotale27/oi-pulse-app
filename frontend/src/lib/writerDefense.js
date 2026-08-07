// Writer defense map — which ATM± strikes kept Put/Call OI through the day.
// Uses session-open → now (not the 15m Δ bars). "Support held / cracked" is
// the actionable readout Sensibull-style change bars don't spell out.

const RETAIN_HELD = 0.92; // kept ≥ 92% of session-open OI
const RETAIN_CRACK = 0.85; // dropped below 85% → cracked on OI
const MIN_OI = 500; // ignore thin walls
const BUILD_PCT = 8; // +8% from open = still building
const UNWIND_PCT = 10; // −10% from open = material unwind

function nearestAtmIndex(strikes, atm) {
  if (!strikes?.length || atm == null) return -1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i].strike - atm);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function classifySide({ openOi, nowOi, side, strike, spot }) {
  const open = Number(openOi) || 0;
  const now = Number(nowOi) || 0;
  const delta = now - open;
  const retain = open > 0 ? now / open : now > 0 ? 1 : 0;
  const deltaPct = open > 0 ? (delta / open) * 100 : 0;
  const significant = Math.max(open, now) >= MIN_OI;

  // Price break relative to writer wall
  // PE support at K fails when spot trades below K.
  // CE resistance at K fails when spot trades above K.
  let priceBroke = false;
  if (spot != null && Number.isFinite(spot)) {
    if (side === "PE" && spot < strike) priceBroke = true;
    if (side === "CE" && spot > strike) priceBroke = true;
  }

  let code = "THIN";
  let label = "Thin";
  let tone = "slate";

  if (!significant) {
    return {
      code,
      label,
      tone,
      open,
      now,
      delta,
      deltaPct,
      retain,
      priceBroke,
      kept: false,
    };
  }

  if (priceBroke && retain < RETAIN_HELD) {
    code = "CRACKED";
    label = side === "PE" ? "Support cracked" : "Resistance cracked";
    tone = "rose";
  } else if (priceBroke && retain >= RETAIN_HELD) {
    // Spot through the strike but writers still parked — sticky wall under stress
    code = "STRESSED";
    label = side === "PE" ? "Support stressed (price thru)" : "Resistance stressed (price thru)";
    tone = "amber";
  } else if (retain < RETAIN_CRACK || deltaPct <= -UNWIND_PCT) {
    code = "CRACKED";
    label = side === "PE" ? "Support cracked (OI unwind)" : "Resistance cracked (OI unwind)";
    tone = "rose";
  } else if (deltaPct >= BUILD_PCT && retain >= RETAIN_HELD) {
    code = "BUILDING";
    label = side === "PE" ? "Support building" : "Resistance building";
    tone = "emerald";
  } else if (retain >= RETAIN_HELD) {
    code = "HELD";
    label = side === "PE" ? "Support held" : "Resistance held";
    tone = "emerald";
  } else {
    code = "SOFTENING";
    label = side === "PE" ? "Support softening" : "Resistance softening";
    tone = "amber";
  }

  return {
    code,
    label,
    tone,
    open,
    now,
    delta,
    deltaPct,
    retain,
    priceBroke,
    kept: code === "HELD" || code === "BUILDING",
  };
}

/**
 * @param {object} opts
 * @param {object} opts.current - latest OI snapshot
 * @param {object} opts.sessionPrevious - session-open baseline
 * @param {number} [opts.band=3] - strikes each side of ATM
 * @returns {{ atm, spot, rows, summary } | null}
 */
export function computeWriterDefense({ current, sessionPrevious, band = 3 }) {
  if (!current?.strikes?.length || !sessionPrevious?.strikes?.length) return null;

  const atm = current.atm ?? current.price;
  const spot = current.price ?? atm;
  if (atm == null) return null;

  const sorted = [...current.strikes].sort((a, b) => a.strike - b.strike);
  const atmIdx = nearestAtmIndex(sorted, atm);
  if (atmIdx < 0) return null;

  const lo = Math.max(0, atmIdx - band);
  const hi = Math.min(sorted.length - 1, atmIdx + band);

  const prevMap = new Map();
  (sessionPrevious.strikes || []).forEach((s) => prevMap.set(s.strike, s));

  const rows = [];
  for (let i = lo; i <= hi; i++) {
    const s = sorted[i];
    const p = prevMap.get(s.strike) || { ce_oi: 0, pe_oi: 0 };
    const offset = i - atmIdx;
    const put = classifySide({
      openOi: p.pe_oi,
      nowOi: s.pe_oi,
      side: "PE",
      strike: s.strike,
      spot,
    });
    const call = classifySide({
      openOi: p.ce_oi,
      nowOi: s.ce_oi,
      side: "CE",
      strike: s.strike,
      spot,
    });
    rows.push({
      strike: s.strike,
      offset,
      isAtm: offset === 0,
      put,
      call,
    });
  }

  const putHeld = rows.filter((r) => r.put.kept).length;
  const putCracked = rows.filter((r) => r.put.code === "CRACKED").length;
  const callHeld = rows.filter((r) => r.call.kept).length;
  const callCracked = rows.filter((r) => r.call.code === "CRACKED").length;

  let headline = "Mixed writer walls";
  let tone = "slate";
  if (putCracked >= 2 && callHeld >= putHeld) {
    headline = "Put support cracking — downside freer";
    tone = "rose";
  } else if (callCracked >= 2 && putHeld >= callHeld) {
    headline = "Call resistance cracking — upside freer";
    tone = "emerald";
  } else if (putHeld >= 2 && callHeld >= 2) {
    headline = "Writers defending both sides — range likely";
    tone = "amber";
  } else if (putHeld > callHeld && putCracked === 0) {
    headline = "Put support held through the day";
    tone = "emerald";
  } else if (callHeld > putHeld && callCracked === 0) {
    headline = "Call resistance held through the day";
    tone = "rose";
  }

  return {
    atm,
    spot,
    band,
    rows,
    summary: {
      headline,
      tone,
      putHeld,
      putCracked,
      callHeld,
      callCracked,
    },
  };
}
