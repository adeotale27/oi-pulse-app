import assert from "node:assert/strict";
import { pickIndexLtp } from "./indexQuotes.js";

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

console.log("indexQuotes.test.js: ok");
