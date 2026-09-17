/** ADR table columns, USD formatters, and column-visibility prefs (localStorage). */

export const ADR_COLUMNS = [
  { id: "company", label: "Company", defaultVisible: true, sortable: true, numeric: false, sticky: true, help: "Indian parent / ADR issuer" },
  { id: "indian_symbol", label: "Indian Symbol", defaultVisible: false, sortable: true, numeric: false },
  { id: "adr_symbol", label: "ADR", defaultVisible: true, sortable: true, numeric: false, help: "US ticker" },
  { id: "exchange", label: "Exchange", defaultVisible: false, sortable: true, numeric: false },
  { id: "sector", label: "Sector", defaultVisible: false, sortable: true, numeric: false },
  { id: "last_price", label: "Last", defaultVisible: true, sortable: true, numeric: true, kind: "usd" },
  { id: "change", label: "Change", defaultVisible: true, sortable: true, numeric: true, kind: "usdSigned" },
  { id: "change_percent", label: "Chg. %", defaultVisible: true, sortable: true, numeric: true, kind: "pct" },
  { id: "open", label: "Open", defaultVisible: false, sortable: true, numeric: true, kind: "usd" },
  { id: "high", label: "High", defaultVisible: true, sortable: true, numeric: true, kind: "usd" },
  { id: "low", label: "Low", defaultVisible: true, sortable: true, numeric: true, kind: "usd" },
  { id: "previous_close", label: "Previous Close", defaultVisible: false, sortable: true, numeric: true, kind: "usd" },
  { id: "volume", label: "Volume", defaultVisible: true, sortable: true, numeric: true, kind: "vol" },
  { id: "average_volume", label: "Avg Volume", defaultVisible: false, sortable: true, numeric: true, kind: "vol" },
  { id: "rolling_1d_change", label: "1D Change", defaultVisible: false, sortable: true, numeric: true, kind: "pct" },
  { id: "rolling_7d_change", label: "7D Change", defaultVisible: false, sortable: true, numeric: true, kind: "pct" },
  { id: "week52_low", label: "52W Low", defaultVisible: false, sortable: true, numeric: true, kind: "usd" },
  { id: "week52_high", label: "52W High", defaultVisible: false, sortable: true, numeric: true, kind: "usd" },
  { id: "market_status", label: "Market Status", defaultVisible: true, sortable: false, numeric: false },
  { id: "updated", label: "Last updated", defaultVisible: true, sortable: true, numeric: false, kind: "time" },
];

export const ADR_COL_IDS = ADR_COLUMNS.map((c) => c.id);
export const ADR_DEFAULT_VISIBLE = ADR_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
/** Phone quote strip — Last / Change / Chg. % after the name. Full row opens the detail sheet. */
export const ADR_PHONE_COL_IDS = ["company", "last_price", "change", "change_percent"];
export const ADR_FILTERS = [
  { id: "all", label: "All" },
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "large", label: "Large Moves" },
  { id: "BANKING", label: "Banking" },
  { id: "IT", label: "IT" },
];

const PREF_KEY = "oiAdrColumns.v3";

export function usdPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  let dp = 2;
  if (abs > 0 && abs < 0.1) dp = 3;
  else if (abs >= 1 && abs < 10) dp = 3;
  return `$${n.toFixed(dp)}`;
}

export function usdSigned(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const body = usdPrice(Math.abs(n));
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

export function pctSigned(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtVolume(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function moveTone(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "up" : "down";
}

export function toneClass(tone) {
  if (tone === "up") return "text-emerald-600";
  if (tone === "down") return "text-rose-600";
  return "text-slate-500 dark:text-slate-400";
}

export function listingCountryCode(exchangeOrRow) {
  if (exchangeOrRow && typeof exchangeOrRow === "object") {
    if (exchangeOrRow.listing_country) return String(exchangeOrRow.listing_country).toUpperCase();
    return listingCountryCode(exchangeOrRow.exchange);
  }
  const e = String(exchangeOrRow || "").trim().toUpperCase();
  if (["FRA", "XETRA", "FWB", "FSE", "XETR", "FRANKFURT"].includes(e)) return "DE";
  if (["LSE", "LON", "LONDON"].includes(e)) return "GB";
  return "US";
}

export function listingFlag(exchangeOrRow) {
  if (exchangeOrRow && typeof exchangeOrRow === "object") {
    if (exchangeOrRow.listing_flag) return exchangeOrRow.listing_flag;
    return listingFlag(exchangeOrRow.exchange);
  }
  const code = listingCountryCode(exchangeOrRow);
  if (code === "DE") return "🇩🇪";
  if (code === "GB") return "🇬🇧";
  return "🇺🇸";
}

export function listingMarketName(exchangeOrRow) {
  if (exchangeOrRow && typeof exchangeOrRow === "object" && exchangeOrRow.market_label) {
    return exchangeOrRow.market_label;
  }
  const exch = exchangeOrRow && typeof exchangeOrRow === "object" ? exchangeOrRow.exchange : exchangeOrRow;
  const code = listingCountryCode(exch);
  if (code === "DE") return "German Market";
  if (code === "GB") return "UK Market";
  return "US Market";
}

export function isAdrSessionOpen(row) {
  if (!row) return false;
  if (row.listing_open === true || row.is_market_open === true) return true;
  if (row.listing_open === false || row.is_market_open === false) return false;
  if (row.display_status === "CURRENT" && !row.stale) return true;
  return false;
}

export function formatAdrCell(col, row) {
  const id = col.id;
  if (id === "company") return row.company_name || "—";
  if (id === "indian_symbol") return row.indian_symbol || "—";
  if (id === "adr_symbol") return row.adr_symbol || "—";
  if (id === "exchange") return row.exchange || "—";
  if (id === "sector") return row.sector || "—";
  if (id === "market_status") {
    const venue = listingMarketName(row);
    if (row.display_status === "CURRENT" && isAdrSessionOpen(row)) return `${venue} Open`;
    if (row.display_status === "LAST_KNOWN") return "Using Last Successful Data";
    if (row.stale) return `${venue} Closed`;
    return isAdrSessionOpen(row) ? `${venue} Open` : `${venue} Closed`;
  }
  if (id === "updated") return formatIstStamp(row.fetched_at);
  const v = row[id];
  if (col.kind === "usd") return usdPrice(v);
  if (col.kind === "usdSigned") return usdSigned(v);
  if (col.kind === "pct") return pctSigned(v);
  if (col.kind === "vol") return fmtVolume(v);
  return v == null ? "—" : String(v);
}

export function sortAdrRows(rows, key, dir) {
  const col = ADR_COLUMNS.find((c) => c.id === key);
  const mul = dir === "asc" ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (key === "company") return mul * String(a.company_name || "").localeCompare(String(b.company_name || ""));
    if (key === "updated") return mul * String(a.fetched_at || "").localeCompare(String(b.fetched_at || ""));
    const av = a[key];
    const bv = b[key];
    if (col?.numeric) {
      const an = Number(av);
      const bn = Number(bv);
      const aOk = Number.isFinite(an);
      const bOk = Number.isFinite(bn);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return mul * (an - bn);
    }
    return mul * String(av || "").localeCompare(String(bv || ""));
  });
  return copy;
}

export function filterAdrRows(rows, { q = "", filter = "all" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return rows.filter((r) => {
    if (needle) {
      const blob = `${r.company_name || ""} ${r.indian_symbol || ""} ${r.adr_symbol || ""}`.toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    if (filter === "gainers") return Number(r.change_percent) > 0;
    if (filter === "losers") return Number(r.change_percent) < 0;
    if (filter === "large") return !!r.large_move;
    if (filter === "BANKING" || filter === "IT") return String(r.sector || "").toUpperCase() === filter;
    return true;
  });
}

export function prefStorageKey(userKey) {
  const u = String(userKey || "desk").trim() || "desk";
  return `${PREF_KEY}:${u}`;
}

export function loadAdrColumns(userKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(prefStorageKey(userKey)) || "null");
    if (Array.isArray(raw) && raw.length) {
      const known = new Set(ADR_COL_IDS);
      const ids = raw.filter((id) => known.has(id));
      if (ids.length) return ids;
    }
  } catch { /* noop */ }
  return ADR_DEFAULT_VISIBLE.slice();
}

export function saveAdrColumns(userKey, ids) {
  try {
    localStorage.setItem(prefStorageKey(userKey), JSON.stringify(ids));
  } catch { /* noop */ }
}

export function resetAdrColumns(userKey) {
  const ids = ADR_DEFAULT_VISIBLE.slice();
  saveAdrColumns(userKey, ids);
  return ids;
}

export function formatIstStamp(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + " IST";
  } catch {
    return String(iso);
  }
}
