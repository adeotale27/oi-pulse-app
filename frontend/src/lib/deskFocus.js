/**
 * Cash-session Desk AI focus: weekly option calendar, not “whatever tab is open”.
 * Mon/Tue (+ Fri into the Nifty weekly) → NIFTY. Wed/Thu → SENSEX.
 * Heavyweight cash tape stays NIFTY + BANKNIFTY (Sensex names are a duplicate weight list).
 */

export const CASH_HEAVY_INDICES = ["NIFTY", "BANKNIFTY"];

/** `weekday`: JS/IST Sunday=0 … Saturday=6 */
export function cashSessionFocusIndex(weekday) {
  const d = Number(weekday);
  if (d === 3 || d === 4) return "SENSEX";
  return "NIFTY";
}

export function cashSessionFocusLabel(weekday) {
  const idx = cashSessionFocusIndex(weekday);
  if (idx === "SENSEX") return "Wed–Thu · SENSEX";
  const d = Number(weekday);
  if (d === 5) return "Friday · NIFTY";
  return "Mon–Tue · NIFTY";
}

export function isCashHeavyIndex(id) {
  const u = String(id || "").toUpperCase().replace(/\s+/g, "");
  if (u === "BANKNIFTY" || u.includes("BANKNIFTY") || u === "NIFTYBANK") return true;
  return u === "NIFTY" || u === "NIFTY50";
}

export function istWeekdaySun0(date = new Date()) {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(date);
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? date.getDay();
  } catch {
    return date.getDay();
  }
}

export function filterCashHeavyMovers(movers = []) {
  return (movers || []).filter((m) => isCashHeavyIndex(m?.index));
}

/** Overnight OI rows: day’s focus first, then Bank Nifty, then the other cash index. */
export function overnightBiasIndices(weekday, activeIndex) {
  const focus = cashSessionFocusIndex(weekday);
  const out = [];
  const add = (id) => {
    const u = String(id || "").toUpperCase();
    if (!u || out.includes(u)) return;
    if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(u)) return;
    out.push(u);
  };
  add(focus);
  add("BANKNIFTY");
  add("NIFTY");
  add("SENSEX");
  add(activeIndex);
  return out;
}
