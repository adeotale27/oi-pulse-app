/** Map open Kite option legs onto OI chart strikes (B = long, S = short). */

import { optionSide } from "./optionSide.js";
import { isOpenPositionRow, hedgeUnderlying, quantityToLots } from "./positionHedge.js";

const MON = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function isoFromYmd(yyyy, month, day) {
  if (!yyyy || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Strike / side / expiry from a Kite option tradingsymbol. */
export function parseOptionSymbol(ts) {
  const s = String(ts || "").toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  const weeklyMmm = s.match(/^([A-Z]+)(\d{2})([A-Z]{3})(\d{2})(\d{4,6})(CE|PE)$/);
  if (weeklyMmm && MON[weeklyMmm[3]]) {
    const yyyy = 2000 + Number(weeklyMmm[2]);
    return {
      strike: Number(weeklyMmm[5]),
      side: weeklyMmm[6],
      expiry: isoFromYmd(yyyy, MON[weeklyMmm[3]], Number(weeklyMmm[4])),
    };
  }
  const monthly = s.match(/^([A-Z]+)(\d{2})([A-Z]{3})(\d{4,6})(CE|PE)$/);
  if (monthly && MON[monthly[3]]) {
    return { strike: Number(monthly[4]), side: monthly[5], expiry: null };
  }
  const compactCe = s.match(/^([A-Z]+)(\d{2})(\d)(\d{2})(\d{4,6})(CE|PE)$/);
  if (compactCe) {
    const yyyy = 2000 + Number(compactCe[2]);
    return {
      strike: Number(compactCe[5]),
      side: compactCe[6],
      expiry: isoFromYmd(yyyy, Number(compactCe[3]), Number(compactCe[4])),
    };
  }
  const compactC = s.match(/^([A-Z]+)(\d{2})(\d)(\d{2})(\d{4,6})(C|P)$/);
  if (compactC) {
    const yyyy = 2000 + Number(compactC[2]);
    return {
      strike: Number(compactC[5]),
      side: compactC[6] === "P" ? "PE" : "CE",
      expiry: isoFromYmd(yyyy, Number(compactC[3]), Number(compactC[4])),
    };
  }
  return null;
}

export function strikeKey(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

export function strikeFromRow(row) {
  const fromField = strikeKey(row?.strike);
  if (fromField) return fromField;
  const named = String(row?.display_name || "").toUpperCase();
  const dm = named.match(/(\d{4,6})\s*(CE|PE)\b/);
  if (dm) return Number(dm[1]);
  const parsed = parseOptionSymbol(row?.tradingsymbol);
  return parsed?.strike || null;
}

export function rowExpiryISO(row) {
  if (row?.expiry_iso) return String(row.expiry_iso).slice(0, 10);
  return parseOptionSymbol(row?.tradingsymbol)?.expiry || null;
}

export function sameChartExpiry(rowExp, chartExp) {
  if (!chartExp) return true;
  if (!rowExp) return false;
  return String(rowExp).slice(0, 10) === String(chartExp).slice(0, 10);
}

export function sameIndex(rowIdx, want) {
  const a = String(rowIdx || "").trim().toUpperCase();
  const b = String(want || "").trim().toUpperCase();
  if (!b) return true;
  if (!a) return false;
  if (a === b) return true;
  const compact = (s) => s.replace(/[\s._-]+/g, "");
  return compact(a) === compact(b);
}

export function openOiMarks(positions, indexName, chartExpiry) {
  const want = String(indexName || "").toUpperCase();
  const net = new Map();
  for (const row of positions || []) {
    if (!isOpenPositionRow(row)) continue;
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const rowIdx = hedgeUnderlying(row);
    if (want && !sameIndex(rowIdx, want)) continue;
    const exp = rowExpiryISO(row);
    if (!sameChartExpiry(exp, chartExpiry)) continue;
    const parsed = parseOptionSymbol(row?.tradingsymbol);
    const side = optionSide(row) || parsed?.side;
    if (side !== "CE" && side !== "PE") continue;
    const strike = strikeFromRow(row);
    if (!strike) continue;
    const key = `${strike}|${side}`;
    const cur = net.get(key) || { qty: 0, pnl: 0, lotSize: 0 };
    cur.qty += qty;
    cur.pnl += Number(row.unrealised ?? row.pnl ?? 0) || 0;
    const ls = Number(row.lot_size);
    if (Number.isFinite(ls) && ls > 0) cur.lotSize = ls;
    net.set(key, cur);
  }
  const marks = [];
  for (const [key, cur] of net) {
    if (!cur.qty) continue;
    const [strike, side] = key.split("|");
    const lotSize = cur.lotSize > 0 ? cur.lotSize : 1;
    marks.push({
      strike: Number(strike),
      side,
      tag: cur.qty < 0 ? "S" : "B",
      lots: quantityToLots(cur.qty, lotSize),
      pnl: Math.round(cur.pnl * 100) / 100,
      qty: cur.qty,
    });
  }
  return marks;
}

export function peTopKey(d) {
  if ((d.pe_down || 0) > 0) return "pe_down";
  if ((d.pe_up || 0) > 0) return "pe_up";
  return "pe_base";
}

export function ceTopKey(d) {
  if ((d.ce_down || 0) > 0) return "ce_down";
  if ((d.ce_up || 0) > 0) return "ce_up";
  return "ce_base";
}

function fmtLots(n) {
  if (Number.isInteger(n)) return String(n);
  const t = Math.round(n * 10000) / 10000;
  return String(t);
}

export function formatMarkHover(m) {
  if (!m) return "";
  const lots = Number(m.lots) || 0;
  const unit = Math.abs(lots) === 1 ? "lot" : "lots";
  const verb = m.tag === "S" ? "Sold" : "Bought";
  const pnl = Number(m.pnl) || 0;
  const abs = Math.abs(pnl);
  const num = abs.toLocaleString("en-IN", {
    maximumFractionDigits: abs % 1 ? 2 : 0,
    minimumFractionDigits: 0,
  });
  const money = pnl > 0 ? `+₹${num}` : pnl < 0 ? `-₹${num}` : "₹0";
  return `${verb} ${fmtLots(lots)} ${unit} · P&L ${money}`;
}
