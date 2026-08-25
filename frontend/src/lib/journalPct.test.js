import assert from "node:assert/strict";
import { bookedPct, fmtBookedPct, weekEquity } from "./journalPct.js";

assert.equal(bookedPct(3000, 3_000_000), 0.1);
assert.equal(Number(bookedPct(27000, 3_003_000).toFixed(4)), 0.8991);
assert.equal(bookedPct(100, 0), null);
assert.equal(fmtBookedPct(0.1), "0.10%");
assert.equal(fmtBookedPct(-0.9), "-0.90%");

const week = weekEquity([
  { funds_base: 3_000_000, booked_pnl: 3000, inferred_cashflow: 0 },
  { funds_base: 3_003_000, booked_pnl: 27000, inferred_cashflow: -50000 },
]);
assert.equal(week.funds_base, 3_000_000);
assert.equal(week.pnl, 30000);
assert.equal(Number(week.booked_pct.toFixed(2)), 1);
assert.equal(week.inferred_withdrawn, 50000);

console.log("journalPct.test.js ok");
