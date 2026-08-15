import assert from "node:assert/strict";
import {
  upcomingIndexEvents,
  impactTone,
  eventDisplayName,
  daysText,
  weightageBucket,
} from "./indexEventRisk.js";

const rows = [
  { id: "past", symbol: "TCS", days_remaining: -2, weightage: 4, event_type: "Quarterly Results" },
  { id: "far", symbol: "INFY", days_remaining: 20, weightage: 6, event_type: "Dividend" },
  { id: "soon", symbol: "HDFCBANK", days_remaining: 3, weightage: 12, event_type: "Board Meeting" },
  { id: "today", symbol: "RELIANCE", days_remaining: 0, weightage: 9, event_type: "AGM" },
];

const up = upcomingIndexEvents(rows);
assert.equal(up.map((e) => e.id).join(","), "today,soon,far");
assert.ok(up.every((e) => e.days_remaining >= 0));
assert.equal(impactTone(up), "red");
assert.equal(impactTone(upcomingIndexEvents([{ days_remaining: 10 }])), "blue");
assert.equal(impactTone(upcomingIndexEvents([{ days_remaining: 21 }])), "neutral");
assert.equal(impactTone([]), "neutral");
assert.equal(eventDisplayName({ symbol: "HDFCBANK", company_name: "HDFC Bank" }, "NIFTY"), "HDFCBANK");
assert.equal(eventDisplayName({ symbol: "HDFCBANK", company_name: "HDFC Bank" }, "SENSEX"), "HDFC Bank");
assert.equal(
  eventDisplayName({ symbol: "HDFCBANK", constituents: "HDFC Bank Ltd" }, "SENSEX"),
  "HDFC Bank Ltd",
);
assert.equal(daysText(0), "TODAY");
assert.equal(daysText(1), "TOMORROW");
assert.equal(daysText(5), "in 5d");
assert.equal(weightageBucket(5.1), "dark-red");
assert.equal(weightageBucket(3), "red");
assert.equal(weightageBucket(1.2), "orange");
assert.equal(weightageBucket(0.4), "yellow");
assert.equal(weightageBucket(null), "grey");
console.log("indexEventRisk.test.js ok");
