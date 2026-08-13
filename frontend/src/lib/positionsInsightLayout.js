import { loadIdOrder, saveIdOrder, moveIdBefore, orderByIds } from "@/lib/tabOrder";

export const INSIGHT_LAYOUT_KEY = "oiPositionsInsightLayout.v2";
export const INSIGHT_HIDDEN_KEY = "oiPositionsInsightHidden.v2";

export const INSIGHT_TILE_DEFS = [
  { id: "todayPnl", label: "Today P&L", defaultOn: true },
  { id: "funds", label: "Funds available", defaultOn: true },
  { id: "dailyTheta", label: "Daily time money", defaultOn: true },
  { id: "tilt", label: "Direction tilt", defaultOn: true },
  { id: "stillEarn", label: "Still to earn", defaultOn: true },
  { id: "booked", label: "Profit booked today", defaultOn: true },
  { id: "untilClose", label: "Until close", defaultOn: true },
  { id: "overnight", label: "Overnight risk", defaultOn: true },
];

export const DEFAULT_INSIGHT_ORDER = INSIGHT_TILE_DEFS.map((t) => t.id);

export function loadInsightOrder() {
  const saved = loadIdOrder(INSIGHT_LAYOUT_KEY);
  return orderByIds(INSIGHT_TILE_DEFS, saved).map((t) => t.id);
}

export function saveInsightOrder(ids) {
  saveIdOrder(INSIGHT_LAYOUT_KEY, ids);
}

export function loadInsightHidden() {
  try {
    const raw = JSON.parse(localStorage.getItem(INSIGHT_HIDDEN_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveInsightHidden(ids) {
  try {
    localStorage.setItem(INSIGHT_HIDDEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* noop */
  }
}

export function reorderInsights(order, dragId, dropId) {
  const next = moveIdBefore(order, dragId, dropId);
  saveInsightOrder(next);
  return next;
}
