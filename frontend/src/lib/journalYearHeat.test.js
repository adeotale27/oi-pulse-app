import assert from "node:assert/strict";
import { heatmapIndexFromLeg, overlayMonthOnYearHeat } from "./journalYearHeat.js";

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

assert.equal(heatmapIndexFromLeg({ tradingsymbol: "SENSEX26AUG76800CE" }), "SENSEX");
assert.equal(heatmapIndexFromLeg({ tradingsymbol: "BANKNIFTY26AUG52000PE" }), "BANKNIFTY");
assert.equal(heatmapIndexFromLeg({ index: "NIFTY", tradingsymbol: "BANKNIFTY26AUG52000PE" }), "NIFTY");
assert.equal(heatmapIndexFromLeg({ tradingsymbol: "GOLD26AUG76000CE" }), "OTHER");
assert.equal(heatmapIndexFromLeg({ tradingsymbol: "FINNIFTY26AUG25000CE" }), "OTHER");
assert.equal(heatmapIndexFromLeg({ tradingsymbol: "RELIANCE26AUG1400CE" }), "OTHER");

const sensexDay = {
  year: 2026,
  month: 8,
  days: [
    {
      date: "2026-08-13",
      booked_pnl: 23100,
      exited_count: 1,
      partial_count: 1,
      booked_index_pnl: { NIFTY: 2100 },
      legs: [
        { tradingsymbol: "NIFTY26AUG24800CE", index: "NIFTY", exited: true, realised: 2100 },
        { tradingsymbol: "SENSEX26AUG76800PE", realised: 21000, partial: true },
      ],
    },
  ],
};
const heat2 = overlayMonthOnYearHeat(yearHeat, sensexDay, 2026, 8);
assert.equal(heat2.by_index.NIFTY[7], 2100);
assert.equal(heat2.by_index.SENSEX[7], 21000);
assert.equal(heat2.month_nets[7], 23100);

console.log("journalYearHeat.test.js: ok");
