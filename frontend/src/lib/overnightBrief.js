// Overnight gap brief — "should I carry?" decision helpers.
// Shared by BigClock (15:15 toast) and OvernightGapBrief sticky card.

import { eventsWithinDays } from "@/lib/econCalendar";
import { upcomingHolidays, todayIST, daysBetweenIST, isTradingDayIST, isFullHolidayIST } from "@/lib/holidays";
import { EVENT_WARNING_MINUTE, getMarketOpenMinute } from "@/lib/marketTimes";

/** Sunday-night auto surface (IST). */
export const SUNDAY_BRIEF_MINUTE = 20 * 60; // 20:00 IST

/** Midday — start of 2nd cash/FO session focus window (IST). */
export const SECOND_SESSION_MINUTE = 12 * 60; // 12:00 IST

/** Carry brief surfaces from 2:00 PM IST on a session through next open. */
export const CARRY_SHOW_FROM_MINUTE = 14 * 60;

export { EVENT_WARNING_MINUTE };

const INDEX_IMPACT_TYPES = new Set(["Quarterly Results", "Board Meeting"]);

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayOfISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  // ~IST noon as UTC
  return new Date(Date.UTC(y, m - 1, d, 6, 30)).getUTCDay();
}

/**
 * Days until the next NSE trading open after "today", from weekday.
 * Extends through weekends AND holidays so Friday→Tue when Mon is holiday.
 */
export function carryWindowMaxDays(weekday /* 0=Sun … 5=Fri */, fromISO = todayIST()) {
  let days;
  if (weekday === 5) days = 3; // Fri → Mon
  else if (weekday === 0) days = 1; // Sun → Mon
  else if (weekday === 6) days = 2; // Sat → Mon
  else days = 1; // tonight → tomorrow

  // Walk forward while the candidate open day is weekend or holiday.
  for (let guard = 0; guard < 12; guard++) {
    const candidate = addDaysISO(fromISO, days);
    const wd = weekdayOfISO(candidate);
    if (wd === 0 || wd === 6 || isFullHolidayIST(candidate)) {
      days += 1;
      continue;
    }
    break;
  }
  return days;
}

/** Holidays inside the carry window (including "tomorrow is holiday"). */
export function carryWindowHolidays(weekday, fromISO = todayIST()) {
  const maxDays = carryWindowMaxDays(weekday, fromISO);
  return upcomingHolidays(fromISO)
    .filter((h) => h.session !== "muhurat")
    .map((h) => ({
      ...h,
      daysAway: daysBetweenIST(fromISO, h.date),
    }))
    .filter((h) => h.daysAway >= 0 && h.daysAway <= maxDays)
    .map((h) => ({
      date: h.date,
      name: `NSE Holiday — ${h.name}`,
      type: "holiday",
      country: "IN",
      impact: "critical",
      daysAway: h.daysAway,
      source: "holiday",
    }));
}

/**
 * Map /events/{index} payloads into carry-window index-impact lines.
 * @param {Array<{index: string, events: object[]}>} byIndex
 */
export function indexImpactCarryItems(byIndex = [], weekday, fromISO = todayIST()) {
  const maxDays = carryWindowMaxDays(weekday, fromISO);
  const out = [];
  for (const pack of byIndex) {
    const idx = pack.index || pack.idx;
    for (const e of pack.events || []) {
      const days = e.days_remaining;
      if (days == null || days < 0 || days > maxDays) continue;
      if (!INDEX_IMPACT_TYPES.has(e.event_type)) continue;
      const w = e.weightage != null ? Number(e.weightage) : null;
      const impact =
        w != null && w >= 3 ? "critical" : w != null && w >= 1 ? "high" : "medium";
      const name =
        `${idx} impact · ${e.symbol || e.company_name || "Constituent"} · ${e.event_type}` +
        (w != null ? ` (${w.toFixed(2)}%)` : "");
      out.push({
        date: e.date || addDaysISO(fromISO, days),
        name,
        type: "index-impact",
        country: "IN",
        impact,
        daysAway: days,
        source: "index-impact",
        index: idx,
        symbol: e.symbol,
        weightage: w,
        event_type: e.event_type,
      });
    }
  }
  // Heaviest weight first, then soonest
  out.sort((a, b) => {
    const dw = (b.weightage || 0) - (a.weightage || 0);
    if (dw) return dw;
    return a.daysAway - b.daysAway;
  });
  // Deduplicate by index+symbol+type+date
  const seen = new Set();
  return out.filter((e) => {
    const k = `${e.index}|${e.symbol}|${e.event_type}|${e.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Events + holidays the trader must respect before carrying overnight.
 * Mon–Thu → through next open (extends if holiday).
 * Friday → through Monday open (or later if Mon holiday).
 * Sunday → Monday open.
 * Optional `indexImpacts` from /events/{index} responses.
 */
export function carryWindowItems(weekday, { indexImpacts = [] } = {}) {
  const maxDays = carryWindowMaxDays(weekday);
  const econ = eventsWithinDays(maxDays).map((e) => ({ ...e, source: "econ" }));
  const holidays = carryWindowHolidays(weekday);
  const impacts = indexImpactCarryItems(indexImpacts, weekday);

  const merged = [...econ, ...holidays, ...impacts].sort((a, b) => {
    const dd = a.daysAway - b.daysAway;
    if (dd) return dd;
    return String(a.name).localeCompare(String(b.name));
  });
  const seen = new Set();
  return merged.filter((e) => {
    const k = `${e.date}|${e.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function dayLabel(daysAway, weekday) {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return weekday === 0 ? "Monday" : "Tomorrow";
  if (weekday === 5 && daysAway === 2) return "Sunday";
  if (weekday === 5 && daysAway === 3) return "Monday";
  return `In ${daysAway}d`;
}

export function carryHorizonLabel(weekday) {
  const maxDays = carryWindowMaxDays(weekday);
  const holidays = carryWindowHolidays(weekday);
  const nextHoliday = holidays.find((h) => h.daysAway >= 1) || holidays[0];
  if (weekday === 5) {
    if (nextHoliday && nextHoliday.daysAway >= 1) {
      return `through next open after weekend / ${nextHoliday.name.replace("NSE Holiday — ", "")}`;
    }
    return "through Monday open (weekend gap risk)";
  }
  if (weekday === 0) return "into Monday open (GIFT / weekend gap)";
  if (nextHoliday && nextHoliday.daysAway === 1) {
    return `tonight — tomorrow is NSE holiday (${nextHoliday.name.replace("NSE Holiday — ", "")}); next open after holiday`;
  }
  if (maxDays > 1) {
    return `for tonight through next open (in ${maxDays}d — holiday stretch)`;
  }
  return "for tonight / tomorrow";
}

/** Explicit holiday advice line for toast / card. */
export function holidayCarryAdvice(weekday) {
  const holidays = carryWindowHolidays(weekday);
  if (!holidays.length) return null;
  const tomorrowH = holidays.find((h) => h.daysAway === 1);
  if (tomorrowH) {
    return `Tomorrow is an NSE holiday (${tomorrowH.name.replace("NSE Holiday — ", "")}) — do not assume a normal open; size for the gap into the next trading session.`;
  }
  if (weekday === 5) {
    const monish = holidays.find((h) => h.daysAway >= 2 && h.daysAway <= 4);
    if (monish) {
      return `Holiday in the weekend window (${monish.name.replace("NSE Holiday — ", "")} · in ${monish.daysAway}d) — Friday carry faces an extended gap.`;
    }
  }
  const soon = holidays[0];
  return `${soon.name} in ${soon.daysAway}d — factor closed markets into overnight risk.`;
}

export function buildEventWarningCopy(weekday, { indexImpacts = [] } = {}) {
  const items = carryWindowItems(weekday, { indexImpacts });
  const horizon = carryHorizonLabel(weekday);
  const holidayNote = holidayCarryAdvice(weekday);
  const titlePrefix = weekday === 0 ? "Sunday night gap brief" : "Overnight carry check · 3:15 IST";
  const riskTitle = weekday === 0
    ? "⚠ Monday open risk · Sunday night"
    : "⚠ Event / index impact before close · 3:15 IST";

  const impactItems = items.filter((e) => e.source === "index-impact");
  const holidayItems = items.filter((e) => e.source === "holiday" || e.type === "holiday");
  const otherItems = items.filter((e) => e.source !== "index-impact" && e.type !== "holiday");

  if (!items.length) {
    return {
      title: titlePrefix,
      description: `No major scheduled events or index impacts ${horizon}. Still review delta / hedges before the open.`,
      lines: [],
      hasEvents: false,
      holidayNote: null,
    };
  }

  const lines = [];
  if (holidayNote) lines.push(holidayNote);
  for (const e of [...holidayItems, ...impactItems, ...otherItems].slice(0, 10)) {
    if (e === holidayItems[0] && holidayNote) continue; // already covered
    const when = dayLabel(e.daysAway, weekday);
    const impact = (e.impact || "").toUpperCase();
    const tag = e.source === "index-impact" ? "INDEX" : impact;
    lines.push(`${when} · ${e.name}${tag ? ` [${tag}]` : ""}`);
  }

  return {
    title: riskTitle,
    description:
      `Upcoming risk ${horizon}. Hedge or close positions you are not comfortable carrying.\n\n` +
      lines.join("\n"),
    lines,
    hasEvents: true,
    holidayNote,
    impactCount: impactItems.length,
    holidayCount: holidayItems.length,
  };
}

/** Session OI bias from current + session-open previous snapshots. */
export function sessionBiasFromSnapshots(current, sessionPrevious) {
  if (!current?.strikes?.length || !sessionPrevious?.strikes?.length) return null;
  const prevMap = new Map();
  sessionPrevious.strikes.forEach((s) => prevMap.set(s.strike, s));
  let ce = 0;
  let pe = 0;
  for (const s of current.strikes) {
    const p = prevMap.get(s.strike);
    if (!p) continue;
    ce += (s.ce_oi || 0) - (p.ce_oi || 0);
    pe += (s.pe_oi || 0) - (p.pe_oi || 0);
  }
  const total = Math.abs(ce) + Math.abs(pe) || 1;
  const net = pe - ce;
  const intensity = Math.min(1, Math.abs(net) / total);
  return {
    ce,
    pe,
    net,
    intensity,
    bullish: net >= 0,
    label: net >= 0 ? "Bullish" : "Bearish",
    pct: Math.round(intensity * 100),
  };
}

/**
 * Compact carry verdict from per-index bias + events + GIFT move.
 * Not a trade recommendation — a packaging of signals for "should I carry?".
 */
export function carryVerdict({ biases = [], events = [], giftPct = null, weekday, vix = null }) {
  const criticalEvents = events.filter((e) => e.impact === "critical" || e.type === "holiday");
  const highEvents = events.filter((e) => e.impact === "high");
  const indexImpacts = events.filter((e) => e.source === "index-impact");
  const giftAbs = giftPct != null && Number.isFinite(Number(giftPct)) ? Math.abs(Number(giftPct)) : null;
  const vixN = vix != null && Number.isFinite(Number(vix)) ? Number(vix) : null;

  let score = 0; // higher = more caution
  const notes = [];

  if (criticalEvents.length) {
    score += 40;
    notes.push(`${criticalEvents.length} critical event/holiday in carry window`);
  } else if (highEvents.length) {
    score += 20;
    notes.push(`${highEvents.length} high-impact print ahead`);
  }

  if (indexImpacts.length) {
    score += Math.min(25, 8 + indexImpacts.length * 4);
    const heavy = indexImpacts.filter((e) => (e.weightage || 0) >= 3);
    notes.push(
      heavy.length
        ? `${heavy.length} heavy index-impact result(s) in window`
        : `${indexImpacts.length} index-impact event(s) in window`,
    );
  }

  if (giftAbs != null) {
    if (giftAbs >= 0.8) {
      score += 25;
      notes.push(`GIFT moving ${giftPct >= 0 ? "+" : ""}${Number(giftPct).toFixed(2)}% overnight`);
    } else if (giftAbs >= 0.35) {
      score += 12;
      notes.push(`GIFT ${giftPct >= 0 ? "+" : ""}${Number(giftPct).toFixed(2)}% — watch open gap`);
    }
  }

  const bearish = biases.filter((b) => b && !b.bullish && b.pct >= 25).length;
  const bullish = biases.filter((b) => b && b.bullish && b.pct >= 25).length;
  if (bearish && bullish) {
    score += 10;
    notes.push("Mixed day bias across indices");
  } else if (bearish >= 2) {
    score += 15;
    notes.push("Bearish day bias on multiple indices");
  } else if (bullish >= 2) {
    score += 5;
    notes.push("Bullish day bias — still size for gap");
  }

  if (weekday === 5 || weekday === 0) {
    score += 10;
    notes.push(weekday === 5 ? "Friday → weekend gap on short premium" : "Sunday → Monday open gap");
  }

  if (vixN != null) {
    if (vixN >= 18) {
      score += 18;
      notes.push(`India VIX ${vixN.toFixed(1)} — overnight gap typically wider`);
    } else if (vixN >= 15) {
      score += 8;
      notes.push(`India VIX ${vixN.toFixed(1)}`);
    }
  }

  const holidayAdv = holidayCarryAdvice(weekday);
  if (holidayAdv) {
    score += 15;
    notes.push("Holiday in carry window");
  }

  score = Math.min(100, score);
  let band = "CARRY_OK";
  let advice = "Session OI and calendar look carry-able if shorts stay hedged and not too close to spot.";
  if (score >= 55) {
    band = "DO_NOT_CARRY";
    advice = "Do not hold unhedged short premium through the gap. Cut or make it defined-risk before the next open.";
  } else if (score >= 30) {
    band = "REDUCE";
    advice = "Carry only the shorts that session OI still supports. Hedge or reduce the index working against you.";
  }
  if (holidayAdv && band === "CARRY_OK") {
    band = "REDUCE";
    advice = holidayAdv;
  } else if (holidayAdv && band !== "CARRY_OK") {
    advice = `${advice} ${holidayAdv}`;
  }

  return { score, band, advice, notes, holidayAdvice: holidayAdv };
}

/**
 * Carry brief: from 14:00 IST on a trading day, overnight, weekends/holidays,
 * until the next cash/F&O open. Hidden during a live session before 14:00.
 */
export function shouldAutoShowBrief(weekday, minutesOfDay, dateISO = todayIST()) {
  const openMinute = getMarketOpenMinute();
  if (isTradingDayIST(dateISO)) {
    if (minutesOfDay >= CARRY_SHOW_FROM_MINUTE) return true;
    if (minutesOfDay < openMinute) return true;
    return false;
  }
  return true;
}

export function briefTriggerKey(istDateISO, weekday, minutesOfDay) {
  if (!shouldAutoShowBrief(weekday, minutesOfDay, istDateISO)) return null;
  return `carry|${istDateISO}`;
}

export function dismissStorageKey(triggerKey) {
  return `oi_overnight_brief_dismissed_${triggerKey}`;
}

/** localStorage key for “minimized until next session open”. */
export function minimizeStorageKey(triggerKey) {
  return `oi_overnight_brief_minimized_${triggerKey}`;
}

/**
 * Next cash/F&O session open as epoch ms (admin market_open_ist on the next
 * trading day). Used so a minimized overnight brief can reopen until then,
 * then auto-clear.
 */
export function nextSessionOpenMs(fromDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(fromDate);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  let y = get("year");
  let m = get("month");
  let d = get("day");
  const nowM = get("hour") * 60 + get("minute");
  const openMinute = getMarketOpenMinute();
  const openH = Math.floor(openMinute / 60);
  const openMin = openMinute % 60;
  // IST → UTC: subtract 5h30m
  let utcH = openH - 5;
  let utcM = openMin - 30;
  if (utcM < 0) { utcM += 60; utcH -= 1; }

  for (let i = 0; i < 12; i++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const openUtc = Date.UTC(y, m - 1, d, utcH, utcM, 0);
    if (isTradingDayIST(iso)) {
      if (i > 0 || nowM < openMinute) {
        return openUtc;
      }
    }
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return Date.now() + 24 * 60 * 60 * 1000;
}

export function readBriefMinimize(triggerKey) {
  if (!triggerKey) return null;
  try {
    const raw = localStorage.getItem(minimizeStorageKey(triggerKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const until = Number(parsed?.until);
    if (!Number.isFinite(until)) return null;
    if (Date.now() >= until) {
      localStorage.removeItem(minimizeStorageKey(triggerKey));
      return null;
    }
    return { until };
  } catch {
    return null;
  }
}

export function writeBriefMinimize(triggerKey, untilMs) {
  if (!triggerKey) return;
  try {
    localStorage.setItem(
      minimizeStorageKey(triggerKey),
      JSON.stringify({ until: untilMs }),
    );
  } catch (_) { /* ignore */ }
}

export function clearBriefMinimize(triggerKey) {
  if (!triggerKey) return;
  try {
    localStorage.removeItem(minimizeStorageKey(triggerKey));
  } catch (_) { /* ignore */ }
}
