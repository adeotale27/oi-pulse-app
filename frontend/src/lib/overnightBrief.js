// Overnight gap brief — "should I carry?" decision helpers.
// Shared by BigClock (15:15 toast) and OvernightGapBrief sticky card.

import { eventsWithinDays } from "@/lib/econCalendar";
import { upcomingHolidays, todayIST } from "@/lib/holidays";
import { EVENT_WARNING_MINUTE } from "@/lib/marketTimes";

/** Sunday-night auto surface (IST). */
export const SUNDAY_BRIEF_MINUTE = 20 * 60; // 20:00 IST

export { EVENT_WARNING_MINUTE };

/**
 * Events + holidays the trader must respect before carrying overnight.
 * Mon–Thu → today + tomorrow.
 * Friday → today through Monday (weekend + Mon open).
 * Sunday → today + Monday open.
 */
export function carryWindowMaxDays(weekday /* 0=Sun … 5=Fri */) {
  if (weekday === 5) return 3; // Fri → Mon
  if (weekday === 0) return 1; // Sun → Mon
  return 1;
}

export function carryWindowItems(weekday) {
  const maxDays = carryWindowMaxDays(weekday);
  const econ = eventsWithinDays(maxDays);
  const today = todayIST();
  const holidays = upcomingHolidays(today)
    .filter((h) => {
      const [y, mo, d] = today.split("-").map(Number);
      const start = Date.UTC(y, mo - 1, d);
      const [hy, hm, hd] = h.date.split("-").map(Number);
      const end = Date.UTC(hy, hm - 1, hd);
      const days = Math.round((end - start) / 86400000);
      return days >= 0 && days <= maxDays;
    })
    .map((h) => {
      const [y, mo, d] = today.split("-").map(Number);
      const start = Date.UTC(y, mo - 1, d);
      const [hy, hm, hd] = h.date.split("-").map(Number);
      const daysAway = Math.round((Date.UTC(hy, hm - 1, hd) - start) / 86400000);
      return {
        date: h.date,
        name: `NSE Holiday — ${h.name}`,
        type: "holiday",
        country: "IN",
        impact: "critical",
        daysAway,
      };
    });

  const merged = [...econ, ...holidays].sort((a, b) => a.date.localeCompare(b.date));
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
  if (weekday === 5) return "through Monday open (weekend gap risk)";
  if (weekday === 0) return "into Monday open (GIFT / weekend gap)";
  return "for tonight / tomorrow";
}

export function buildEventWarningCopy(weekday) {
  const items = carryWindowItems(weekday);
  const horizon = carryHorizonLabel(weekday);
  const titlePrefix = weekday === 0 ? "Sunday night gap brief" : "Overnight carry check · 3:15 IST";
  const riskTitle = weekday === 0
    ? "⚠ Monday open risk · Sunday night"
    : "⚠ Event risk before close · 3:15 IST";

  if (!items.length) {
    return {
      title: titlePrefix,
      description: `No major scheduled events ${horizon}. Still review delta / hedges before the open.`,
      lines: [],
      hasEvents: false,
    };
  }

  const lines = items.slice(0, 8).map((e) => {
    const when = dayLabel(e.daysAway, weekday);
    const impact = (e.impact || "").toUpperCase();
    return `${when} · ${e.name}${impact ? ` [${impact}]` : ""}`;
  });

  return {
    title: riskTitle,
    description:
      `Upcoming events ${horizon}. Hedge or close positions you are not comfortable carrying.\n\n` +
      lines.join("\n"),
    lines,
    hasEvents: true,
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
export function carryVerdict({ biases = [], events = [], giftPct = null, weekday }) {
  const criticalEvents = events.filter((e) => e.impact === "critical" || e.type === "holiday");
  const highEvents = events.filter((e) => e.impact === "high");
  const giftAbs = giftPct != null && Number.isFinite(Number(giftPct)) ? Math.abs(Number(giftPct)) : null;

  let score = 0; // higher = more caution
  const notes = [];

  if (criticalEvents.length) {
    score += 40;
    notes.push(`${criticalEvents.length} critical event/holiday in carry window`);
  } else if (highEvents.length) {
    score += 20;
    notes.push(`${highEvents.length} high-impact print ahead`);
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
    notes.push(weekday === 5 ? "Friday → weekend gap" : "Sunday → Monday open");
  }

  score = Math.min(100, score);
  let band = "CARRY_OK";
  let advice = "Bias + calendar look manageable — carry only if delta is hedged.";
  if (score >= 55) {
    band = "DO_NOT_CARRY";
    advice = "Skewed risk into the open — cut or hedge what you won't own through the gap.";
  } else if (score >= 30) {
    band = "REDUCE";
    advice = "Carry with reduced size / hard stop. Events or GIFT already argue for caution.";
  }

  return { score, band, advice, notes };
}

/**
 * When should the sticky overnight brief auto-appear?
 * - Weekdays from 15:15 IST onward (until next calendar day)
 * - Sunday from 20:00 IST onward
 */
export function shouldAutoShowBrief(weekday, minutesOfDay) {
  if (weekday >= 1 && weekday <= 5 && minutesOfDay >= EVENT_WARNING_MINUTE) return true;
  if (weekday === 0 && minutesOfDay >= SUNDAY_BRIEF_MINUTE) return true;
  return false;
}

export function briefTriggerKey(istDateISO, weekday, minutesOfDay) {
  if (weekday === 0 && minutesOfDay >= SUNDAY_BRIEF_MINUTE) {
    return `${istDateISO}|sunday-night`;
  }
  if (weekday >= 1 && weekday <= 5 && minutesOfDay >= EVENT_WARNING_MINUTE) {
    return `${istDateISO}|eod-315`;
  }
  return null;
}

export function dismissStorageKey(triggerKey) {
  return `oi_overnight_brief_dismissed_${triggerKey}`;
}
