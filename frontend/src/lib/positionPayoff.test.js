import assert from "node:assert/strict";
import {
  resolvePositionSpot,
  positionExpiryISO,
  groupPositionsByIndex,
  buildOiBars,
  sigmaBands,
} from "./positionPayoff.js";

// spotByIndex from /positions is { price, atm } — must unwrap
assert.equal(
  resolvePositionSpot({ index: "NIFTY" }, { NIFTY: { price: 24600, atm: 24600 } }, 100),
  24600,
  "unwrap {price}",
);
assert.equal(
  resolvePositionSpot({ index: "NIFTY" }, { NIFTY: 24500 }, null),
  24500,
  "numeric spot ok",
);
assert.equal(
  resolvePositionSpot({ index: "SENSEX" }, {}, 81000),
  81000,
  "fallback when missing",
);

assert.equal(
  positionExpiryISO({ expiry_iso: "2026-08-11" }),
  "2026-08-11",
);
assert.equal(
  positionExpiryISO({ expiry_yy: "26", expiry_code: "AUG11", expiry_day: 11 }),
  "2026-08-11",
);

const map = groupPositionsByIndex([
  { isOpt: true, index: "NIFTY", tradingsymbol: "A" },
  { isOpt: true, index: "SENSEX", tradingsymbol: "B" },
  { isOpt: true, index: "NIFTY", tradingsymbol: "C" },
]);
assert.equal(map.get("NIFTY").length, 2);
assert.equal(map.get("SENSEX").length, 1);

const sd = sigmaBands(24600, 0.15, 1);
assert.ok(sd && sd.oneSigma > 0 && sd.m1 < 24600 && sd.p1 > 24600, "σ bands");

const bars = buildOiBars([
  { strike: 24500, ce_oi: 100, pe_oi: 50 },
  { strike: 24600, ce_oi: 200, pe_oi: 180 },
]);
assert.equal(bars.length, 2);
assert.ok(bars.every((b) => b.ce <= 1 && b.pe <= 1), "normalized OI");

console.log("positionPayoff.test.js: all assertions passed");
