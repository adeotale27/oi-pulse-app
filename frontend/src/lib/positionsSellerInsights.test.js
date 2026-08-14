import assert from "node:assert/strict";
import {
  computeBookVerdict,
  computeAssignmentWatch,
  computeDeltaHedgeSuggestions,
  effectiveAdjustThreshold,
  nearestWeeklyExpiry,
  compactAdjustSnapshot,
} from "./positionsSellerInsights.js";

const good = computeBookVerdict({
  netDelta: 2,
  netTheta: 800,
  shortCount: 3,
  adjustCount: 0,
  premiumLeft: 5000,
  itmShortCount: 0,
  pnl: 1200,
});
assert.equal(good.band, "GOOD", "flat + theta book is GOOD");

const weak = computeBookVerdict({
  netDelta: 45,
  netTheta: -200,
  shortCount: 4,
  adjustCount: 3,
  premiumLeft: 100,
  itmShortCount: 2,
  pnl: -800,
});
assert.equal(weak.band, "WEAK", "directional stressed book is WEAK");

assert.equal(
  effectiveAdjustThreshold(60, { expiryDayMode: true, anyExpiryDay: true, nowMs: Date.parse("2026-08-10T08:00:00Z") }),
  40,
  "after 13:30 IST-ish tighten (08:00 UTC ≈ 13:30 IST)",
);

assert.equal(
  nearestWeeklyExpiry([
    { date: "2026-08-14", tag: "M" },
    { date: "2026-08-11", tag: "W" },
  ]),
  "2026-08-11",
  "nearest weekly",
);

const watch = computeAssignmentWatch(
  [
    {
      isShort: true,
      isOpt: true,
      strike: 24500,
      side: "CE",
      spotUsed: 24600,
      last_price: 120,
      tradingsymbol: "NIFTY25AUG24500CE",
    },
  ],
  { nowMs: Date.parse("2026-08-10T09:00:00Z") }, // ~14:30 IST
);
assert.ok(watch.length >= 1 && watch[0].itm === true, "ITM short flagged");

const hedge = computeDeltaHedgeSuggestions({
  netDelta: 25,
  threshold: 10,
  spot: 24500,
  step: 50,
  strikes: [
    { strike: 24000, pe_ltp: 12, ce_ltp: 520 },
    { strike: 24200, pe_ltp: 18, ce_ltp: 380 },
    { strike: 25000, pe_ltp: 400, ce_ltp: 15 },
  ],
});
assert.equal(hedge.needed, true, "hedge needed");
assert.ok(hedge.futuresQty < 0, "positive Δ → sell futures");
assert.ok(hedge.otmBuys.every((x) => x.side === "PE"), "buy puts to flatten long Δ");

const packed = compactAdjustSnapshot({
  rows: [
    { exited: false, isShort: true, isOpt: true, tradingsymbol: "NIFTY25814C24500", side: "CE", strike: 24500, index: "NIFTY", distancePct: 0.4, breachedAdjust: true },
    { exited: true, isShort: true, isOpt: true, tradingsymbol: "SKIP", side: "PE", strike: 1 },
  ],
  stats: { netDelta: 18.22, netTheta: 400, shortCount: 1, adjustCount: 1, netPnl: 1234.9 },
  assignmentWatch: [{ tradingsymbol: "NIFTY25814C24500", itm: true }],
  privacy: true,
});
assert.equal(packed.legs.length, 1);
assert.equal(packed.legs[0].close, true);
assert.equal(packed.legs[0].itm, true);
assert.equal(packed.pnl, null, "privacy hides rupee P&L");
assert.equal(packed.netDelta, 18.2);

console.log("positionsSellerInsights.test.js: all assertions passed");
