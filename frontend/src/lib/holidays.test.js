import assert from "node:assert/strict";

function weekdayIST(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 6, 30));
  return utcNoon.getUTCDay();
}

const HOLIDAYS = {
  "2026-01-26": { name: "Republic Day" },
  "2026-11-08": { name: "Diwali Laxmi Pujan", session: "muhurat" },
  "2026-11-10": { name: "Balipratipada" },
  "2025-10-21": { name: "Diwali Laxmi Pujan", session: "muhurat" },
};

function isHoliday(iso) {
  return HOLIDAYS[iso] || null;
}
function isSpecialSessionIST(iso) {
  const hol = isHoliday(iso);
  return Boolean(hol && hol.session === "muhurat");
}
function isTradingDayIST(iso) {
  const wd = weekdayIST(iso);
  if (wd === 0 || wd === 6) return false;
  if (isSpecialSessionIST(iso)) return true;
  return !isHoliday(iso);
}
function isJournalSessionDayIST(iso) {
  return isTradingDayIST(iso);
}

assert.equal(isTradingDayIST("2026-08-14"), true);
assert.equal(isJournalSessionDayIST("2026-08-14"), true);
assert.equal(isJournalSessionDayIST("2026-08-15"), false);
assert.equal(isJournalSessionDayIST("2026-08-16"), false);

assert.equal(isTradingDayIST("2026-01-26"), false);
assert.equal(isJournalSessionDayIST("2026-01-26"), false);

assert.equal(weekdayIST("2026-11-08"), 0, "2026 Laxmi Pujan is Sunday");
assert.equal(isTradingDayIST("2026-11-08"), false);
assert.equal(isSpecialSessionIST("2026-11-08"), true);
assert.equal(isJournalSessionDayIST("2026-11-08"), false, "weekend still closed");

assert.equal(weekdayIST("2025-10-21"), 2);
assert.equal(isTradingDayIST("2025-10-21"), true, "Muhurat is a trading day for charts/OI");
assert.equal(isSpecialSessionIST("2025-10-21"), true);
assert.equal(isJournalSessionDayIST("2025-10-21"), true);
assert.equal(isJournalSessionDayIST("2026-11-10"), false);

function holidayShortName(h, fallback = "Holiday") {
  const name = typeof h === "object" && h ? h.name : "";
  const s = String(name || fallback);
  return s.replace(/\s*\(.*$/, "");
}
assert.equal(({ name: "Ganesh Chaturthi" } && true), true, "JS && true drops the object");
assert.equal(holidayShortName(true), "Holiday");
assert.equal(holidayShortName(undefined), "Holiday");
assert.equal(holidayShortName({ name: "Ganesh Chaturthi" }), "Ganesh Chaturthi");
assert.equal(holidayShortName({ name: "Id-Ul-Fitr (Ramzan Id)" }), "Id-Ul-Fitr");

function holidayCellLabel(h, { muhurat = false } = {}) {
  if (muhurat || (typeof h === "object" && h && h.session === "muhurat")) return "Muh.";
  const full = holidayShortName(h, "Closed");
  const first = full.split(/[/,]/)[0].trim();
  if (first.length <= 14) return first;
  return `${first.slice(0, 10)}…`;
}
assert.notEqual(holidayCellLabel({ name: "Balipratipada" }), "Holi");
assert.equal(holidayCellLabel({ name: "Balipratipada" }), "Balipratipada");
assert.equal(holidayCellLabel({ name: "Diwali Laxmi Pujan* (Muhurat trading)", session: "muhurat" }), "Muh.");
assert.equal(holidayCellLabel({ name: "Prakash Gurpurb Sri Guru Nanak Dev" }).startsWith("Prakash"), true);

function isLongWeekendHoliday(iso) {
  const wd = weekdayIST(iso);
  // Friday → Fri–Sat–Sun; Monday → Sat–Sun–Mon.
  return wd === 5 || wd === 1;
}
assert.equal(weekdayIST("2026-04-03"), 5, "Good Friday 2026");
assert.equal(isLongWeekendHoliday("2026-04-03"), true, "Fri–Sat–Sun long weekend");
assert.equal(weekdayIST("2026-09-14"), 1, "Ganesh Chaturthi 2026 is Monday");
assert.equal(isLongWeekendHoliday("2026-09-14"), true, "Sat–Sun–Mon long weekend");
assert.equal(weekdayIST("2026-10-02"), 5, "Gandhi Jayanti 2026 is Friday");
assert.equal(isLongWeekendHoliday("2026-10-02"), true);
assert.equal(weekdayIST("2026-03-03"), 2, "Holi 2026 is Tuesday");
assert.equal(isLongWeekendHoliday("2026-03-03"), false, "mid-week holiday is not a long weekend");

const RAW = [
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-11-08", name: "Diwali Laxmi Pujan", session: "muhurat" },
];
function mergeYears(raw, rows) {
  if (!rows.length) return raw.slice();
  const years = new Set(rows.map((h) => h.date.slice(0, 4)));
  return raw.filter((h) => !years.has(h.date.slice(0, 4))).concat(rows);
}
const merged = mergeYears(RAW, [
  { date: "2027-01-26", name: "Republic Day" },
  { date: "2027-11-08", name: "Diwali Laxmi Pujan", session: "muhurat" },
]);
assert.equal(merged.find((h) => h.date === "2027-01-26")?.name, "Republic Day");
assert.ok(merged.find((h) => h.date === "2026-05-01"), "other years stay");
assert.equal(mergeYears(RAW, []).find((h) => h.date === "2027-01-26"), undefined);

console.log("holidays.test.js ok");
