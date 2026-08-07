/**
 * Quick tests for carry window + index impact helpers.
 * Run: node --experimental-vm-modules OR plain require won't work with @ aliases.
 * Inline mirrors of the pure bits we care about.
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekdayOfISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 6, 30)).getUTCDay();
}

// 2026-01-26 is Republic Day (Mon) — from Fri 2026-01-23 window should extend past Mon
const HOLIDAYS = new Set(["2026-01-26"]);
function isHoliday(iso) { return HOLIDAYS.has(iso); }

function carryWindowMaxDays(weekday, fromISO) {
  let days;
  if (weekday === 5) days = 3;
  else if (weekday === 0) days = 1;
  else if (weekday === 6) days = 2;
  else days = 1;
  for (let guard = 0; guard < 12; guard++) {
    const candidate = addDaysISO(fromISO, days);
    const wd = weekdayOfISO(candidate);
    if (wd === 0 || wd === 6 || isHoliday(candidate)) {
      days += 1;
      continue;
    }
    break;
  }
  return days;
}

// Fri 2026-01-23 → Mon 26 is holiday → should reach Tue 27 → days=4
assert(carryWindowMaxDays(5, "2026-01-23") === 4, "Fri before Mon holiday extends to Tue");
// Thu 2026-01-22 → Fri 23 is trading → days=1
assert(carryWindowMaxDays(4, "2026-01-22") === 1, "normal Thu→Fri");
// Wed before Republic Day weekend stretch: 2026-01-21 Wed → Thu 22 open → 1
assert(carryWindowMaxDays(3, "2026-01-21") === 1, "Wed normal");

console.log("carryWindow.extend.test.js: ok");
