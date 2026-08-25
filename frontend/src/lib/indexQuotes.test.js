import assert from "node:assert/strict";
import { pickIndexLtp, indexDayMove } from "./indexQuotes.js";

assert.equal(
  pickIndexLtp({ idx: "GOLD", live: 112578, tickerLtp: 112000, current: { index: "NIFTY", price: 24366 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: 112578, current: { index: "NIFTY", price: 24366 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: null, current: { index: "NIFTY", price: 24366 } }),
  null,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: null, current: { index: "GOLD", price: 112578 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "SENSEX", live: null, tickerLtp: 0, cachedPrice: 81150, current: { index: "NIFTY", price: 24366 } }),
  81150,
);

{
  const m = indexDayMove({ price: 77218, ticker: { prev_close: 77369, change: -10 } });
  assert.equal(Math.round(m.pts), -151);
  assert.ok(m.pct < 0);
}
{
  const m = indexDayMove({ price: null, ticker: { change: -151, change_pct: -0.2 } });
  assert.equal(m.pts, -151);
  assert.equal(m.pct, -0.2);
}

console.log("indexQuotes.test.js: ok");
