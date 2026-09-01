import assert from "node:assert/strict";
import { getTickerRegime } from "./tickerRegime.js";

assert.equal(getTickerRegime(0, true, 25000, 25010, 24990, 25000), "steady");
assert.equal(getTickerRegime(NaN, false, 25000, 25100, 24900, 25000), "steady");
assert.equal(getTickerRegime(0.9, false, 24000, 24250, 23950, 24216), "bullish");
assert.equal(getTickerRegime(-0.9, false, 24000, 24050, 23780, 23784), "risk-off");
assert.equal(getTickerRegime(0.3, false, 24000, 24100, 23980, 24072), "trending");
assert.equal(getTickerRegime(0.05, false, 24000, 24040, 23980, 24012), "range");
// Missing LTP must not treat price as 0 (that used to look like a 100% crash).
assert.equal(getTickerRegime(0.05, false, 24000, 24040, 23980, null), "range");
assert.equal(getTickerRegime(0.05, false, 24000, 24040, 23980, 0), "range");

console.log("tickerRegime.test.js: ok");
