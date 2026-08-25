import assert from "node:assert/strict";
import { bookedPct, fmtBookedPct, madeAfterCharges, weekEquity } from "./journalPct.js";

assert.equal(bookedPct(1500, 1_500_000), 0.1);
assert.equal(madeAfterCharges({ booked_pnl: 1700, charges_total: 200 }), 1500);
assert.equal(fmtBookedPct(0.1), "0.10%");

const week = weekEquity([
  { funds_base: 1_500_000, booked_pnl: 1700, charges_total: 200, booked_after_charges: 1500 },
  { funds_base: 1_501_500, booked_pnl: 1700, charges_total: 200, booked_after_charges: 1500, inferred_cashflow: -50000 },
]);
assert.equal(week.funds_base, 1_500_000);
assert.equal(week.pnl, 3000);
assert.equal(week.booked_pct, 0.2);
assert.equal(week.inferred_withdrawn, 50000);

console.log("journalPct.test.js ok");
