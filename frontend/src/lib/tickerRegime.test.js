import assert from "node:assert/strict";
import { describeTickerRegime, getTickerRegime } from "./tickerRegime.js";

assert.equal(getTickerRegime(0, true, 25000, 25010, 24990, 25000, 25000), "steady");
assert.equal(getTickerRegime(NaN, false, 25000, 25100, 24900, null), "unavailable");
assert.equal(getTickerRegime(NaN, false, 25000, 25100, 24900, 25000, 25000), "range");
assert.equal(getTickerRegime(0.9, false, 24000, 24250, 23950, 24216, 24020), "bull-trend");

const riskOff = getTickerRegime(-1.2, false, 23500, 23320, 23140, 23150, 23300);
assert.equal(riskOff, "risk-off");

assert.equal(getTickerRegime(0.3, false, 24000, 24100, 23980, 24072, 24005), "bull-trend");
assert.equal(getTickerRegime(0.05, false, 24000, 24120, 23920, 24019, 24010), "range");
assert.equal(getTickerRegime(0.05, false, 24000, 24040, 23980, null), "range");
assert.equal(getTickerRegime(0.04, false, 24000, 24020, 23990, 24010, 24005), "steady");
assert.equal(getTickerRegime(0.08, false, 24000, 24120, 23920, 24019, 24010), "range");

assert.equal(
  getTickerRegime(-0.85, false, 23500, 23580, 23280, 23520, 23300),
  "bull-trend",
  "gap-down recovery is not risk-off",
);

assert.equal(
  getTickerRegime(-0.35, false, 23200, 23210, 23090, 23118, 23195),
  "bear-trend",
  "mild one-way down is bear trend not risk-off",
);

assert.equal(
  getTickerRegime(0.28, false, 23200, 23290, 23195, 23265, 23210),
  "bull-trend",
);

assert.equal(
  getTickerRegime(0.85, false, 23500, 23740, 23510, 23720, 23700),
  "bull-trend",
);

assert.equal(
  getTickerRegime(-0.4, false, 23500, 23720, 23380, 23400, 23700),
  "risk-off",
);

const a = getTickerRegime(-0.4, false, 20000, 19950, 19880, 19900, 19940);
const b = getTickerRegime(-0.4, false, 80000, 79800, 79520, 79600, 79760);
assert.equal(a, b);

const d = describeTickerRegime(0.05, false, 24000, 24120, 23920, 24019, 24010);
assert.equal(d.key, "range");
assert.equal(d.label, "RANGING");
assert.match(d.why, /range/i);

console.log("tickerRegime.test.js: ok");
