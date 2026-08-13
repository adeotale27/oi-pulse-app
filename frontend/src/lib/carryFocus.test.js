import assert from "node:assert/strict";
import { carryFocusEvents, sellerCarryAdvice, vixCarryPoints, writerBiasLine } from "./carryFocus.js";

const items = [
  { date: "2026-08-14", name: "India CPI", impact: "low", daysAway: 1, source: "econ" },
  { date: "2026-08-14", name: "NIFTY impact · MAXHEALTH · Quarterly Results (3.1%)", impact: "critical", daysAway: 0, source: "index-impact", weightage: 3.1 },
  { date: "2026-09-14", name: "NSE Holiday — Ganesh Chaturthi", type: "holiday", source: "holiday", daysAway: 32, impact: "critical" },
  { date: "2026-08-14", name: "US retail", impact: "high", daysAway: 1, source: "econ" },
];
const focus = carryFocusEvents(items);
assert.equal(focus[0].source, "holiday");
assert.ok(focus.some((e) => e.source === "index-impact"));
assert.ok(focus.some((e) => e.impact === "high"));
assert.ok(!focus.some((e) => e.impact === "low"), "low-impact econ is noise for this desk");

const pe = writerBiasLine({ index: "NIFTY", bias: { bullish: true, pct: 40 } });
assert.equal(pe.comfortable, "CE");
assert.match(pe.text, /PE OI/);

const ce = writerBiasLine({ index: "SENSEX", bias: { bullish: false, pct: 30 } });
assert.equal(ce.comfortable, "PE");

const vix = vixCarryPoints(19.2);
assert.equal(vix.pts, 18);

const advice = sellerCarryAdvice({ band: "REDUCE", vix: 19, giftPct: -0.09, focusCount: 2 });
assert.match(advice, /session OI/);
assert.match(sellerCarryAdvice({ band: "DO_NOT_CARRY" }), /unhedged short/);

console.log("carryFocus.test.js ok");
