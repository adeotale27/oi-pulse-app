/** Compact live OI tape for Desk AI (no full strike grid). */

import { greeks, impliedVol, yearsToExpiry } from "./blackScholes";
import { computeSellCandidates } from "./sellCandidates";

export function summarizeIndexTape(current, previous) {
  if (!current || typeof current !== "object") return null;
  const strikes = Array.isArray(current.strikes) ? current.strikes : [];
  const prevMap = new Map(
    (Array.isArray(previous?.strikes) ? previous.strikes : []).map((s) => [s.strike, s]),
  );
  let ceChg = 0;
  let peChg = 0;
  let callWall = null;
  let putWall = null;
  for (const s of strikes) {
    const p = prevMap.get(s.strike);
    ceChg += (Number(s.ce_oi) || 0) - (Number(p?.ce_oi) || 0);
    peChg += (Number(s.pe_oi) || 0) - (Number(p?.pe_oi) || 0);
    const ce = Number(s.ce_oi) || 0;
    const pe = Number(s.pe_oi) || 0;
    if (!callWall || ce > callWall.oi) callWall = { k: s.strike, oi: ce };
    if (!putWall || pe > putWall.oi) putWall = { k: s.strike, oi: pe };
  }
  const pcr = Number(current.pcr);
  const px = Number(current.price);
  const atm = Number(current.atm);
  return {
    idx: String(current.index || "").slice(0, 16) || null,
    px: Number.isFinite(px) ? Math.round(px * 100) / 100 : null,
    atm: Number.isFinite(atm) ? atm : null,
    pcr: Number.isFinite(pcr) ? Math.round(pcr * 100) / 100 : null,
    ceChg: Math.round(ceChg),
    peChg: Math.round(peChg),
    callWall: callWall?.k ?? null,
    putWall: putWall?.k ?? null,
    expiry: current.expiry ? String(current.expiry).slice(0, 10) : null,
  };
}

export function tapeFromBiasRow(row) {
  if (!row) return null;
  const b = row.bias;
  return {
    idx: String(row.index || "").slice(0, 16) || null,
    px: row.price != null ? Number(row.price) : null,
    atm: row.atm != null ? Number(row.atm) : null,
    pcr: row.pcr != null ? Number(row.pcr) : null,
    ceChg: b ? Math.round(Number(b.ce) || 0) : null,
    peChg: b ? Math.round(Number(b.pe) || 0) : null,
    expiry: row.expiry ? String(row.expiry).slice(0, 10) : null,
  };
}

export function compactJournalFromPeriod(data) {
  const s = data?.stats || data;
  if (!s || typeof s !== "object") return null;
  const booked = s.booked_pnl ?? s.net_pnl;
  if (booked == null && s.win_rate == null && !s.trading_days) return null;
  return {
    booked_pnl: booked != null ? Number(booked) : null,
    win_rate: s.win_rate != null ? Number(s.win_rate) : null,
    trading_days: s.trading_days != null ? Number(s.trading_days) : null,
    win_trades: s.win_trades ?? s.win_days ?? null,
    loss_trades: s.loss_trades ?? s.lose_days ?? null,
    by_index: s.by_index && typeof s.by_index === "object" ? s.by_index : null,
  };
}

export function compactBookFromPositions(data) {
  const rows = Array.isArray(data?.positions) ? data.positions : [];
  const open = rows.filter((r) => !r.exited && Number(r.quantity) !== 0);
  const shorts = open.filter((r) => Number(r.quantity) < 0 && r.strike && r.side);
  const byIndex = {};
  const legs = [];
  let netDelta = 0;
  let netTheta = 0;
  let netVega = 0;
  let ivSum = 0;
  let ivN = 0;
  let adjustCount = 0;
  for (const r of shorts) {
    const idx = String(r.index || "").slice(0, 16) || "UNK";
    if (!byIndex[idx]) byIndex[idx] = { ce: 0, pe: 0, ceQty: 0, peQty: 0, n: 0 };
    const qty = Math.abs(Number(r.quantity) || 0);
    if (r.side === "CE") {
      byIndex[idx].ce += 1;
      byIndex[idx].ceQty += qty;
    } else if (r.side === "PE") {
      byIndex[idx].pe += 1;
      byIndex[idx].peQty += qty;
    }
    byIndex[idx].n += 1;
    const S = Number(r.spot || r.spotUsed);
    const K = Number(r.strike);
    let dist = null;
    let itm = false;
    if (Number.isFinite(S) && S > 0 && Number.isFinite(K)) {
      dist = Number((((K - S) / S) * 100).toFixed(2));
      itm = r.side === "CE" ? S > K : S < K;
    }
    const close = itm || (dist != null && Math.abs(dist) < 1.2);
    if (close) adjustCount += 1;
    let ivPct = null;
    let delta = null;
    let theta = null;
    const exp = r.expiry || r.expiry_date;
    const px = Number(r.last_price || r.average_price);
    if (Number.isFinite(S) && S > 0 && Number.isFinite(K) && exp && Number.isFinite(px) && px > 0) {
      const T = yearsToExpiry(String(exp).slice(0, 10));
      const isCall = r.side === "CE";
      const iv = T > 0 ? impliedVol(px, S, K, T, 0.065, isCall) : null;
      if (iv != null && iv > 0) {
        ivPct = Number((iv * 100).toFixed(1));
        ivSum += ivPct;
        ivN += 1;
        const g = greeks(S, K, T, 0.065, iv, isCall);
        const q = Number(r.quantity) || 0; // short is negative
        if (Number.isFinite(g.delta)) {
          delta = Number((g.delta * q).toFixed(2));
          netDelta += delta;
        }
        if (Number.isFinite(g.theta)) {
          theta = Number((g.theta * q).toFixed(2));
          netTheta += theta;
        }
        if (Number.isFinite(g.vega)) netVega += g.vega * q;
      }
    }
    legs.push({
      s: String(r.tradingsymbol || "").slice(0, 24),
      side: r.side === "PE" ? "PE" : "CE",
      K,
      idx,
      dist,
      itm,
      close,
      iv: ivPct,
      delta,
      theta,
    });
  }
  return {
    book: {
      openCount: open.length,
      shortCount: shorts.length,
      byIndex,
    },
    adjust: {
      shortCount: shorts.length,
      adjustCount,
      netDelta: Number(netDelta.toFixed(2)),
      netTheta: Number(netTheta.toFixed(2)),
      netVega: Number(netVega.toFixed(2)),
      avgIv: ivN ? Number((ivSum / ivN).toFixed(1)) : null,
      legs: legs.slice(0, 8),
    },
  };
}

export function fmtOiLakh(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  if (Math.abs(v) >= 100000) return `${sign}${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `${sign}${(v / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(v)}`;
}

export function daysAgoIST(n, fromISO) {
  const iso = fromISO || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

export function compactTopSells(result, indexName) {
  const ce = result?.candidates?.ce || [];
  const pe = result?.candidates?.pe || [];
  return [...ce, ...pe]
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, 3)
    .map((x) => {
      const why = Array.isArray(x.rationale)
        ? x.rationale.slice(0, 2).join(", ")
        : String(x.rationale || "");
      const label = `${indexName || ""} ${x.strike ?? ""} ${x.side || ""}`.replace(/\s+/g, " ").trim();
      return {
        s: label.slice(0, 28),
        strike: x.strike ?? null,
        side: x.side === "PE" ? "PE" : x.side === "CE" ? "CE" : null,
        score: x.score != null ? Number(x.score) : null,
        why: why.slice(0, 80),
      };
    });
}

export function compactSellIdeas(indexName, current, previous, vixNow, extra = {}) {
  if (!current?.strikes?.length) return [];
  const r = computeSellCandidates({
    current,
    previous,
    vixNow,
    indexName,
    step: extra.step,
    vrp: extra.vrp,
  });
  return compactTopSells(r, indexName || current.index);
}
