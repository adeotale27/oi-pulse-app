// Non-directional seller insights for the Positions desk (pure helpers).

import { intrinsicValue, minutesToCloseIST } from "./blackScholes.js";

export const POSITIONS_TOGGLE_KEY = "oiPositionsSellerToggles";

export const DEFAULT_POSITIONS_TOGGLES = {
  bookVerdict: true,
  sellIdeas: true,
  decayBook: true,
  expiryDayMode: true,
  deltaHedge: true,
  assignmentWatch: true,
};

export function loadPositionsToggles() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITIONS_TOGGLE_KEY) || "{}");
    return { ...DEFAULT_POSITIONS_TOGGLES, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    return { ...DEFAULT_POSITIONS_TOGGLES };
  }
}

export function savePositionsToggles(toggles) {
  try {
    localStorage.setItem(POSITIONS_TOGGLE_KEY, JSON.stringify(toggles));
  } catch {
    /* noop */
  }
}

/** Minutes since midnight IST. */
export function istMinutesNow(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get("hour") * 60 + get("minute");
}

export function isAfterIstHour(hour, minute = 0, nowMs = Date.now()) {
  return istMinutesNow(nowMs) >= hour * 60 + minute;
}

/** Nearest weekly expiry date from meta list (or first). */
export function nearestWeeklyExpiry(expiriesMeta = []) {
  if (!Array.isArray(expiriesMeta) || !expiriesMeta.length) return null;
  const weekly = expiriesMeta.find((e) => String(e.tag || "").toUpperCase() === "W");
  return (weekly || expiriesMeta[0])?.date || null;
}

/**
 * Effective Adjust % — tighter on expiry day after 13:00 IST when expiry-day mode is on.
 */
export function effectiveAdjustThreshold(basePct, { expiryDayMode, anyExpiryDay, nowMs = Date.now() } = {}) {
  const base = Number(basePct);
  const safe = Number.isFinite(base) ? base : 60;
  if (!expiryDayMode || !anyExpiryDay) return safe;
  if (!isAfterIstHour(13, 0, nowMs)) return safe;
  return Math.min(safe, 40);
}

/**
 * Book quality verdict for a non-directional seller.
 * @returns {{ band: 'GOOD'|'MIXED'|'WEAK', score: number, bullets: string[], headline: string }}
 */
export function computeBookVerdict({
  netDelta = 0,
  netTheta = 0,
  shortCount = 0,
  adjustCount = 0,
  premiumLeft = null,
  itmShortCount = 0,
  pnl = 0,
} = {}) {
  let score = 50;
  const bullets = [];

  const absD = Math.abs(netDelta);
  if (absD < 10) {
    score += 20;
    bullets.push(`Net Δ ${netDelta.toFixed(1)} — near flat (good for non-directional).`);
  } else if (absD < 30) {
    score += 5;
    bullets.push(`Net Δ ${netDelta.toFixed(1)} — mild drift; consider a small hedge.`);
  } else {
    score -= 20;
    bullets.push(`Net Δ ${netDelta.toFixed(1)} — book is directional; flatten before selling more.`);
  }

  if (netTheta > 0) {
    score += 15;
    bullets.push(`Net Θ ₹${Math.round(netTheta)}/day — time decay is working for you.`);
  } else if (netTheta < 0) {
    score -= 15;
    bullets.push(`Net Θ ₹${Math.round(netTheta)}/day — paying premium (longs dominate).`);
  }

  if (shortCount > 0) {
    const adjRatio = adjustCount / shortCount;
    if (adjRatio === 0) {
      score += 10;
      bullets.push(`All ${shortCount} sold option(s) still OK — market is away.`);
    } else if (adjRatio <= 0.35) {
      score -= 5;
      bullets.push(`${adjustCount}/${shortCount} sold option(s) too close — check those first.`);
    } else {
      score -= 20;
      bullets.push(`${adjustCount}/${shortCount} sold option(s) too close — book is under pressure.`);
    }
  } else {
    bullets.push("No open short options — nothing collecting premium yet.");
  }

  if (itmShortCount > 0) {
    score -= 15;
    bullets.push(`${itmShortCount} short(s) ITM / assignment risk — watch extrinsic closely.`);
  }

  if (premiumLeft != null && premiumLeft > 0 && shortCount > 0) {
    score += 5;
    bullets.push(`~₹${Math.round(premiumLeft)} extrinsic left on shorts (decay runway).`);
  }

  if (pnl > 0) score += 5;
  else if (pnl < 0) score -= 5;

  score = Math.max(0, Math.min(100, score));
  let band = "MIXED";
  if (score >= 70) band = "GOOD";
  else if (score < 45) band = "WEAK";

  const headline =
    band === "GOOD"
      ? "Book looks seller-friendly"
      : band === "WEAK"
        ? "Book needs attention"
        : "Book is mixed — manage risk";

  return { band, score, bullets, headline };
}

/**
 * Flag short options near intrinsic / ITM, especially late day / expiry.
 */
export function computeAssignmentWatch(rows = [], { nowMs = Date.now(), expiryDayMode = true } = {}) {
  const late = isAfterIstHour(14, 0, nowMs) || (expiryDayMode && isAfterIstHour(13, 0, nowMs));
  const out = [];
  for (const r of rows) {
    if (!r?.isShort || !r?.isOpt || r.strike == null || !r.side) continue;
    const S = r.spotUsed;
    if (S == null) continue;
    const isCall = r.side === "CE";
    const intrinsic = intrinsicValue(S, r.strike, isCall) ?? 0;
    const itm = intrinsic > 0.5;
    const px = r.last_price ?? r.average_price;
    const extUnit = px != null ? Math.max(0, px - intrinsic) : null;
    const extPct = px > 0 && extUnit != null ? (extUnit / px) * 100 : null;
    const lowExt = extPct != null && extPct < 15;
    const nearItm =
      !itm &&
      Math.abs(S - r.strike) / S < 0.004; // within 0.4%

    if (!itm && !lowExt && !(nearItm && late)) continue;

    let severity = "watch";
    if (itm && late) severity = "critical";
    else if (itm || (lowExt && late)) severity = "high";

    out.push({
      tradingsymbol: r.tradingsymbol,
      strike: r.strike,
      side: r.side,
      spot: S,
      intrinsic,
      extrinsicUnit: extUnit,
      extrinsicPct: extPct,
      itm,
      severity,
      note: itm
        ? `ITM by ₹${intrinsic.toFixed(1)} — assignment / exercise risk`
        : lowExt
          ? `Extrinsic only ${extPct?.toFixed?.(0) ?? "—"}% of LTP — little premium left`
          : "Spot hugging strike late in the session",
    });
  }
  out.sort((a, b) => {
    const rank = { critical: 0, high: 1, watch: 2 };
    return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
  });
  return out;
}

/**
 * Suggest hedges when |Net Δ| drifts.
 * Futures qty ≈ −netDelta (index points exposure from Δ×qty).
 * Far OTM: buy cheap opposite-side options from the chain.
 */
export function computeDeltaHedgeSuggestions({
  netDelta = 0,
  threshold = 10,
  strikes = [],
  spot = null,
  step = 50,
} = {}) {
  const absD = Math.abs(netDelta);
  if (!(absD >= threshold) || !spot) {
    return { needed: false, netDelta, futuresQty: null, otmBuys: [], message: null };
  }

  // Hedge direction: positive Δ → sell futures / buy puts; negative Δ → buy futures / buy calls
  const futuresQty = -netDelta; // approximate index-point hedge
  const wantPuts = netDelta > 0;
  const side = wantPuts ? "PE" : "CE";

  const otmBuys = [];
  for (const s of strikes || []) {
    const K = s.strike;
    if (K == null) continue;
    const ltp = wantPuts ? s.pe_ltp : s.ce_ltp;
    if (!(ltp > 0)) continue;
    // Far OTM: puts below spot, calls above spot, ≥ ~3 steps away
    const otmOk = wantPuts ? K < spot - 3 * step : K > spot + 3 * step;
    if (!otmOk) continue;
    const moneyness = Math.abs(K - spot) / spot;
    if (moneyness < 0.015 || moneyness > 0.08) continue;
    otmBuys.push({
      strike: K,
      side,
      ltp,
      approxDeltaHint: wantPuts ? "long put ≈ negative Δ" : "long call ≈ positive Δ",
    });
  }
  otmBuys.sort((a, b) => a.ltp - b.ltp);
  const top = otmBuys.slice(0, 3);

  const message = wantPuts
    ? `Book Δ +${netDelta.toFixed(1)} — sell ~${Math.abs(futuresQty).toFixed(1)} index futures equiv, or buy far OTM puts.`
    : `Book Δ ${netDelta.toFixed(1)} — buy ~${Math.abs(futuresQty).toFixed(1)} index futures equiv, or buy far OTM calls.`;

  return {
    needed: true,
    netDelta,
    futuresQty,
    side,
    otmBuys: top,
    message,
  };
}

/**
 * Expiry-day premium clock: extrinsic left vs minutes to 15:30.
 */
export function computeExpiryDayClock(rows = [], nowMs = Date.now()) {
  const mins = minutesToCloseIST(nowMs);
  const expiryShorts = rows.filter((r) => r.isShort && r.isOpt && r.onExpiryDay);
  if (!expiryShorts.length) {
    return {
      active: false,
      minutesToClose: mins,
      after13: isAfterIstHour(13, 0, nowMs),
      items: [],
      totalExtrinsic: 0,
    };
  }
  const items = expiryShorts.map((r) => {
    const ext = r.extrinsicLeft ?? 0;
    const perMin = mins > 0 ? ext / mins : null;
    return {
      tradingsymbol: r.tradingsymbol,
      strike: r.strike,
      side: r.side,
      extrinsicLeft: ext,
      rupeesPerMinute: perMin,
      thetaToClose: r.thetaToClose,
    };
  });
  const totalExtrinsic = items.reduce((a, x) => a + (x.extrinsicLeft || 0), 0);
  return {
    active: true,
    minutesToClose: mins,
    after13: isAfterIstHour(13, 0, nowMs),
    items,
    totalExtrinsic,
  };
}
