import { HEATMAP_IDS, emptyDeskPnl, matchSymbolPrefix } from "./universe.js";

function isTraded(doc) {
  if (!doc) return false;
  if ((doc.exited_count || 0) > 0) return true;
  if ((doc.partial_count || 0) > 0) return true;
  if (Math.abs(Number(doc.booked_pnl) || 0) > 0.009) return true;
  if (Math.abs(Number(doc.pnl_exited) || 0) > 0.009) return true;
  if ((doc.legs || []).some((l) => l && (l.exited || l.partial || Math.abs(Number(l.realised) || 0) > 0.009))) return true;
  return false;
}

function cellPnl(doc) {
  if (!doc) return 0;
  if (doc.booked_pnl != null) return Number(doc.booked_pnl) || 0;
  if (doc.pnl_exited != null) return Number(doc.pnl_exited) || 0;
  if (doc.display_pnl != null) return Number(doc.display_pnl) || 0;
  return 0;
}

export function heatmapIndexFromLeg(leg) {
  const raw = String(leg?.index || "").trim().toUpperCase();
  if (HEATMAP_IDS.includes(raw)) return raw;
  const ts = String(leg?.tradingsymbol || leg?.display_name || "").toUpperCase().replace(/\s+/g, "");
  const fromTs = matchSymbolPrefix(ts);
  if (fromTs && HEATMAP_IDS.includes(fromTs)) return fromTs;
  return "OTHER";
}

function bookedIndexPnl(doc) {
  const acc = emptyDeskPnl();
  let other = 0;
  const legs = (doc?.legs || []).filter(
    (l) => l && (l.exited || l.partial || Math.abs(Number(l.realised) || 0) > 0.009),
  );
  if (legs.length) {
    for (const leg of legs) {
      const key = heatmapIndexFromLeg(leg);
      let val = Number(leg.realised);
      if (!Number.isFinite(val) || Math.abs(val) < 1e-9) val = Number(leg.pnl) || 0;
      if (key in acc) acc[key] += val;
      else other += val;
    }
  } else {
    const ip = doc?.booked_index_pnl || {};
    for (const k of HEATMAP_IDS) acc[k] += Number(ip[k]) || 0;
    for (const [k, v] of Object.entries(ip)) {
      if (!HEATMAP_IDS.includes(String(k).toUpperCase())) other += Number(v) || 0;
    }
  }
  const attributed = HEATMAP_IDS.reduce((s, k) => s + acc[k], 0) + other;
  const gap = cellPnl(doc) - attributed;
  if (Math.abs(gap) > 0.5) other += gap;
  return { ...acc, OTHER: other };
}

function emptyHeat(year) {
  const by_index = Object.fromEntries(HEATMAP_IDS.map((idx) => [idx, Array(12).fill(0)]));
  return {
    year,
    indices: HEATMAP_IDS.slice(),
    by_index,
    other: Array(12).fill(0),
    month_nets: Array(12).fill(0),
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      net_pnl: 0,
      trading_days: 0,
      by_index: emptyDeskPnl(),
      other: 0,
    })),
  };
}

function cloneHeat(base, year) {
  const heat = emptyHeat(year);
  if (!base) return heat;
  if (base.by_index) {
    for (const idx of HEATMAP_IDS) {
      heat.by_index[idx] = (base.by_index[idx] || Array(12).fill(0)).slice();
    }
  }
  if (base.month_nets) {
    for (let i = 0; i < 12; i += 1) heat.month_nets[i] = Number(base.month_nets[i]) || 0;
  }
  if (base.other) {
    for (let i = 0; i < 12; i += 1) heat.other[i] = Number(base.other[i]) || 0;
  }
  if (base.months) {
    for (let i = 0; i < 12; i += 1) {
      const m = base.months[i] || {};
      const byIdx = emptyDeskPnl();
      for (const idx of HEATMAP_IDS) {
        byIdx[idx] = Number(m.by_index?.[idx]) || heat.by_index[idx]?.[i];
      }
      heat.months[i] = {
        month: i + 1,
        net_pnl: Number(m.net_pnl) || heat.month_nets[i],
        trading_days: Number(m.trading_days) || 0,
        by_index: byIdx,
        other: Number(m.other) || heat.other[i],
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
  const idxAcc = emptyDeskPnl();
  let other = 0;
  days.forEach((d) => {
    if (!isTraded(d)) return;
    net += cellPnl(d);
    tradedDays += 1;
    const ip = bookedIndexPnl(d);
    for (const k of HEATMAP_IDS) idxAcc[k] += Number(ip[k]) || 0;
    other += Number(ip.OTHER) || 0;
  });
  if (!tradedDays) return heat;
  heat.month_nets[mi] = net;
  heat.other[mi] = other;
  heat.months[mi] = {
    month,
    net_pnl: net,
    trading_days: tradedDays,
    by_index: { ...idxAcc },
    other,
  };
  for (const k of HEATMAP_IDS) heat.by_index[k][mi] = idxAcc[k];
  return heat;
}
