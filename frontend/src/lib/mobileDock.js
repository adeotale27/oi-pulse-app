import { loadIdOrder, saveIdOrder, orderByIds } from "@/lib/tabOrder";

export const MOBILE_DOCK_KEY = "oiMobileDock";

export const DOCK_CATALOG = [
  { id: "oi-change", label: "Chart", tab: "oi-change" },
  { id: "straddle", label: "Straddle", tab: "straddle" },
  { id: "positions", label: "Positions", tab: "positions", adminOnly: true },
  { id: "holidays", label: "Events", tab: "holidays" },
  { id: "admin-tools", label: "Tools", action: "admin-tools", adminOnly: true },
  { id: "strike-table", label: "Chain", tab: "strike-table" },
  { id: "alerts", label: "Alerts", tab: "alerts" },
  { id: "open-interest", label: "OI", tab: "open-interest" },
  { id: "desk", label: "Desk", action: "desk" },
];

export const DEFAULT_DOCK_ADMIN = ["oi-change", "straddle", "positions", "holidays", "admin-tools"];
export const DEFAULT_DOCK_GUEST = ["oi-change", "straddle", "holidays", "strike-table"];

export function loadMobileDock(isAdmin) {
  const fallback = isAdmin ? DEFAULT_DOCK_ADMIN : DEFAULT_DOCK_GUEST;
  const saved = loadIdOrder(MOBILE_DOCK_KEY);
  const allowed = DOCK_CATALOG.filter((d) => isAdmin || !d.adminOnly);
  const ordered = orderByIds(allowed, saved.length ? saved : fallback);
  const picked = ordered.filter((d) => (saved.length ? saved.includes(d.id) : fallback.includes(d.id)));
  return (picked.length ? picked : ordered.slice(0, 5)).slice(0, 5);
}

export function saveMobileDock(ids) {
  saveIdOrder(MOBILE_DOCK_KEY, ids.slice(0, 5));
}
