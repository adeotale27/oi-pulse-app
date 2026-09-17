import { isMarketQuiescent } from "./marketTimes.js";
import { isFullHolidayIST, isTradingDayIST, todayIST } from "./holidays.js";

function istYmd(now) {
  if (!now) return todayIST();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Live ATM straddle refresh (countdown + poll) only during the cash/F&O session
 * for the chart's selected IST trade date. Historical views stay frozen.
 */
export function straddleLiveRefreshActive(now = new Date(), tradeDate = null) {
  const iso = istYmd(now instanceof Date ? now : new Date(now));
  if (tradeDate && String(tradeDate).slice(0, 10) !== iso) return false;
  if (!isTradingDayIST(iso)) return false;
  if (isFullHolidayIST(iso)) return false;
  return !isMarketQuiescent(now instanceof Date ? now : new Date(now));
}

export function straddleRefreshLabel(live, ageSeconds, pollMs) {
  if (!live) return null;
  const pollS = Math.max(1, Math.round(Number(pollMs) / 1000) || 15);
  const age = Math.max(0, Math.round(Number(ageSeconds) || 0));
  const rem = pollS - (age % pollS);
  const left = rem === 0 ? pollS : rem;
  return `next (${left}s)`;
}
