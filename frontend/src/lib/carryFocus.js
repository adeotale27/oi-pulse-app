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
  }).slice(0, 12);
}

/** Session OI in seller language (PE build vs CE build). */
export function writerBiasLine(row) {
  const idx = row?.index || "Index";
  const b = row?.bias;
  if (!b) return { index: idx, text: "no session OI yet", short: "no OI", comfortable: null };
  if (b.bullish) {
    return {
      index: idx,
      text: "PE OI built — support; sold calls sit better than sold puts",
      short: "Calls sit better",
      comfortable: "CE",
    };
  }
  return {
    index: idx,
    text: "CE OI built — resistance; sold puts sit better than sold calls",
    short: "Puts sit better",
    comfortable: "PE",
  };
}

/** Compact event label for the phone sheet. */
export function eventShortName(e) {
  const n = String(e?.name || "");
  const impact = n.match(/·\s*([A-Za-z0-9.& -]+)\s*·/);
  if (impact) {
    const sym = impact[1].trim();
    const idx = (e.index || n.split(" ")[0] || "").replace(" impact", "");
    return idx && !sym.includes(idx) ? `${sym} · ${idx}` : sym;
  }
  return n.replace(/^NSE Holiday — /, "Holiday: ").slice(0, 48);
}

/** Full label for the open carry case (wraps; not truncated to a chip). */
export function eventDisplayName(e) {
  if (!e) return "";
  if (e.source === "index-impact") {
    const short = eventShortName(e);
    const w = e.weightage != null && Number.isFinite(Number(e.weightage))
      ? ` · ${Number(e.weightage).toFixed(1)}% wt`
      : "";
    return `${short}${w}`;
  }
  return String(e.name || "").replace(/^NSE Holiday — /, "Holiday: ");
}

export function partitionCarryEvents(items = []) {
  const all = carryFocusEvents(items);
  return {
    results: all.filter((e) => e.source === "index-impact"),
    holidays: all.filter((e) => e.source === "holiday" || e.type === "holiday"),
    other: all.filter((e) => e.source !== "index-impact" && e.source !== "holiday" && e.type !== "holiday"),
  };
}

export function summarizeBook(positions = []) {
  const open = (positions || []).filter((p) => !p.exited && Number(p.quantity) !== 0);
  const shorts = open.filter((p) => Number(p.quantity) < 0);
  const byIndex = {};
  for (const p of shorts) {
    const idx = String(p.index || "OTHER").toUpperCase();
    if (!byIndex[idx]) byIndex[idx] = { ce: 0, pe: 0, n: 0 };
    const side = String(p.side || "").toUpperCase();
    if (side === "CE") byIndex[idx].ce += 1;
    else if (side === "PE") byIndex[idx].pe += 1;
    byIndex[idx].n += 1;
  }
  return { openCount: open.length, shortCount: shorts.length, byIndex };
}

/**
 * Consolidated carry case: why hold short premium vs why not, plus result/holiday lists.
 */
export function carryCase({
  weekday,
  vix = null,
  giftPct = null,
  biases = [],
  events = [],
  book = null,
  holidayAdvice = null,
} = {}) {
  const why = [];
  const whyNot = [];
  const parts = partitionCarryEvents(events);
  const v = vix != null && Number.isFinite(Number(vix)) ? Number(vix) : null;
  const g = giftPct != null && Number.isFinite(Number(giftPct)) ? Number(giftPct) : null;

  if (weekday === 5) whyNot.push("Friday → Monday open is a weekend gap on short premium");
  if (weekday === 0) whyNot.push("Sunday night into Monday cash open (GIFT gap)");
  for (const h of parts.holidays) {
    whyNot.push(h.name ? String(h.name).replace(/^NSE Holiday — /, "Holiday: ") : "NSE holiday in the carry window");
  }
  if (holidayAdvice && !parts.holidays.length) whyNot.push(holidayAdvice);
  if (parts.results.length) {
    whyNot.push(
      `${parts.results.length} index-weight result${parts.results.length === 1 ? "" : "s"} before the next open`,
    );
  }
  for (const e of parts.other) {
    whyNot.push(`${dayish(e)} ${eventShortName(e)}`);
  }
  if (v != null && v >= 18) whyNot.push(`India VIX ${v.toFixed(1)} — overnight gap typically wider`);
  else if (v != null && v < 15) why.push(`India VIX ${v.toFixed(1)} — overnight vol not elevated`);
  if (g != null && Math.abs(g) >= 0.35) {
    whyNot.push(`GIFT ${g >= 0 ? "+" : ""}${g.toFixed(2)}% vs cash — expect a gap at open`);
  } else if (g != null && Math.abs(g) < 0.2) {
    why.push("GIFT near flat vs cash");
  }

  for (const row of biases || []) {
    const line = writerBiasLine(row);
    if (!row?.bias) continue;
    if (line.comfortable === "CE") why.push(`${row.index}: PE OI built — CE shorts better supported`);
    else if (line.comfortable === "PE") why.push(`${row.index}: CE OI built — PE shorts better supported`);
  }

  if (book?.shortCount) {
    why.push(`Book: ${book.shortCount} open short option${book.shortCount === 1 ? "" : "s"}`);
    for (const [idx, bag] of Object.entries(book.byIndex || {})) {
      const row = (biases || []).find((b) => b.index === idx);
      const line = writerBiasLine(row || { index: idx });
      if (line.comfortable === "CE" && bag.pe > bag.ce) {
        whyNot.push(`${idx}: you are short more PE while session OI supports CE shorts`);
      } else if (line.comfortable === "PE" && bag.ce > bag.pe) {
        whyNot.push(`${idx}: you are short more CE while session OI supports PE shorts`);
      }
    }
  } else if (book && book.shortCount === 0 && book.openCount === 0) {
    why.push("No open F&O shorts in the connected book");
  }

  if (!whyNot.length) why.push("No holiday or heavy index-impact in the carry window");
  if (!why.length) why.push("No strong session-OI tailwind — size as a gap, not a conviction hold");

  return {
    why: uniq(why).slice(0, 8),
    whyNot: uniq(whyNot).slice(0, 8),
    results: parts.results,
    holidays: parts.holidays,
    other: parts.other,
  };
}

function dayish(e) {
  if (e?.daysAway === 0) return "Today ·";
  if (e?.daysAway === 1) return "Tomorrow ·";
  if (e?.daysAway != null) return `In ${e.daysAway}d ·`;
  return "";
}

function uniq(arr) {
  const seen = new Set();
  return arr.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

export function sellerCarryAdvice({ band, holidayAdvice, vix, giftPct, focusCount = 0 }) {
  const v = vix != null && Number.isFinite(Number(vix)) ? Number(vix) : null;
  const g = giftPct != null && Number.isFinite(Number(giftPct)) ? Number(giftPct) : null;
  const bits = [];
  if (band === "DO_NOT_CARRY") {
    bits.push("Do not hold unhedged premium through the gap. Cut or make it defined-risk before the next open.");
  } else if (band === "REDUCE") {
    bits.push("Hold only the sold options that session OI still supports. Hedge or reduce the index that is working against you.");
  } else {
    bits.push("Calendar and session OI look holdable overnight if the book stays hedged and not too close to spot.");
  }
  if (holidayAdvice) bits.push(holidayAdvice);
  else if (v != null && v >= 18) bits.push(`India VIX ${v.toFixed(1)} — size the gap, do not add naked sold premium.`);
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
