import assert from "node:assert/strict";
import { annotateExpiries, expiryTag, isMonthlyExpiry, lastWeekdayOfMonthUtc } from "./expiryKind.js";

assert.equal(lastWeekdayOfMonthUtc(2026, 8, 2), "2026-08-25");
assert.equal(isMonthlyExpiry("2026-08-25", "NIFTY"), true);
assert.equal(expiryTag("2026-08-25", "NIFTY"), "M");
assert.equal(expiryTag("2026-09-01", "NIFTY"), "W");
assert.equal(expiryTag("2026-08-27", "NIFTY"), "W");

assert.equal(isMonthlyExpiry("2026-08-27", "SENSEX"), true);
assert.equal(expiryTag("2026-08-25", "SENSEX"), "W");
assert.equal(expiryTag("2026-08-27", "SENSEX"), "M");

assert.equal(expiryTag("2026-08-25", "BANKNIFTY"), "M");

const nifty = annotateExpiries(["2026-08-25", "2026-09-01", "2026-09-08"], "NIFTY", "2026-08-25");
assert.deepEqual(nifty.map((m) => m.tag), ["M", "W", "W"]);

const sensex = annotateExpiries(["2026-08-25", "2026-08-27"], "SENSEX", "2026-08-25");
assert.deepEqual(sensex.map((m) => m.tag), ["W", "M"]);

console.log("expiryKind.test.js: ok");
