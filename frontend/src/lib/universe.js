/**
 * Instrument universe — keep lockstep with backend/universe.py.
 *
 * DESK_IDS = live OI board (NIFTY / SENSEX / BANKNIFTY).
 * CATALOG lists MCX majors (pollable once enabled). ATM = nearest FUT.
 */

export const DESK_IDS = ["NIFTY", "SENSEX", "BANKNIFTY"];
export const MCX_MAJOR_IDS = ["CRUDEOIL", "GOLD", "SILVER", "NATURALGAS"];
/** Pause MCX majors on the OI desk (catalog stays; Enable is off). */
export const MCX_DESK_AVAILABLE = false;
export const HEATMAP_IDS = [...DESK_IDS, ...MCX_MAJOR_IDS];

export function isMcxMajorId(id) {
  return MCX_MAJOR_IDS.includes(String(id || "").toUpperCase());
}

/** How many index chips fit the sidebar / phone sticky bar without growing those panes. */
export const INDEX_CHIP_CAP = 3;

export function usesIndexOverflow(ids) {
  return (Array.isArray(ids) ? ids.length : 0) > INDEX_CHIP_CAP;
}

export const ALIASES = {
  BANK: "BANKNIFTY",
  BNF: "BANKNIFTY",
  NIFTY50: "NIFTY",
  CRUDE: "CRUDEOIL",
  CL: "CRUDEOIL",
  NG: "NATURALGAS",
  NATGAS: "NATURALGAS",
};

export const INDEX_STEP = {
  NIFTY: 50,
  SENSEX: 100,
  BANKNIFTY: 100,
  CRUDEOIL: 50,
  GOLD: 100,
  SILVER: 250,
  NATURALGAS: 1,
};

export const INDEX_SHORT = {
  NIFTY: "NIFTY",
  SENSEX: "SENSEX",
  BANKNIFTY: "BNF",
  CRUDEOIL: "CRUDE",
  GOLD: "GOLD",
  SILVER: "SILVER",
  NATURALGAS: "NG",
};

export const INDEX_DOT = {
  NIFTY: "bg-sky-500",
  SENSEX: "bg-amber-500",
  BANKNIFTY: "bg-emerald-500",
  CRUDEOIL: "bg-slate-600",
  GOLD: "bg-yellow-500",
  SILVER: "bg-zinc-400",
  NATURALGAS: "bg-cyan-600",
};

/** Prefixes longest-first so BANKNIFTY wins over NIFTY. */
const PREFIXES = [
  "BANKNIFTY",
  "MIDCPNIFTY",
  "FINNIFTY",
  "CRUDEOILM",
  "CRUDEOIL",
  "NATURALGAS",
  "NATGASMINI",
  "SILVERM",
  "GOLDPETAL",
  "BANKEX",
  "SENSEX",
  "SILVER",
  "GOLDM",
  "GOLD",
  "NIFTY",
];

export const CATALOG = [
  { id: "NIFTY", pollable: true, calendar: "nse", session_group: "nse", exchange: "NFO", kite_name: "NIFTY", quote_kind: "index" },
  { id: "SENSEX", pollable: true, calendar: "nse", session_group: "nse", exchange: "BFO", kite_name: "SENSEX", quote_kind: "index" },
  { id: "BANKNIFTY", pollable: true, calendar: "nse", session_group: "nse", exchange: "NFO", kite_name: "BANKNIFTY", quote_kind: "index" },
  { id: "CRUDEOIL", pollable: true, calendar: "mcx", session_group: "mcx_non_agri", exchange: "MCX", kite_name: "CRUDEOIL", quote_kind: "mcx_fut" },
  { id: "GOLD", pollable: true, calendar: "mcx", session_group: "mcx_non_agri", exchange: "MCX", kite_name: "GOLD", quote_kind: "mcx_fut" },
  { id: "SILVER", pollable: true, calendar: "mcx", session_group: "mcx_non_agri", exchange: "MCX", kite_name: "SILVER", quote_kind: "mcx_fut" },
  { id: "NATURALGAS", pollable: true, calendar: "mcx", session_group: "mcx_non_agri", exchange: "MCX", kite_name: "NATURALGAS", quote_kind: "mcx_fut" },
];

export function normalizeId(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  s = ALIASES[s] || s;
  return s;
}

export function isDeskId(raw) {
  return DESK_IDS.includes(normalizeId(raw));
}

export function strikeStep(raw, fallback = 50) {
  const id = normalizeId(raw);
  if (id && INDEX_STEP[id] != null) return INDEX_STEP[id];
  const row = CATALOG.find((c) => c.id === id);
  return row?.step ?? fallback;
}

export function matchSymbolPrefix(tradingsymbol) {
  const ts = String(tradingsymbol || "").toUpperCase().replace(/\s+/g, "");
  for (const p of PREFIXES) {
    if (ts.startsWith(p)) return p === "NIFTY" && ts.startsWith("NIFTYBANK") ? "BANKNIFTY" : p;
  }
  return null;
}

/** Keep desk ids first; retain any extra ids the backend enabled. */
export function normalizeEnabledIndices(list) {
  const raw = (Array.isArray(list) ? list : [])
    .map((x) => normalizeId(x))
    .filter(Boolean)
    .filter((i) => MCX_DESK_AVAILABLE || !MCX_MAJOR_IDS.includes(i));
  const set = new Set(raw);
  const desk = DESK_IDS.filter((i) => set.has(i));
  const extra = raw.filter((i) => !DESK_IDS.includes(i));
  const seen = new Set(desk);
  const rest = [];
  for (const i of extra) {
    if (!seen.has(i)) {
      seen.add(i);
      rest.push(i);
    }
  }
  return [...desk, ...rest];
}

export function emptyDeskPnl() {
  return Object.fromEntries(HEATMAP_IDS.map((i) => [i, 0]));
}
