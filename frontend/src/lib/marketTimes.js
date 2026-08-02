// Centralized market timing constants and helpers (minutes since midnight IST)
export const FNO_CLOSE_MINUTE = 15 * 60 + 40; // 15:40 IST - F&O market close
export const WEEKEND_START_MINUTE = 15 * 60 + 31; // 15:31 IST - weekend begins

// Reminder times shifted +10 minutes from prior 15:00 / 15:15 / 15:25 -> 15:10 / 15:25 / 15:35
export const REMINDER_MINUTES = [15 * 60 + 10, 15 * 60 + 25, 15 * 60 + 35];

export const MARKET_CLOSE_TOAST_MINUTE = FNO_CLOSE_MINUTE + 1; // 15:41 - show close toast

export const GIFT_SESSION_WINDOWS = [
  { start_ist: "06:30", end_ist: "15:40" },
  { start_ist: "16:35", end_ist: "02:45" },
];

export function hmFromMinutes(mins) {
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}`;
}

// Returns true if the market is quiescent (no live polling needed) due to
// weekend OR a server-declared holiday/market-closed flag. The function accepts
// either a Date-like value (uses local IST weekend calculation) OR a server
// status object (as returned by /api/status) which may include `market.is_market_open`
// and an optional `holidays` array of ISO dates.
export function isMarketQuiescent(maybeStatusOrDate = undefined) {
  // If caller provided a status object from server, respect it (server knows holidays)
  if (maybeStatusOrDate && typeof maybeStatusOrDate === "object" && (maybeStatusOrDate.market || maybeStatusOrDate.holidays)) {
    const status = maybeStatusOrDate;
    // If server explicitly says market is closed, treat as quiescent
    if (status.market && status.market.is_market_open === false) return true;
    // If server provides holidays array, compare today's IST date string
    if (Array.isArray(status.holidays) && status.holidays.length) {
      try {
        // Compute today's IST date in YYYY-MM-DD
        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
        const y = parts.find(p => p.type === "year")?.value;
        const m = parts.find(p => p.type === "month")?.value;
        const d = parts.find(p => p.type === "day")?.value;
        const today = `${y}-${m}-${d}`;
        if (status.holidays.includes(today)) return true;
      } catch (_) { /* ignore */ }
    }
    // Otherwise fallthrough to local weekend test below
  }

  // If input is a Date, compute IST-based weekend rules for that datetime
  const dt = (maybeStatusOrDate instanceof Date) ? maybeStatusOrDate : new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(dt);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get("hour") || 0);
  const minute = Number(get("minute") || 0);
  const weekdayPart = parts.find((p) => p.type === "weekday");
  const wk = (weekdayPart && weekdayPart.value) ? (function (w) {
    const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    return map[w] ?? 0;
  })(weekdayPart.value) : new Date(dt).getUTCDay();
  const minutesOfDay = hour * 60 + minute;
  // Weekend begins on Friday at WEEKEND_START_MINUTE (15:31 IST), or any Sat/Sun
  return (wk === 5 && minutesOfDay >= WEEKEND_START_MINUTE) || wk === 6 || wk === 0;
}
