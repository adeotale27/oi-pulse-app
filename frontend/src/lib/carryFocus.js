/** Carry-brief focus: only what an index-options seller needs overnight. */

export function carryFocusEvents(items = []) {
  const ranked = [];
  for (const e of items || []) {
    let rank = 0;
    if (e.source === "holiday" || e.type === "holiday") rank = 100;
    else if (e.source === "index-impact") rank = 80 + Math.min(20, Number(e.weightage || 0) * 4);
    else if (e.impact === "critical") rank = 70;
    else if (e.impact === "high") rank = 50;
    else continue;
    ranked.push({ ...e, rank });
  }
  ranked.sort((a, b) => {
    const dr = (b.rank || 0) - (a.rank || 0);
    if (dr) return dr;
    return (a.daysAway || 0) - (b.daysAway || 0);
  });
  const seen = new Set();
  return ranked.filter((e) => {
    const k = `${e.date}|${e.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

/** Session OI in seller language (PE build vs CE build). */
export function writerBiasLine(row) {
  const idx = row?.index || "Index";
  const b = row?.bias;
  if (!b) return { index: idx, text: "no session OI yet", comfortable: null };
  if (b.bullish) {
    return {
      index: idx,
      text: "PE OI built — support; CE shorts sit better than PE shorts",
      comfortable: "CE",
    };
  }
  return {
    index: idx,
    text: "CE OI built — resistance; PE shorts sit better than CE shorts",
    comfortable: "PE",
  };
}

export function sellerCarryAdvice({ band, holidayAdvice, vix, giftPct, focusCount = 0 }) {
  const v = vix != null && Number.isFinite(Number(vix)) ? Number(vix) : null;
  const g = giftPct != null && Number.isFinite(Number(giftPct)) ? Number(giftPct) : null;
  const bits = [];
  if (band === "DO_NOT_CARRY") {
    bits.push("Do not hold unhedged short premium through the gap. Cut or make it defined-risk before the next open.");
  } else if (band === "REDUCE") {
    bits.push("Carry only the shorts that session OI still supports. Hedge or reduce the index that is working against you.");
  } else {
    bits.push("Calendar and session OI look carry-able if shorts stay hedged and not too close to spot.");
  }
  if (holidayAdvice) bits.push(holidayAdvice);
  else if (v != null && v >= 18) bits.push(`India VIX ${v.toFixed(1)} — size the gap, do not add naked shorts.`);
  else if (g != null && Math.abs(g) >= 0.35) {
    bits.push(`GIFT ${g >= 0 ? "+" : ""}${g.toFixed(2)}% into the open — expect a gap vs cash.`);
  } else if (focusCount === 0 && band === "CARRY_OK") {
    bits.push("No heavy index-impact or holiday in the carry window.");
  }
  return bits.join(" ");
}

export function vixCarryPoints(vix) {
  const v = vix != null && Number.isFinite(Number(vix)) ? Number(vix) : null;
  if (v == null) return { pts: 0, note: null };
  if (v >= 18) return { pts: 18, note: `India VIX ${v.toFixed(1)} — overnight gap typically wider` };
  if (v >= 15) return { pts: 8, note: `India VIX ${v.toFixed(1)}` };
  return { pts: 0, note: `India VIX ${v.toFixed(1)}` };
}
