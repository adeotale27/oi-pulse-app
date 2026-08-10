// Multi-leg payoff + portfolio greeks for Positions Analyze.

import { bsPrice, greeks, impliedVol, yearsToExpiry, intrinsicValue } from "./blackScholes.js";

const R = 0.065;

function spotOf(entry, fallback) {
  if (entry == null) return fallback ?? null;
  if (typeof entry === "number") return entry;
  if (typeof entry === "object" && entry.price != null) return Number(entry.price);
  return fallback ?? null;
}

export function resolvePositionSpot(row, spotByIndex = {}, fallbackSpot = null) {
  return spotOf(row?.index ? spotByIndex[row.index] : null, row?.spotUsed ?? fallbackSpot);
}

/**
 * Build expiry ISO for a position row (prefers backend expiry_iso).
 */
export function positionExpiryISO(row, activeExpiry = null) {
  if (row?.expiry_iso) return row.expiry_iso;
  const yy = row?.expiry_yy;
  const mm = String(row?.expiry_code || "");
  const day = row?.expiry_day;
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  if (yy == null) return activeExpiry;
  const yyyy = 2000 + parseInt(yy, 10);
  if (day && mm.length >= 3 && MON[mm.slice(0, 3)]) {
    const month = MON[mm.slice(0, 3)];
    return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (/^\d{1,2}\d{2}$/.test(mm) && day) {
    const month = parseInt(mm.slice(0, -2), 10) || parseInt(String(mm)[0], 10);
    return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (mm.length === 3 && MON[mm]) {
    const month = MON[mm];
    const last = new Date(Date.UTC(yyyy, month, 0));
    const lastDay = last.getUTCDay();
    const offset = (lastDay - 4 + 7) % 7;
    const lastThu = new Date(Date.UTC(yyyy, month - 1, last.getUTCDate() - offset));
    return lastThu.toISOString().slice(0, 10);
  }
  return activeExpiry;
}

function legMark(row, S, T, nowMs) {
  const isCall = row.side === "CE";
  const px = row.last_price || row.average_price;
  let iv = null;
  if (S > 0 && row.strike && T > 0 && px > 0) {
    iv = impliedVol(px, S, row.strike, T, R, isCall);
  }
  const theo = iv != null ? bsPrice(S, row.strike, T, R, iv, isCall) : px;
  const g = iv != null ? greeks(S, row.strike, T, R, iv, isCall) : { delta: null, gamma: null, theta: null, vega: null };
  return { iv, theo, g, px, isCall };
}

/**
 * Group open option legs by underlying index.
 */
export function groupPositionsByIndex(rows = []) {
  const map = new Map();
  for (const r of rows) {
    if (!r?.isOpt || !r.index) continue;
    if (!map.has(r.index)) map.set(r.index, []);
    map.get(r.index).push(r);
  }
  return map;
}

/**
 * Payoff series for selected legs of one index.
 * @returns {{ spots: number[], expiryPnl: number[], targetPnl: number[], spot: number, greeks: object, summary: object }}
 */
export function computeIndexPayoff({
  legs = [],
  spot,
  nowMs = Date.now(),
  targetFraction = 0, // 0 = now, 1 = expiry
  rangePct = 0.06,
  steps = 80,
} = {}) {
  const S0 = Number(spot);
  if (!(S0 > 0) || !legs.length) {
    return {
      spots: [],
      expiryPnl: [],
      targetPnl: [],
      spot: S0 || null,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
      summary: { maxProfit: null, maxLoss: null, breakevens: [], currentPnl: 0, popHint: null },
    };
  }

  const lo = S0 * (1 - rangePct);
  const hi = S0 * (1 + rangePct);
  const spots = [];
  const expiryPnl = [];
  const targetPnl = [];

  let netDelta = 0, netGamma = 0, netTheta = 0, netVega = 0;
  let currentPnl = 0;

  const enriched = legs.map((leg) => {
    const expIso = positionExpiryISO(leg);
    const T = yearsToExpiry(expIso, nowMs);
    const mark = legMark(leg, S0, Math.max(T, 1e-6), nowMs);
    const qty = leg.quantity || 0;
    if (mark.g.delta != null) netDelta += mark.g.delta * qty;
    if (mark.g.gamma != null) netGamma += mark.g.gamma * qty;
    if (mark.g.theta != null) netTheta += mark.g.theta * qty;
    if (mark.g.vega != null) netVega += mark.g.vega * qty;
    currentPnl += leg.pnl || 0;
    return { leg, expIso, T, mark, qty };
  });

  for (let i = 0; i <= steps; i++) {
    const S = lo + ((hi - lo) * i) / steps;
    spots.push(S);
    let ePnl = 0;
    let tPnl = 0;
    for (const { leg, T, mark, qty } of enriched) {
      const avg = leg.average_price || 0;
      const isCall = mark.isCall;
      const expiryVal = intrinsicValue(S, leg.strike, isCall) ?? 0;
      // PnL at expiry vs entry avg (per unit × qty). qty already signed.
      ePnl += (expiryVal - avg) * qty;

      const Ttgt = Math.max(0, T * (1 - targetFraction));
      const iv = mark.iv || 0.2;
      const tgtVal = Ttgt <= 1e-8
        ? expiryVal
        : bsPrice(S, leg.strike, Ttgt, R, iv, isCall);
      tPnl += (tgtVal - avg) * qty;
    }
    expiryPnl.push(ePnl);
    targetPnl.push(tPnl);
  }

  // Breakevens on expiry curve (sign changes)
  const breakevens = [];
  for (let i = 1; i < expiryPnl.length; i++) {
    if (expiryPnl[i - 1] === 0) breakevens.push(spots[i - 1]);
    else if (expiryPnl[i - 1] * expiryPnl[i] < 0) {
      const t = Math.abs(expiryPnl[i - 1]) / (Math.abs(expiryPnl[i - 1]) + Math.abs(expiryPnl[i]));
      breakevens.push(spots[i - 1] + t * (spots[i] - spots[i - 1]));
    }
  }

  const maxProfit = Math.max(...expiryPnl);
  const maxLoss = Math.min(...expiryPnl);
  const cappedProfit = Number.isFinite(maxProfit) ? maxProfit : null;
  const uncappedLoss = maxLoss === expiryPnl[0] || maxLoss === expiryPnl[expiryPnl.length - 1];

  // Crude POP: fraction of expiry curve above 0 weighted flat in range
  const above = expiryPnl.filter((v) => v >= 0).length;
  const popHint = Math.round((above / expiryPnl.length) * 100);

  return {
    spots,
    expiryPnl,
    targetPnl,
    spot: S0,
    greeks: { delta: netDelta, gamma: netGamma, theta: netTheta, vega: netVega },
    summary: {
      maxProfit: cappedProfit,
      maxLoss: uncappedLoss && maxLoss < 0 ? null : maxLoss, // null => Unlimited within window edge
      maxLossRaw: maxLoss,
      unlimitedLoss: uncappedLoss && maxLoss < 0,
      breakevens,
      currentPnl,
      popHint,
      profitLeft: cappedProfit != null ? cappedProfit - currentPnl : null,
    },
  };
}
