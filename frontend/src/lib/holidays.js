// NSE trading holidays (equity + derivatives) for 2025 & 2026.
// Source: NSE Trading Holidays 2025 & 2026 official circulars.
// If NSE releases a revised list, update `HOLIDAYS_RAW` below.
// Format: { date: 'YYYY-MM-DD', name: 'Holiday name' }

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
  { date: "2025-10-21", name: "Diwali Laxmi Pujan* (Muhurat trading only)" },
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
  { date: "2026-11-08", name: "Diwali Laxmi Pujan* (Muhurat trading only)" },
  { date: "2026-11-10", name: "Balipratipada" },
  { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev" },
  { date: "2026-12-25", name: "Christmas" },
];

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
  return HOLIDAYS_RAW
    .filter((h) => h.date >= fromISO)
    .filter((h) => {
      const wd = weekdayIST(h.date);
      return wd !== 0 && wd !== 6; // skip weekends
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function allHolidays() {
  return HOLIDAYS_RAW.slice().sort((a, b) => a.date.localeCompare(b.date));
}

export function isHoliday(iso) {
  return HOLIDAYS_RAW.find((h) => h.date === iso) || null;
}

/** True for weekday IST dates that are not on the NSE holiday list. */
export function isTradingDayIST(iso = toIST(new Date())) {
  const wd = weekdayIST(iso);
  if (wd === 0 || wd === 6) return false;
  return !isHoliday(iso);
}

export function todayIST() {
  return toIST(new Date());
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
