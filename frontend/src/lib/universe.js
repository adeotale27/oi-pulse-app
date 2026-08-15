/**
 * Instrument universe — keep lockstep with backend/universe.py.
 *
 * DESK_IDS = live OI board (NIFTY / SENSEX / BANKNIFTY).
 * CATALOG also lists MCX names that are NOT pollable until session + FUT spot land.
 */

export const DESK_IDS = ["NIFTY", "SENSEX", "BANKNIFTY"];

export const ALIASES = {
  BANK: "BANKNIFTY",
  BNF: "BANKNIFTY",
  NIFTY50: "NIFTY",
  CRUDE: "CRUDEOIL",
  CL: "CRUDEOIL",
  NG: "NATURALGAS",
  NATGAS: "NATURALGAS",
};

export const INDEX_STEP = { NIFTY: 50, SENSEX: 100, BANKNIFTY: 100 };

export const INDEX_SHORT = { NIFTY: "NIFTY", SENSEX: "SENSEX", BANKNIFTY: "BNF" };

export const INDEX_DOT = {
  NIFTY: "bg-sky-500",
  SENSEX: "bg-amber-500",
  BANKNIFTY: "bg-emerald-500",
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
  { id: "NIFTY", pollable: true, calendar: "nse", exchange: "NFO", kite_name: "NIFTY", quote_kind: "index" },
  { id: "SENSEX", pollable: true, calendar: "nse", exchange: "BFO", kite_name: "SENSEX", quote_kind: "index" },
  { id: "BANKNIFTY", pollable: true, calendar: "nse", exchange: "NFO", kite_name: "BANKNIFTY", quote_kind: "index" },
  { id: "CRUDEOIL", pollable: false, calendar: "mcx", exchange: "MCX", kite_name: "CRUDEOIL", quote_kind: "mcx_fut" },
  { id: "GOLD", pollable: false, calendar: "mcx", exchange: "MCX", kite_name: "GOLD", quote_kind: "mcx_fut" },
  { id: "SILVER", pollable: false, calendar: "mcx", exchange: "MCX", kite_name: "SILVER", quote_kind: "mcx_fut" },
  { id: "NATURALGAS", pollable: false, calendar: "mcx", exchange: "MCX", kite_name: "NATURALGAS", quote_kind: "mcx_fut" },
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
    .filter(Boolean);
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
  return Object.fromEntries(DESK_IDS.map((i) => [i, 0]));
}
