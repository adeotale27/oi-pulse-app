import assert from "node:assert/strict";
import {
  usdPrice, usdSigned, pctSigned, fmtVolume, moveTone, sortAdrRows, filterAdrRows,
  loadAdrColumns, saveAdrColumns, resetAdrColumns, ADR_DEFAULT_VISIBLE, prefStorageKey, formatIstStamp,
} from "./adr.js";

assert.equal(usdPrice(11.08), "$11.08");
assert.equal(usdPrice(1.68), "$1.680");
assert.equal(usdSigned(-0.24), "-$0.24");
assert.equal(usdSigned(0.13), "+$0.13");
assert.equal(pctSigned(-2.12), "-2.12%");
assert.equal(pctSigned(1.13), "+1.13%");
assert.equal(fmtVolume(11500000), "11.50M");
assert.equal(moveTone(-2), "down");
assert.equal(moveTone(1), "up");
assert.equal(moveTone(0), "neutral");

const rows = [
  { company_name: "Wipro", adr_symbol: "WIT", indian_symbol: "WIPRO", change_percent: -4, last_price: 1.68, sector: "IT" },
  { company_name: "Infosys", adr_symbol: "INFY", indian_symbol: "INFY", change_percent: 1.13, last_price: 11.08, sector: "IT" },
  { company_name: "HDFC Bank", adr_symbol: "HDB", indian_symbol: "HDFCBANK", change_percent: -6.2, last_price: 22.38, sector: "BANKING", large_move: true },
];
const byPct = sortAdrRows(rows, "change_percent", "asc");
assert.equal(byPct[0].adr_symbol, "HDB");
assert.equal(byPct[2].adr_symbol, "INFY");
assert.equal(filterAdrRows(rows, { q: "INFY" })[0].adr_symbol, "INFY");
assert.equal(filterAdrRows(rows, { filter: "BANKING" }).length, 1);
assert.equal(filterAdrRows(rows, { filter: "large" })[0].adr_symbol, "HDB");
assert.equal(filterAdrRows(rows, { filter: "gainers" }).length, 1);

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
};
const user = "Adeotale";
const other = "guest";
saveAdrColumns(user, ["company", "last_price"]);
assert.deepEqual(loadAdrColumns(user), ["company", "last_price"]);
assert.deepEqual(loadAdrColumns(other), ADR_DEFAULT_VISIBLE);
assert.notEqual(prefStorageKey(user), prefStorageKey(other));
assert.deepEqual(resetAdrColumns(user), ADR_DEFAULT_VISIBLE);
assert.deepEqual(loadAdrColumns(user), ADR_DEFAULT_VISIBLE);

assert.equal(formatIstStamp(null), "—");
assert.equal(formatIstStamp(undefined), "—");
assert.equal(formatIstStamp(""), "—");
assert.match(formatIstStamp("2026-09-16T10:30:00.000Z"), /IST$/);
assert.equal(formatIstStamp("2026-09-16T10:30:00.000Z"), "16:00:00 IST");

console.log("adr.test.js ok");
