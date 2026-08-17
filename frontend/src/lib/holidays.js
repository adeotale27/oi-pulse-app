// NSE trading holidays (equity + derivatives).
// Built-in 2025–2026 circulars below. Admin Upload → NSE holiday circular
// overlays those years at runtime (GET /api/holidays).
// Format: { date: 'YYYY-MM-DD', name: 'Holiday name', session?, open?, close? }

import { getMarketOpenMinute } from "./marketTimes";

const HOLIDAYS_RAW = [
  // ---------- 2025 ----------
  { date: "2025-02-26", name: "Mahashivratri" },
  { date: "2025-03-14", name: "Holi" },
  { date: "2025-03-31", name: "Id-Ul-Fitr (Ramzan Id)" },
  { date: "2025-04-10", name: "Shri Mahavir Jayanti" },
  { date: "2025-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2025-04-18", name: "Good Friday" },
  { date: "2025-05-01", name: "Maharashtra Day" },
  { date: "2025-08-15", name: "Independence Day" },
  { date: "2025-08-27", name: "Ganesh Chaturthi" },
  { date: "2025-10-02", name: "Mahatma Gandhi Jayanti / Dussehra" },
  { date: "2025-10-21", name: "Diwali Laxmi Pujan* (Muhurat trading)", session: "muhurat", open: "13:30", close: "14:45" },
  { date: "2025-10-22", name: "Balipratipada" },
  { date: "2025-11-05", name: "Prakash Gurpurb Sri Guru Nanak Dev" },
  { date: "2025-12-25", name: "Christmas" },

  // ---------- 2026 (Official NSE circular CMTR71775, Dec 2025) ----------
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-03-26", name: "Shri Ram Navami" },
  { date: "2026-03-31", name: "Shri Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-28", name: "Bakri Id (Eid ul-Adha)" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-08", name: "Diwali Laxmi Pujan* (Muhurat trading)", session: "muhurat", open: "13:30", close: "19:15" },
  { date: "2026-11-10", name: "Balipratipada" },
  { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev" },
  { date: "2026-12-25", name: "Christmas" },
];

/** Live calendar: built-in circulars, with uploaded years merged on top. */
let HOLIDAYS = HOLIDAYS_RAW.slice();
const _holidayListeners = new Set();

function _normHoliday(row) {
  const date = String(row?.date || "").slice(0, 10);
  const name = String(row?.name || "Holiday");
  const session = String(row?.session || "").toLowerCase() === "muhurat" ? "muhurat" : undefined;
  const open = row?.open ? String(row.open) : undefined;
  const close = row?.close ? String(row.close) : undefined;
  return session ? { date, name, session, open, close } : { date, name };
}

/**
 * Merge uploaded rows over built-in dates. Years present in the file replace
 * that year’s built-in list; other years stay.
 */
export function applyUploadedHolidays(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    HOLIDAYS = HOLIDAYS_RAW.slice();
  } else {
    const uploaded = rows.map(_normHoliday).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
    const years = new Set(uploaded.map((h) => h.date.slice(0, 4)));
    const kept = HOLIDAYS_RAW.filter((h) => !years.has(h.date.slice(0, 4)));
    HOLIDAYS = kept.concat(uploaded).sort((a, b) => a.date.localeCompare(b.date));
  }
  _holidayListeners.forEach((fn) => {
    try { fn(); } catch { /* noop */ }
  });
}

export function subscribeHolidays(fn) {
  _holidayListeners.add(fn);
  return () => _holidayListeners.delete(fn);
}

function toIST(d) {
  // Return YYYY-MM-DD as it would be in Asia/Kolkata.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const dd = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${dd}`;
}

function weekdayIST(iso) {
  // 0=Sun ... 6=Sat, based on IST midnight for the date.
  const [y, m, d] = iso.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 6, 30)); // ~IST noon
  return utcNoon.getUTCDay();
}

// Filter out Sat/Sun-only entries (they aren't NSE holidays since market is
// already closed) and any dates in the past.
export function upcomingHolidays(fromISO = toIST(new Date())) {
  return HOLIDAYS
    .filter((h) => h.date >= fromISO)
    .filter((h) => {
      const wd = weekdayIST(h.date);
      return wd !== 0 && wd !== 6; // skip weekends
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function allHolidays() {
  return HOLIDAYS.slice().sort((a, b) => a.date.localeCompare(b.date));
}

export function isHoliday(iso) {
  return HOLIDAYS.find((h) => h.date === iso) || null;
}

/** Safe calendar label. `holidayObj && !special` is boolean `true` in JS — never call `.replace` on that. */
export function holidayShortName(h, fallback = "Holiday") {
  const name = typeof h === "object" && h ? h.name : "";
  const s = String(name || fallback);
  return s.replace(/\s*\(.*$/, "");
}

/** Tight calendar cell — never the word "Holi" (that is a March festival). */
export function holidayCellLabel(h, { muhurat = false } = {}) {
  if (muhurat || (typeof h === "object" && h && h.session === "muhurat")) return "Muh.";
  const full = holidayShortName(h, "Closed");
  const first = full.split(/[/,]/)[0].trim();
  if (first.length <= 14) return first;
  return `${first.slice(0, 10)}…`;
}

/** True for weekday IST dates with a cash/F&O session, including Muhurat. */
export function isTradingDayIST(iso = toIST(new Date())) {
  const wd = weekdayIST(iso);
  if (wd === 0 || wd === 6) return false;
  if (isSpecialSessionIST(iso)) return true;
  return !isHoliday(iso);
}

/** Diwali Laxmi Pujan muhurat (and any holiday row with session: "muhurat"). */
export function isSpecialSessionIST(iso = toIST(new Date())) {
  const hol = isHoliday(iso);
  return Boolean(hol && hol.session === "muhurat");
}

export function isFullHolidayIST(iso = toIST(new Date())) {
  return Boolean(isHoliday(iso) && !isSpecialSessionIST(iso));
}

/** Same calendar as charts: weekdays with a session, including Muhurat. */
export function isJournalSessionDayIST(iso = toIST(new Date())) {
  return isTradingDayIST(iso);
}

function hmToMinute(hm, fallback) {
  const [h, m] = String(hm || "").split(":").map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return fallback;
}

export function specialSessionOpenMinute(iso = toIST(new Date())) {
  const hol = isHoliday(iso);
  if (!hol || hol.session !== "muhurat") return null;
  return hmToMinute(hol.open, 13 * 60 + 30);
}

export function specialSessionCatchupMinute(iso = toIST(new Date())) {
  const hol = isHoliday(iso);
  if (!hol || hol.session !== "muhurat") return null;
  return hmToMinute(hol.close, 14 * 60 + 45) + 5;
}

export const SPECIAL_SESSION_OPEN_MINUTE = 13 * 60 + 30;
export const SPECIAL_SESSION_CATCHUP_MINUTE = 14 * 60 + 50;

export function todayIST() {
  return toIST(new Date());
}

/**
 * Most recent NSE trading day strictly before `iso` (YYYY-MM-DD, IST).
 * Walks back up to 15 calendar days past weekends/holidays.
 */
export function previousTradingDayIST(iso = todayIST()) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  let probe = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 15; i++) {
    probe = new Date(probe.getTime() - 24 * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    const candidate = `${probe.getUTCFullYear()}-${pad(probe.getUTCMonth() + 1)}-${pad(probe.getUTCDate())}`;
    if (isTradingDayIST(candidate)) return candidate;
  }
  return iso;
}

/**
 * Trading date whose straddle/OI session should be shown right now (IST).
 * • Open / post-close on a trading day → that day
 * • Pre-open / weekend / holiday → previous trading day
 *
 * @param {Date} [now]
 * @param {number} [openMinute] minutes since midnight IST (defaults to admin market_open_ist)
 */
export function sessionAnchorDateIST(now = new Date(), openMinute = getMarketOpenMinute()) {
  const today = toIST(now);
  if (!isTradingDayIST(today)) return previousTradingDayIST(today);
  const specialOpen = specialSessionOpenMinute(today);
  const open = specialOpen != null ? specialOpen : openMinute;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  if (hour * 60 + minute < open) return previousTradingDayIST(today);
  return today;
}

export function tomorrowIST() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return toIST(d);
}

export function daysBetweenIST(fromISO, toISO) {
  const [ay, am, ad] = fromISO.split("-").map(Number);
  const [by, bm, bd] = toISO.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function formatDatePretty(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 6, 30));
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Convenience: get the next holiday (upcoming, weekday) with alert status.
//   status = 'today' | 'tomorrow' | 'this-week' | 'upcoming'
export function nextHolidayInfo() {
  const today = todayIST();
  const upcoming = upcomingHolidays(today);
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  let status = "upcoming";
  const diff = daysBetweenIST(today, next.date);
  if (diff === 0) status = "today";
  else if (diff === 1) status = "tomorrow";
  else if (diff <= 6) status = "this-week";
  return { ...next, status, daysAway: diff, today };
}
