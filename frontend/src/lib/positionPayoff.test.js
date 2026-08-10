import assert from "node:assert/strict";
import { resolvePositionSpot, positionExpiryISO, groupPositionsByIndex } from "./positionPayoff.js";

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

console.log("positionPayoff.test.js: all assertions passed");
