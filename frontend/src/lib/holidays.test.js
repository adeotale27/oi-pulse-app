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

console.log("holidays.test.js ok");
