/** Monthly vs weekly F&O expiry: NSE last Tuesday, BSE last Thursday. */

const TUESDAY = 2; // Date.getUTCDay(): Sun=0 … Tue=2
const THURSDAY = 4;

function ymdParts(iso) {
  const s = String(iso || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, iso: s };
}

export function monthlyExpiryWeekdayJs(index) {
  const u = String(index || "").toUpperCase().replace(/\s+/g, "");
  if (u.includes("SENSEX") || u === "BANKEX") return THURSDAY;
  if (u.includes("NIFTY")) return TUESDAY;
  return THURSDAY;
}

export function lastWeekdayOfMonthUtc(year, month, weekdaySun0) {
  const last = new Date(Date.UTC(year, month, 0)); // month is 1-12 → day 0 of next month
  const lastDay = last.getUTCDate();
  const lastWd = last.getUTCDay();
  const offset = (lastWd - weekdaySun0 + 7) % 7;
  const day = lastDay - offset;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.toISOString().slice(0, 10);
}

export function isMonthlyExpiry(iso, index = "NIFTY") {
  const p = ymdParts(iso);
  if (!p) return false;
  const want = monthlyExpiryWeekdayJs(index);
  const last = lastWeekdayOfMonthUtc(p.y, p.m, want);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return dt.getUTCDay() === want && p.iso === last;
}

export function expiryTag(iso, index = "NIFTY") {
  return isMonthlyExpiry(iso, index) ? "M" : "W";
}

export function annotateExpiries(dates, index = "NIFTY", todayIso) {
  const today = ymdParts(todayIso) || ymdParts(new Date().toISOString());
  const t = today ? Date.UTC(today.y, today.m - 1, today.d) : Date.now();
  return (dates || [])
    .map((raw) => String(raw || "").slice(0, 10))
    .filter(Boolean)
    .map((iso) => {
      const p = ymdParts(iso);
      const monthly = isMonthlyExpiry(iso, index);
      let days = null;
      if (p) {
        days = Math.round((Date.UTC(p.y, p.m - 1, p.d) - t) / 86400000);
      }
      const label = p
        ? new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          })
        : iso;
      return {
        date: iso,
        tag: monthly ? "M" : "W",
        type: monthly ? "monthly" : "weekly",
        days_to_expiry: days,
        label,
      };
    });
}
