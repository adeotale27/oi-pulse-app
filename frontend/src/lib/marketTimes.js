// Centralized market timing — defaults match Admin Settings (Index F&O).
// Call configureMarketHours(openIst, closeIst) whenever /status or /settings loads
// so the whole app follows admin-configured open/close (never hard-locked).

function parseHmToMinutes(hm, fallback) {
  try {
    const [h, m] = String(hm || "").split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return h * 60 + m;
    }
  } catch (_) { /* noop */ }
  return fallback;
}

function minutesToHm(mins) {
  const hh = Math.floor(((mins % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const mm = ((mins % (24 * 60)) + 24 * 60) % (24 * 60) % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}`;
}

let _openMinute = 9 * 60 + 15;   // 09:15 IST
let _closeMinute = 15 * 60 + 40; // 15:40 IST

/** Apply admin market_open_ist / market_close_ist (HH:MM). */
export function configureMarketHours(openIst, closeIst) {
  if (openIst) _openMinute = parseHmToMinutes(openIst, _openMinute);
  if (closeIst) _closeMinute = parseHmToMinutes(closeIst, _closeMinute);
  // Keep reminder / weekend markers aligned to configured close.
  FNO_CLOSE_MINUTE = _closeMinute;
  WEEKEND_START_MINUTE = _closeMinute;
  MARKET_CLOSE_TOAST_MINUTE = _closeMinute + 1;
  EVENT_WARNING_MINUTE = Math.max(_openMinute, _closeMinute - 25);
  REMINDER_MINUTES.splice(
    0,
    REMINDER_MINUTES.length,
    Math.max(_openMinute, _closeMinute - 30),
    Math.max(_openMinute, _closeMinute - 15),
    Math.max(_openMinute, _closeMinute - 5),
  );
  // Keep GIFT day session end in sync with cash/F&O close when admin changes it.
  if (GIFT_SESSION_WINDOWS?.[0]) {
    GIFT_SESSION_WINDOWS[0] = {
      ...GIFT_SESSION_WINDOWS[0],
      end_ist: minutesToHm(_closeMinute),
    };
  }
}

export function getMarketOpenMinute() {
  return _openMinute;
}

export function getMarketCloseMinute() {
  return _closeMinute;
}

export function getMarketOpenHm() {
  return minutesToHm(_openMinute);
}

export function getMarketCloseHm() {
  return minutesToHm(_closeMinute);
}

/** Apply from a /status (or settings) payload. */
export function applyMarketHoursFromStatus(statusOrSettings) {
  if (!statusOrSettings) return;
  const open =
    statusOrSettings.market?.display_open_ist
    || statusOrSettings.display_open_ist
    || statusOrSettings.market_open_ist;
  const close =
    statusOrSettings.market?.display_close_ist
    || statusOrSettings.display_close_ist
    || statusOrSettings.market_close_ist;
  if (open || close) configureMarketHours(open, close);
}

// Mutable exports (updated by configureMarketHours).
export let FNO_CLOSE_MINUTE = _closeMinute;
export let WEEKEND_START_MINUTE = _closeMinute;
export let REMINDER_MINUTES = [
  _closeMinute - 30,
  _closeMinute - 15,
  _closeMinute - 5,
];
export let MARKET_CLOSE_TOAST_MINUTE = _closeMinute + 1;
export let EVENT_WARNING_MINUTE = _closeMinute - 25;

export const GIFT_SESSION_WINDOWS = [
  { start_ist: "06:30", end_ist: "15:40" },
  { start_ist: "16:35", end_ist: "02:45" },
];

export function hmFromMinutes(mins) {
  return minutesToHm(mins);
}

export function istMinutesOfDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return Number(get("hour") || 0) * 60 + Number(get("minute") || 0);
}

/** One extra Positions pull after Index F&O close (default 15:40 → 15:45). */
export function getPositionsCatchupMinute() {
  return _closeMinute + 5;
}

/** Auto-refresh Positions until the 15:45 catch-up, then stop. */
export function isPositionsAutoRefreshOn(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const w = parts.find((p) => p.type === "weekday")?.value;
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wk = map[w] ?? new Date(now).getUTCDay();
  if (wk === 0 || wk === 6) return false;
  const mins = istMinutesOfDay(now);
  if (mins < _openMinute) return false;
  return mins < getPositionsCatchupMinute();
}

// Returns true if the market is quiescent (no live polling needed) due to
// weekend OR a server-declared holiday/market-closed flag. The function accepts
// either a Date-like value (uses local IST weekend calculation) OR a server
// status object (as returned by /api/status) which may include `market.is_market_open`
// and an optional `holidays` array of ISO dates.
/** True only when the server says NSE cash/F&O is printing. Missing status ≠ live. */
export function nseCashSessionLive(status) {
  return status?.market?.is_market_open === true;
}

export function isMarketQuiescent(maybeStatusOrDate = undefined) {
  // Prefer live hours from status when present.
  if (maybeStatusOrDate && typeof maybeStatusOrDate === "object" && !(maybeStatusOrDate instanceof Date) && (maybeStatusOrDate.market || maybeStatusOrDate.holidays)) {
    applyMarketHoursFromStatus(maybeStatusOrDate);
    const status = maybeStatusOrDate;
    if (status.market && status.market.is_market_open === true) return false;
    if (status.market && status.market.is_market_open === false) return true;
    if (Array.isArray(status.holidays) && status.holidays.length) {
      try {
        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
        const y = parts.find(p => p.type === "year")?.value;
        const m = parts.find(p => p.type === "month")?.value;
        const d = parts.find(p => p.type === "day")?.value;
        const today = `${y}-${m}-${d}`;
        if (status.holidays.includes(today)) return true;
      } catch (_) { /* ignore */ }
    }
  }

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
  // Weekend begins on Friday at configured close, or any Sat/Sun
  if ((wk === 5 && minutesOfDay >= WEEKEND_START_MINUTE) || wk === 6 || wk === 0) return true;
  // Weekday after hours / pre-open: do not keep live OI polling (missing /status ≠ session open).
  if (minutesOfDay < _openMinute || minutesOfDay >= _closeMinute) return true;
  return false;
}
