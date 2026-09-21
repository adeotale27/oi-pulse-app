// Positions table column visibility + order (persisted).

export const POSITIONS_COLUMNS_KEY = "oiPositionsColumns";
export const POSITIONS_COLUMN_ORDER_KEY = "oiPositionsColumnOrder";

/** @type {{ id: string, label: string, required?: boolean, defaultOn?: boolean, align?: "left" | "right" }[]} */
export const POSITIONS_COLUMN_DEFS = [
  { id: "instrument", label: "Instrument", required: true, defaultOn: true, align: "left" },
  { id: "avg", label: "Avg", defaultOn: true, align: "right" },
  { id: "ltp", label: "LTP", defaultOn: true, align: "right" },
  { id: "pnl", label: "P&L (Chg%)", defaultOn: true, align: "right" },
  { id: "tilt", label: "Tilt", defaultOn: true, align: "right" },
  { id: "theta", label: "Θ ₹/day", defaultOn: true, align: "right" },
  { id: "stillEarn", label: "Still earn", defaultOn: true, align: "right" },
  { id: "iv", label: "IV", defaultOn: false, align: "right" },
  { id: "dte", label: "Days left", defaultOn: true, align: "right" },
  { id: "status", label: "Status", defaultOn: true, align: "left" },
  { id: "atmDist", label: "ATM Dist", defaultOn: true, align: "right" },
  { id: "strikePressure", label: "Strike Pressure", defaultOn: true, align: "left" },
];

const ALL_IDS = POSITIONS_COLUMN_DEFS.map((c) => c.id);

export function defaultColumnVisibility() {
  const out = {};
  for (const c of POSITIONS_COLUMN_DEFS) {
    out[c.id] = c.defaultOn !== false;
  }
  return out;
}

export function defaultColumnOrder() {
  return [...ALL_IDS];
}

export function loadColumnVisibility() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITIONS_COLUMNS_KEY) || "{}");
    return { ...defaultColumnVisibility(), ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    return defaultColumnVisibility();
  }
}

export function saveColumnVisibility(vis) {
  try {
    localStorage.setItem(POSITIONS_COLUMNS_KEY, JSON.stringify(vis));
  } catch {
    /* noop */
  }
}

export function loadColumnOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITIONS_COLUMN_ORDER_KEY) || "[]");
    if (!Array.isArray(raw)) return defaultColumnOrder();
    const known = new Set(ALL_IDS);
    const seen = new Set();
    const out = [];
    for (const id of raw) {
      if (known.has(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of ALL_IDS) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  } catch {
    return defaultColumnOrder();
  }
}

export function saveColumnOrder(order) {
  try {
    localStorage.setItem(POSITIONS_COLUMN_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* noop */
  }
}

export function moveColumn(order, fromId, toId) {
  const next = [...(Array.isArray(order) && order.length ? order : defaultColumnOrder())];
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

export function visibleColumnIds(vis, order) {
  const visIds = new Set(
    POSITIONS_COLUMN_DEFS.filter((c) => c.required || vis?.[c.id] !== false).map((c) => c.id),
  );
  const seq = Array.isArray(order) && order.length ? order : defaultColumnOrder();
  return seq.filter((id) => visIds.has(id));
}

export function columnAlign(id) {
  return POSITIONS_COLUMN_DEFS.find((c) => c.id === id)?.align === "right" ? "right" : "left";
}
