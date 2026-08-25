import assert from "node:assert/strict";
import {
  cashSessionFocusIndex,
  cashSessionFocusLabel,
  filterCashHeavyMovers,
  overnightBiasIndices,
} from "./deskFocus.js";

assert.equal(cashSessionFocusIndex(1), "NIFTY");
assert.equal(cashSessionFocusIndex(2), "NIFTY");
assert.equal(cashSessionFocusIndex(3), "SENSEX");
assert.equal(cashSessionFocusIndex(4), "SENSEX");
assert.equal(cashSessionFocusIndex(5), "NIFTY");
assert.match(cashSessionFocusLabel(3), /SENSEX/);
assert.match(cashSessionFocusLabel(1), /NIFTY/);

const movers = filterCashHeavyMovers([
  { symbol: "RELIANCE", index: "NIFTY" },
  { symbol: "INFY", index: "NIFTY 50" },
  { symbol: "HDFCBANK", index: "SENSEX" },
  { symbol: "SBIN", index: "BANKNIFTY" },
]);
assert.deepEqual(movers.map((m) => m.symbol), ["RELIANCE", "INFY", "SBIN"]);

const wed = overnightBiasIndices(3, "NIFTY");
assert.equal(wed[0], "SENSEX");
assert.ok(wed.includes("BANKNIFTY"));
assert.ok(wed.includes("NIFTY"));

console.log("deskFocus.test.js: ok");
