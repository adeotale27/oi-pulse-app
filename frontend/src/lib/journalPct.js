/** Booked P&L as % of total trading book (not leftover margin). */

export function bookedPct(pnl, base) {
  const b = Number(base);
  if (!Number.isFinite(b) || b < 1) return null;
  const n = Number(pnl);
  if (!Number.isFinite(n)) return null;
  return (100 * n) / b;
}

export function fmtBookedPct(p, { signed = false } = {}) {
  if (p == null || Number.isNaN(Number(p))) return "—";
  const n = Number(p);
  const body = `${Math.abs(n).toFixed(2)}%`;
  if (!signed) return n < 0 ? `-${body}` : body;
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

export function weekEquity(sliceDocs) {
  const docs = (sliceDocs || []).filter(Boolean);
  let base = null;
  let pnl = 0;
  let cashflow = 0;
  for (const d of docs) {
    const b = Number(d.funds_base);
    if (base == null && Number.isFinite(b) && b >= 1) base = b;
    const dayPnl = d.booked_pnl != null ? Number(d.booked_pnl) : Number(d.pnl_exited) || 0;
    if (Number.isFinite(dayPnl)) pnl += dayPnl;
    if (d.inferred_cashflow != null && Number.isFinite(Number(d.inferred_cashflow))) {
      cashflow += Number(d.inferred_cashflow);
    }
  }
  const withdrawn = cashflow < 0 ? -cashflow : 0;
  const deposited = cashflow > 0 ? cashflow : 0;
  return {
    funds_base: base,
    pnl,
    booked_pct: bookedPct(pnl, base),
    inferred_cashflow: cashflow,
    inferred_withdrawn: withdrawn,
    inferred_deposited: deposited,
  };
}
