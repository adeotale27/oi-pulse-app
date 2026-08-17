/**
 * Guest reminder: from 20 Dec of the current year, ask for next year's
 * NSE holiday circular until Admin uploads dates in that year.
 */

export function holidayYearNeeded(todayISO) {
  const iso = String(todayISO || "").slice(0, 10);
  const y = Number(iso.slice(0, 4));
  const md = iso.slice(5);
  if (!y || md.length < 5) return null;
  return md >= "12-20" ? y + 1 : y;
}

export function coveredHolidayYears(rows) {
  const years = new Set();
  for (const h of rows || []) {
    const y = String(h?.date || "").slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  return years;
}

export function shouldRemindHolidayCalendar(todayISO, holidayRows) {
  const need = holidayYearNeeded(todayISO);
  if (need == null) return false;
  return !coveredHolidayYears(holidayRows).has(String(need));
}
