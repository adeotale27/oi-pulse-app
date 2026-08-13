function isTraded(doc) {
  if (!doc) return false;
  if ((doc.exited_count || 0) > 0) return true;
  if (Math.abs(Number(doc.booked_pnl) || 0) > 0.009) return true;
  if (Math.abs(Number(doc.pnl_exited) || 0) > 0.009) return true;
  if ((doc.legs || []).some((l) => l && l.exited)) return true;
  return false;
}

function cellPnl(doc) {
  if (!doc) return 0;
  if (doc.booked_pnl != null) return Number(doc.booked_pnl) || 0;
  if (doc.pnl_exited != null) return Number(doc.pnl_exited) || 0;
  if (doc.display_pnl != null) return Number(doc.display_pnl) || 0;
  return 0;
}

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];

function emptyHeat(year) {
  const by_index = Object.fromEntries(INDICES.map((idx) => [idx, Array(12).fill(0)]));
  return {
    year,
    indices: INDICES.slice(),
    by_index,
    month_nets: Array(12).fill(0),
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      net_pnl: 0,
      trading_days: 0,
      by_index: Object.fromEntries(INDICES.map((idx) => [idx, 0])),
    })),
  };
}

function cloneHeat(base, year) {
  const heat = emptyHeat(year);
  if (!base) return heat;
  if (base.by_index) {
    for (const idx of INDICES) {
      heat.by_index[idx] = (base.by_index[idx] || Array(12).fill(0)).slice();
    }
  }
  if (base.month_nets) {
    for (let i = 0; i < 12; i += 1) heat.month_nets[i] = Number(base.month_nets[i]) || 0;
  }
  if (base.months) {
    for (let i = 0; i < 12; i += 1) {
      const m = base.months[i] || {};
      heat.months[i] = {
        month: i + 1,
        net_pnl: Number(m.net_pnl) || heat.month_nets[i],
        trading_days: Number(m.trading_days) || 0,
        by_index: {
          NIFTY: Number(m.by_index?.NIFTY) || heat.by_index.NIFTY[i],
          SENSEX: Number(m.by_index?.SENSEX) || heat.by_index.SENSEX[i],
          BANKNIFTY: Number(m.by_index?.BANKNIFTY) || heat.by_index.BANKNIFTY[i],
        },
      };
    }
  }
  return heat;
}

/** If the open month calendar has booked days, stamp that month onto the year grid. */
export function overlayMonthOnYearHeat(yearHeat, monthPayload, year, month) {
  const heat = cloneHeat(yearHeat, year);
  const days = monthPayload?.days || [];
  if (!days.length) return heat;
  if (Number(monthPayload.year) !== Number(year) && monthPayload.year != null) return heat;
  if (Number(monthPayload.month) !== Number(month) && monthPayload.month != null) return heat;
  const mi = month - 1;
  if (mi < 0 || mi > 11) return heat;
  let net = 0;
  let tradedDays = 0;
  const idxAcc = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
  days.forEach((d) => {
    if (!isTraded(d)) return;
    net += cellPnl(d);
    tradedDays += 1;
    const ip = d.booked_index_pnl || {};
    for (const k of Object.keys(idxAcc)) idxAcc[k] += Number(ip[k]) || 0;
  });
  if (!tradedDays) return heat;
  heat.month_nets[mi] = net;
  heat.months[mi] = {
    month,
    net_pnl: net,
    trading_days: tradedDays,
    by_index: { ...idxAcc },
  };
  for (const k of INDICES) heat.by_index[k][mi] = idxAcc[k];
  return heat;
}
