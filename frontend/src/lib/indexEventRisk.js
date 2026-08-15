/**
 * Index Impact / Upcoming Index Event Risk helpers.
 * Backend join lives in event_risk_service; the tile and widget only show
 * events with days_remaining >= 0 (past calendar rows stay in the API payload).
 */

export function upcomingIndexEvents(events) {
  return (events || [])
    .filter((e) => (e.days_remaining ?? -1) >= 0)
    .sort(
      (a, b) =>
        a.days_remaining - b.days_remaining ||
        -((a.weightage || 0) - (b.weightage || 0)),
    );
}

export function impactTone(upcoming) {
  if (!upcoming?.length) return "neutral";
  if (upcoming.some((e) => e.days_remaining <= 7)) return "red";
  if (upcoming.some((e) => e.days_remaining > 7 && e.days_remaining <= 14)) return "blue";
  return "neutral";
}

export function eventDisplayName(e, activeIndex) {
  if (!e) return "";
  if (activeIndex === "SENSEX") {
    return e.company_name || e.constituents || e.symbol || "";
  }
  return e.symbol || e.company_name || "";
}

export function daysText(d) {
  if (d === 0) return "TODAY";
  if (d === 1) return "TOMORROW";
  return `in ${d}d`;
}

export function weightageBucket(w) {
  if (w == null) return "grey";
  if (w > 5) return "dark-red";
  if (w >= 3) return "red";
  if (w >= 1) return "orange";
  return "yellow";
}
