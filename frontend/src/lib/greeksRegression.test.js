import assert from "node:assert/strict";
import { impliedVol, greeks, yearsToExpiry, expiryStillLive } from "./blackScholes.js";
import { resolvePositionSpot } from "./positionPayoff.js";

const T = yearsToExpiry("2026-08-11", Date.parse("2026-08-10T07:30:00Z"));
assert.ok(T > 0 && T < 0.01, "≈1 DTE");

// Object spot must NEVER be treated as a number (was → IV 500% + Δ NaN)
assert.equal(impliedVol(4.25, { price: 24605 }, 23050, T, 0.065, false), null, "reject object spot");
const badG = greeks({ price: 24605 }, 23050, T, 0.065, 0.2, false);
assert.equal(badG.delta, null, "greeks reject object spot");

// Correct numeric spot → finite greeks for deep OTM PE
const iv = impliedVol(4.25, 24605, 23050, T, 0.065, false);
assert.ok(iv != null && iv < 2, `sane IV got ${iv}`);
const g = greeks(24605, 23050, T, 0.065, iv, false);
assert.ok(Number.isFinite(g.delta), "finite delta");
assert.ok(Number.isFinite(g.theta), "finite theta");
assert.ok(g.delta < 0, "put delta negative");

// Ceiling IV rejected
assert.equal(impliedVol(5000, 24605, 23050, T, 0.065, false), null, "absurd premium → null IV");

// Spot unwrap from /positions shape
assert.equal(
  resolvePositionSpot({ index: "NIFTY" }, { NIFTY: { price: 24605, atm: 24600 } }, 1),
  24605,
);

assert.equal(expiryStillLive("2026-08-18", Date.parse("2026-08-18T13:43:00+05:30")), true);
assert.equal(expiryStillLive("2026-08-18", Date.parse("2026-08-18T15:41:00+05:30")), false);

console.log("greeksRegression.test.js: all assertions passed");
