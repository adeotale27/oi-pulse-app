import assert from "node:assert/strict";
import { overlayMonthOnYearHeat } from "./journalYearHeat.js";

const yearHeat = {
  month_nets: Array(12).fill(0),
  by_index: { NIFTY: Array(12).fill(0), SENSEX: Array(12).fill(0), BANKNIFTY: Array(12).fill(0) },
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, net_pnl: 0, trading_days: 0 })),
};
yearHeat.month_nets[6] = 1000; // July already in year API

const month = {
  year: 2026,
  month: 8,
  days: [
    { date: "2026-08-13", booked_pnl: 21000, exited_count: 11, booked_index_pnl: { NIFTY: 21000 } },
  ],
};

const out = overlayMonthOnYearHeat(yearHeat, month, 2026, 8);
assert.equal(out.month_nets[6], 1000, "other months kept");
assert.equal(out.month_nets[7], 21000, "August from calendar");
assert.equal(out.months[7].trading_days, 1);
assert.equal(out.by_index.NIFTY[7], 21000);

console.log("journalYearHeat.test.js: ok");
