import assert from "node:assert/strict";
import { configureMarketHours, isMarketQuiescent } from "./marketTimes.js";

configureMarketHours("09:15", "15:40");

// Tue 1 Sep 2026 12:52 IST (after close / next calendar morning) = 31 Aug 19:22 UTC
assert.equal(isMarketQuiescent(new Date("2026-08-31T19:22:00.000Z")), true, "weekday midnight IST");
// Tue 1 Sep 2026 11:00 IST = 05:30 UTC
assert.equal(isMarketQuiescent(new Date("2026-09-01T05:30:00.000Z")), false, "weekday session");
assert.equal(isMarketQuiescent(new Date("2026-09-01T10:15:00.000Z")), true, "weekday after 15:40 IST");
assert.equal(
  isMarketQuiescent({ market: { is_market_open: false } }),
  true,
  "server closed flag",
);
assert.equal(
  isMarketQuiescent({ market: { is_market_open: true } }),
  false,
  "server open flag wins",
);

console.log("marketTimes.test.js: ok");
