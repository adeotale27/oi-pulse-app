import assert from "node:assert/strict";
import { carryCase, carryFocusEvents, eventDisplayName, eventShortName, sellerCarryAdvice, summarizeBook, vixCarryPoints, writerBiasLine } from "./carryFocus.js";

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
assert.equal(
  eventShortName({ name: "NIFTY impact · MAXHEALTH · Quarterly Results (3.1%)", index: "NIFTY" }),
  "MAXHEALTH · NIFTY",
);
assert.match(
  eventDisplayName({
    name: "NIFTY impact · MAXHEALTH · Quarterly Results (3.1%)",
    index: "NIFTY",
    source: "index-impact",
    weightage: 3.1,
  }),
  /MAXHEALTH · NIFTY · 3\.1% wt/,
);

const pe = writerBiasLine({ index: "NIFTY", bias: { bullish: true, pct: 40 } });
assert.equal(pe.comfortable, "PE");
assert.equal(pe.short, "Puts sit better");
assert.match(pe.text, /put writers/i);

const ce = writerBiasLine({ index: "SENSEX", bias: { bullish: false, pct: 30 } });
assert.equal(ce.comfortable, "CE");
assert.equal(ce.short, "Calls sit better");
assert.match(ce.text, /call writers/i);

const vix = vixCarryPoints(19.2);
assert.equal(vix.pts, 18);

const advice = sellerCarryAdvice({ band: "REDUCE", vix: 19, giftPct: -0.09, focusCount: 2 });
assert.match(advice, /session OI/);
assert.match(sellerCarryAdvice({ band: "DO_NOT_CARRY" }), /unhedged premium/);

const book = summarizeBook([
  { index: "NIFTY", side: "CE", quantity: -75, exited: false },
  { index: "NIFTY", side: "CE", quantity: -75, exited: false },
  { index: "NIFTY", side: "PE", quantity: -75, exited: false },
  { index: "SENSEX", side: "CE", quantity: 0, exited: true },
]);
assert.equal(book.shortCount, 3);
assert.equal(book.byIndex.NIFTY.ce, 2);

const kase = carryCase({
  weekday: 5,
  vix: 11.4,
  giftPct: -0.12,
  biases: [{ index: "NIFTY", bias: { bullish: false, pct: 40 } }],
  events: items,
  book,
});
assert.ok(kase.whyNot.some((s) => /weekend/i.test(s) || /Friday/i.test(s)));
assert.ok(kase.results.length >= 1);
assert.ok(kase.why.length >= 1);
assert.ok(kase.why.some((s) => /call writers dominating/i.test(s)));
assert.ok(kase.why.some((s) => /aligned with session writers/i.test(s)), "4 CE vs 1 PE should align with call-writer tape");
assert.ok(!kase.whyNot.some((s) => /supports PE shorts/i.test(s)));

const fight = carryCase({
  weekday: 2,
  vix: 11.4,
  giftPct: -0.05,
  biases: [{ index: "NIFTY", bias: { bullish: false, pct: 80 } }],
  book: summarizeBook([
    { index: "NIFTY", side: "PE", quantity: -150, exited: false },
    { index: "NIFTY", side: "CE", quantity: -50, exited: false },
  ]),
});
assert.ok(
  fight.whyNot.some((s) => /short more PE while call writers dominate/i.test(s)),
  "more PE lots against a call-writer tape is a why-not",
);

console.log("carryFocus.test.js ok");
