import { loadIdOrder, saveIdOrder, orderByIds } from "@/lib/tabOrder";

export const MOBILE_DOCK_KEY = "oiMobileDock.v2";

export const DOCK_CATALOG = [
  { id: "oi-change", label: "Chart", tab: "oi-change" },
  { id: "straddle", label: "Straddle", tab: "straddle" },
  { id: "positions", label: "Positions", tab: "positions" },
  { id: "admin-tools", label: "Settings", action: "admin-tools", adminOnly: true },
  { id: "holidays", label: "Events", tab: "holidays" },
  { id: "strike-table", label: "Chain", tab: "strike-table" },
  { id: "alerts", label: "Alerts", tab: "alerts" },
  { id: "open-interest", label: "OI", tab: "open-interest" },
  { id: "desk", label: "Desk", action: "desk" },
];

export const DEFAULT_DOCK_ADMIN = ["oi-change", "straddle", "positions", "admin-tools"];
export const DEFAULT_DOCK_GUEST = ["oi-change", "straddle", "positions", "holidays"];

export function loadMobileDock(isAdmin) {
  const fallback = isAdmin ? DEFAULT_DOCK_ADMIN : DEFAULT_DOCK_GUEST;
  const saved = loadIdOrder(MOBILE_DOCK_KEY);
  const allowed = DOCK_CATALOG.filter((d) => isAdmin || !d.adminOnly);
  const preferred = saved.length ? saved : fallback;
  const ordered = orderByIds(allowed, preferred);
  const picked = ordered.filter((d) => preferred.includes(d.id));
  return (picked.length ? picked : ordered.slice(0, 4)).slice(0, 5);
}

export function saveMobileDock(ids) {
  saveIdOrder(MOBILE_DOCK_KEY, ids.slice(0, 5));
}
