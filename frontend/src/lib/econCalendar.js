// Curated economic events for 2025-2026 that materially move Indian markets.
// Source: official RBI schedule, Federal Reserve FOMC calendar, MoSPI release schedule,
// BLS release schedule. Update this file annually.
//
// Impact scoring (used to compute the overnight risk score):
//   'critical' = 4  (Fed decision, RBI, budget)
//   'high'     = 3  (Fed SEP, US CPI, US NFP, India CPI, India GDP)
//   'medium'   = 2  (Minutes, PMI, WPI)
//   'low'      = 1  (routine data)

export const ECON_EVENTS = [
  // ===================== RBI Monetary Policy (India) =====================
  // Bi-monthly; announcement on the final day of a 2-3 day meeting.
  { date: "2025-02-07", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2025-04-09", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2025-06-06", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2025-08-06", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2025-10-08", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2025-12-05", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  // 2026 (official schedule for FY26 published Mar 2025; FY27 not yet released)
  { date: "2026-02-06", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2026-04-08", name: "RBI MPC Decision (est.)", type: "rbi", country: "IN", impact: "critical" },
  { date: "2026-06-05", name: "RBI MPC Decision", type: "rbi", country: "IN", impact: "critical" },
  { date: "2026-08-06", name: "RBI MPC Decision (est.)", type: "rbi", country: "IN", impact: "critical" },
  { date: "2026-10-08", name: "RBI MPC Decision (est.)", type: "rbi", country: "IN", impact: "critical" },
  { date: "2026-12-04", name: "RBI MPC Decision (est.)", type: "rbi", country: "IN", impact: "critical" },

  // ===================== Union Budget =====================
  { date: "2025-02-01", name: "Union Budget 2025-26", type: "budget", country: "IN", impact: "critical" },
  { date: "2026-02-01", name: "Union Budget 2026-27", type: "budget", country: "IN", impact: "critical" },

  // ===================== US Federal Reserve FOMC =====================
  // Rate decision released day 2 (14:00 ET). SEP-carrying meetings have extra impact.
  { date: "2025-01-29", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-03-19", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-05-07", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-06-18", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-07-30", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-09-17", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-10-29", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2025-12-10", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  // 2026 (official — announced by Fed Aug 2024)
  { date: "2026-01-28", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-03-18", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-04-29", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-06-17", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-07-29", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-09-16", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-10-28", name: "FOMC Rate Decision", type: "fomc", country: "US", impact: "critical" },
  { date: "2026-12-09", name: "FOMC Rate Decision + SEP", type: "fomc", country: "US", impact: "critical" },

  // ===================== India CPI (MoSPI, ~12th of month) =====================
  { date: "2026-01-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-02-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-03-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-04-13", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-05-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-06-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-07-13", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-08-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-09-14", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-10-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-11-12", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },
  { date: "2026-12-14", name: "India CPI Inflation", type: "cpi", country: "IN", impact: "high" },

  // ===================== India GDP (quarterly, last day of Feb/May/Aug/Nov) =====================
  { date: "2026-02-27", name: "India GDP Q3 FY26", type: "gdp", country: "IN", impact: "high" },
  { date: "2026-05-29", name: "India GDP Q4 FY26 & FY26 Annual", type: "gdp", country: "IN", impact: "critical" },
  { date: "2026-08-31", name: "India GDP Q1 FY27", type: "gdp", country: "IN", impact: "high" },
  { date: "2026-11-30", name: "India GDP Q2 FY27", type: "gdp", country: "IN", impact: "high" },

  // ===================== US CPI (mid-month, BLS) =====================
  { date: "2026-01-13", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-02-11", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-03-12", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-04-10", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-05-13", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-06-10", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-07-15", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-08-12", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-09-10", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-10-14", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-11-13", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },
  { date: "2026-12-10", name: "US CPI Inflation", type: "us-cpi", country: "US", impact: "high" },

  // ===================== US Non-Farm Payrolls (1st Friday of month) =====================
  { date: "2026-01-02", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-02-06", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-03-06", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-04-03", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-05-01", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-06-05", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-07-02", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-08-07", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-09-04", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-10-02", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-11-06", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
  { date: "2026-12-04", name: "US Non-Farm Payrolls", type: "nfp", country: "US", impact: "high" },
];

import { todayIST, daysBetweenIST } from "./holidays";

// All events strictly in the future (today or later), sorted asc.
export function upcomingEvents(limit = 20) {
  const today = todayIST();
  return ECON_EVENTS
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((e) => ({ ...e, daysAway: daysBetweenIST(today, e.date) }));
}

// Events that fall within `days` calendar days (default 3 → today, tomorrow, day-after).
export function eventsWithinDays(days = 3) {
  const all = upcomingEvents(50);
  return all.filter((e) => e.daysAway <= days);
}

// Impact numeric score used by the risk widget.
export function impactScore(impact) {
  switch (impact) {
    case "critical": return 4;
    case "high": return 3;
    case "medium": return 2;
    default: return 1;
  }
}

export function eventBadgeTone(type) {
  switch (type) {
    case "rbi":    return "bg-purple-100 text-purple-800 border-purple-200";
    case "fomc":   return "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200";
    case "budget": return "bg-amber-100 text-amber-800 border-amber-200";
    case "cpi":
    case "us-cpi": return "bg-rose-100 text-rose-800 border-rose-200";
    case "gdp":    return "bg-sky-100 text-sky-800 border-sky-200";
    case "nfp":    return "bg-orange-100 text-orange-800 border-orange-200";
    case "expiry": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    default:       return "bg-slate-100 text-slate-700 border-slate-200";
  }
}
