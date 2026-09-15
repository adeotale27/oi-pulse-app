/** Open-option BUY vs SELL hedge status. Groups are data-driven (no index catalog). */

import { optionSide } from "./optionSide.js";

/** Same open/flat rule as Positions: remaining net qty, not day buy/sell volume. */
export function isOpenPositionRow(row) {
  if (!row) return false;
  if (row.exited) return false;
  return Number(row.quantity) !== 0;
}

/** Underlying from the row (API `index`) or the letter prefix of the symbol. */
export function hedgeUnderlying(row) {
  const idx = String(row?.index || "").trim().toUpperCase();
  if (idx) return idx;
  const ts = String(row?.tradingsymbol || row?.display_name || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  const m = ts.match(/^([A-Z]+)\d/);
  return m ? m[1] : "";
}

export function hedgeOptionType(row) {
  return optionSide(row);
}

function gcd(a, b) {
  a = Math.abs(Math.trunc(Number(a) || 0));
  b = Math.abs(Math.trunc(Number(b) || 0));
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function quantityToLots(qty, lotSize) {
  const q = Math.abs(Number(qty) || 0);
  const lot = Number(lotSize);
  const size = Number.isFinite(lot) && lot > 0 ? lot : 1;
  return Math.round((q / size) * 10000) / 10000;
}

/** GCD of two+ distinct quantities — never treat a single qty as the lot size. */
export function inferLotSize(quantities) {
  const vals = [...new Set(
    (quantities || []).map((q) => Math.abs(Math.trunc(Number(q) || 0))).filter((q) => q > 0),
  )];
  if (vals.length < 2) return null;
  const g = vals.reduce((a, b) => gcd(a, b));
  return g > 0 ? g : null;
}

function rowLotSize(row, inferred) {
  const ls = Number(row?.lot_size);
  if (Number.isFinite(ls) && ls > 0) return ls;
  if (Number.isFinite(inferred) && inferred > 0) return inferred;
  return 1;
}

function fmtLots(n) {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function groupStatus(buyLots, sellLots) {
  const netLots = Math.round(Math.abs(buyLots - sellLots) * 10000) / 10000;
  if (netLots === 0) {
    return { kind: "hedged", netLots: 0, remainingSide: null };
  }
  const remainingSide = buyLots > sellLots ? "BUY" : "SELL";
  const kind = buyLots === 0 || sellLots === 0 ? "unhedged" : "underhedged";
  return { kind, netLots, remainingSide };
}

export function formatHedgeGroupLabel({ kind, underlying, optionType, netLots }) {
  const name = `${underlying} ${optionType}`;
  const unit = netLots === 1 ? "lot" : "lots";
  if (kind === "hedged") return `${name} — Fully Hedged`;
  if (kind === "unhedged") return `${name} — Unhedged by ${fmtLots(netLots)} ${unit}`;
  return `${name} — Underhedged by ${fmtLots(netLots)} ${unit}`;
}

export function formatHedgeGroupShort({ kind, netLots }) {
  const unit = netLots === 1 ? "lot" : "lots";
  if (kind === "hedged") return "Fully Hedged";
  if (kind === "unhedged") return `Unhedged by ${fmtLots(netLots)} ${unit}`;
  return `Underhedged by ${fmtLots(netLots)} ${unit}`;
}

/**
 * Hedge book for currently open option legs.
 * Groups: underlying + CE/PE (strikes aggregate; expiries follow the book — not split).
 * CE never offsets PE; different underlyings never offset each other.
 */
export function computePositionHedge(rows = []) {
  const openOpts = [];
  const qtyByUnderlying = new Map();

  for (const row of rows) {
    if (!isOpenPositionRow(row)) continue;
    const optionType = hedgeOptionType(row);
    if (!optionType) continue;
    const underlying = hedgeUnderlying(row);
    if (!underlying) continue;
    const qty = Number(row.quantity) || 0;
    openOpts.push({ row, optionType, underlying, qty });
    if (!qtyByUnderlying.has(underlying)) qtyByUnderlying.set(underlying, []);
    qtyByUnderlying.get(underlying).push(Math.abs(qty));
  }

  const inferredByUnderlying = new Map();
  for (const [under, qtys] of qtyByUnderlying) {
    inferredByUnderlying.set(under, inferLotSize(qtys));
  }

  const buckets = new Map();
  for (const { row, optionType, underlying, qty } of openOpts) {
    const key = `${underlying}\0${optionType}`;
    let b = buckets.get(key);
    if (!b) {
      b = { underlying, optionType, buyLots: 0, sellLots: 0, lotSize: null };
      buckets.set(key, b);
    }
    const lotSize = rowLotSize(row, inferredByUnderlying.get(underlying));
    if (b.lotSize == null) b.lotSize = lotSize;
    const lots = quantityToLots(qty, lotSize);
    if (qty > 0) b.buyLots += lots;
    else b.sellLots += lots;
  }

  const groups = [];
  for (const b of buckets.values()) {
    b.buyLots = Math.round(b.buyLots * 10000) / 10000;
    b.sellLots = Math.round(b.sellLots * 10000) / 10000;
    const st = groupStatus(b.buyLots, b.sellLots);
    groups.push({
      underlying: b.underlying,
      optionType: b.optionType,
      buyLots: b.buyLots,
      sellLots: b.sellLots,
      lotSize: b.lotSize,
      ...st,
      label: formatHedgeGroupLabel({
        kind: st.kind,
        underlying: b.underlying,
        optionType: b.optionType,
        netLots: st.netLots,
      }),
      shortLabel: formatHedgeGroupShort(st),
    });
  }

  groups.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.optionType.localeCompare(b.optionType));

  const unhedgedCount = groups.filter((g) => g.kind === "unhedged").length;
  const underhedgedCount = groups.filter((g) => g.kind === "underhedged").length;
  const issueCount = unhedgedCount + underhedgedCount;

  let overallKind = "none";
  let overallLabel = "";
  if (!groups.length) {
    overallKind = "none";
    overallLabel = "";
  } else if (unhedgedCount > 0) {
    overallKind = "unhedged";
    overallLabel = `${unhedgedCount} Unhedged Exposure${unhedgedCount === 1 ? "" : "s"}`;
  } else if (underhedgedCount > 0) {
    overallKind = "issues";
    overallLabel = `${underhedgedCount} Hedge Issue${underhedgedCount === 1 ? "" : "s"}`;
  } else {
    overallKind = "hedged";
    overallLabel = "All Positions Hedged";
  }

  const byUnderlying = [];
  let cur = null;
  for (const g of groups) {
    if (!cur || cur.underlying !== g.underlying) {
      cur = { underlying: g.underlying, groups: [] };
      byUnderlying.push(cur);
    }
    cur.groups.push(g);
  }

  return {
    groups,
    byUnderlying,
    unhedgedCount,
    underhedgedCount,
    issueCount,
    overallKind,
    overallLabel,
  };
}
