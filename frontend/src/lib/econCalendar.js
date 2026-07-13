// Hardcoded economic calendar for Indian markets 2025-2026.
// Extend/update as needed. Types: 'rbi', 'budget', 'inflation', 'gdp', 'fed', 'results', 'expiry'.
// The `impact` field is a loose severity: 'high' | 'medium'.

export const ECON_EVENTS = [
  // 2025 (illustrative — includes announced RBI MPC meetings)
  { date: "2025-02-07", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-02-01", name: "Union Budget 2025-26", type: "budget", impact: "high" },
  { date: "2025-04-09", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-06-06", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-08-06", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-10-08", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-12-05", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2025-01-14", name: "CPI Inflation Data", type: "inflation", impact: "medium" },
  { date: "2025-02-14", name: "CPI Inflation Data", type: "inflation", impact: "medium" },
  { date: "2025-11-29", name: "Q2 FY26 GDP Data", type: "gdp", impact: "medium" },

  // 2026
  { date: "2026-02-01", name: "Union Budget 2026-27", type: "budget", impact: "high" },
  { date: "2026-02-06", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-04-08", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-06-05", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-08-05", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-10-07", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-12-04", name: "RBI Monetary Policy", type: "rbi", impact: "high" },
  { date: "2026-01-14", name: "CPI Inflation Data", type: "inflation", impact: "medium" },
  { date: "2026-02-12", name: "CPI Inflation Data", type: "inflation", impact: "medium" },
];

import { todayIST, daysBetweenIST } from "./holidays";

export function upcomingEvents(limit = 5) {
  const today = todayIST();
  return ECON_EVENTS
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
    .map((e) => ({ ...e, daysAway: daysBetweenIST(today, e.date) }));
}

export function eventBadgeTone(type) {
  switch (type) {
    case "rbi": return "bg-purple-100 text-purple-800 border-purple-200";
    case "budget": return "bg-amber-100 text-amber-800 border-amber-200";
    case "inflation": return "bg-rose-100 text-rose-800 border-rose-200";
    case "gdp": return "bg-sky-100 text-sky-800 border-sky-200";
    case "expiry": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}
