// Positions table column visibility (persisted).

export const POSITIONS_COLUMNS_KEY = "oiPositionsColumns";

/** @type {{ id: string, label: string, required?: boolean, defaultOn?: boolean }[]} */
export const POSITIONS_COLUMN_DEFS = [
  { id: "instrument", label: "Instrument", required: true, defaultOn: true },
  { id: "product", label: "Product", defaultOn: true },
  { id: "qty", label: "Qty", defaultOn: true },
  { id: "avg", label: "Avg", defaultOn: true },
  { id: "ltp", label: "LTP", defaultOn: true },
  { id: "pnl", label: "P&L", defaultOn: true },
  { id: "tilt", label: "Tilt", defaultOn: true },
  { id: "theta", label: "₹/day", defaultOn: true },
  { id: "stillEarn", label: "Still earn", defaultOn: true },
  { id: "iv", label: "IV", defaultOn: false },
  { id: "dte", label: "Days left", defaultOn: true },
  { id: "status", label: "Status", defaultOn: true },
  { id: "atmDist", label: "ATM Dist", defaultOn: true },
];

export function defaultColumnVisibility() {
  const out = {};
  for (const c of POSITIONS_COLUMN_DEFS) {
    out[c.id] = c.defaultOn !== false;
  }
  return out;
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

export function visibleColumnIds(vis) {
  return POSITIONS_COLUMN_DEFS.filter((c) => c.required || vis[c.id] !== false).map((c) => c.id);
}
