import assert from "node:assert/strict";
import {
  computePositionHedge,
  hedgeUnderlying,
  inferLotSize,
  isOpenPositionRow,
  quantityToLots,
} from "./positionHedge.js";

function opt(partial) {
  return {
    exited: false,
    quantity: 0,
    side: "PE",
    strike: 23000,
    lot_size: 75,
    ...partial,
  };
}

function byKey(h) {
  const m = {};
  for (const g of h.groups) m[`${g.underlying} ${g.optionType}`] = g;
  return m;
}

// --- open vs exited (same rule as Positions) ---
assert.equal(isOpenPositionRow({ exited: true, quantity: 75 }), false);
assert.equal(isOpenPositionRow({ exited: false, quantity: 0 }), false);
assert.equal(isOpenPositionRow({ exited: false, quantity: -75 }), true);

// --- dynamic underlying from data, not a catalog ---
assert.equal(hedgeUnderlying({ index: "SUPERNEWIDX", tradingsymbol: "NIFTY25AUG1CE" }), "SUPERNEWIDX");
assert.equal(hedgeUnderlying({ tradingsymbol: "NEWFUTIDX25SEP10000CE" }), "NEWFUTIDX");

assert.equal(quantityToLots(375, 75), 5);
assert.equal(inferLotSize([375, 300]), 75);
assert.equal(inferLotSize([375]), null, "single qty is not lot size");

// 1. Single index — underhedged PE
{
  const h = computePositionHedge([
    opt({ index: "IDXONE", side: "PE", quantity: 375, strike: 23000 }),
    opt({ index: "IDXONE", side: "PE", quantity: -300, strike: 23100 }),
  ]);
  const g = byKey(h)["IDXONE PE"];
  assert.equal(g.buyLots, 5);
  assert.equal(g.sellLots, 4);
  assert.equal(g.netLots, 1);
  assert.equal(g.kind, "underhedged");
  assert.match(g.label, /Underhedged by 1 lot/);
  assert.equal(h.overallKind, "issues");
  assert.match(h.overallLabel, /1 Hedge Issue/);
}

// 2+3. Multiple + many dynamically detected indices
{
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push(opt({ index: `IDX${i}`, side: "CE", quantity: 10, lot_size: 10, strike: 100 + i }));
    rows.push(opt({ index: `IDX${i}`, side: "CE", quantity: -10, lot_size: 10, strike: 200 + i }));
  }
  const h = computePositionHedge(rows);
  assert.equal(h.groups.length, 12);
  assert.equal(h.byUnderlying.length, 12);
  assert.equal(h.overallKind, "hedged");
  assert.equal(h.overallLabel, "All Positions Hedged");
}

// 4. CE only
{
  const h = computePositionHedge([
    opt({ index: "A", side: "CE", quantity: 150, lot_size: 75 }),
    opt({ index: "A", side: "CE", quantity: -75, lot_size: 75 }),
  ]);
  assert.equal(h.groups.length, 1);
  assert.equal(h.groups[0].optionType, "CE");
  assert.equal(h.groups[0].kind, "underhedged");
  assert.equal(h.groups[0].netLots, 1);
}

// 5. PE only
{
  const h = computePositionHedge([opt({ index: "A", side: "PE", quantity: -150, lot_size: 75 })]);
  assert.equal(h.groups[0].optionType, "PE");
  assert.equal(h.groups[0].kind, "unhedged");
  assert.equal(h.groups[0].remainingSide, "SELL");
}

// 6. CE + PE independent
{
  const h = computePositionHedge([
    opt({ index: "A", side: "PE", quantity: 375, lot_size: 75 }),
    opt({ index: "A", side: "PE", quantity: -300, lot_size: 75 }),
    opt({ index: "A", side: "CE", quantity: 750, lot_size: 75 }),
    opt({ index: "A", side: "CE", quantity: -750, lot_size: 75 }),
  ]);
  const m = byKey(h);
  assert.equal(m["A PE"].kind, "underhedged");
  assert.equal(m["A PE"].netLots, 1);
  assert.equal(m["A CE"].kind, "hedged");
  assert.equal(h.overallKind, "issues");
}

// 7. BUY > SELL
{
  const g = computePositionHedge([
    opt({ index: "A", quantity: 5, lot_size: 1, side: "PE" }),
    opt({ index: "A", quantity: -4, lot_size: 1, side: "PE", strike: 2 }),
  ]).groups[0];
  assert.equal(g.remainingSide, "BUY");
  assert.equal(g.netLots, 1);
}

// 8. SELL > BUY
{
  const g = computePositionHedge([
    opt({ index: "A", side: "CE", quantity: -10, lot_size: 1 }),
    opt({ index: "A", side: "CE", quantity: 6, lot_size: 1, strike: 2 }),
  ]).groups[0];
  assert.equal(g.buyLots, 6);
  assert.equal(g.sellLots, 10);
  assert.equal(g.netLots, 4);
  assert.equal(g.remainingSide, "SELL");
  assert.match(g.label, /Underhedged by 4 lots/);
}

// 9. BUY === SELL
{
  const h = computePositionHedge([
    opt({ index: "A", quantity: 5, lot_size: 1 }),
    opt({ index: "A", quantity: -5, lot_size: 1, strike: 2 }),
  ]);
  assert.equal(h.groups[0].kind, "hedged");
  assert.equal(h.overallKind, "hedged");
}

// 10. Completely unhedged BUY
{
  const g = computePositionHedge([opt({ index: "A", quantity: 5, lot_size: 1 })]).groups[0];
  assert.equal(g.kind, "unhedged");
  assert.equal(g.buyLots, 5);
  assert.equal(g.sellLots, 0);
  assert.match(g.label, /Unhedged by 5 lots/);
}

// 11. Completely unhedged SELL
{
  const h = computePositionHedge([opt({ index: "A", quantity: -5, lot_size: 1 })]);
  assert.equal(h.groups[0].kind, "unhedged");
  assert.equal(h.overallKind, "unhedged");
  assert.match(h.overallLabel, /1 Unhedged Exposure/);
}

// 12. Multiple strikes aggregate
{
  const g = computePositionHedge([
    opt({ index: "A", strike: 23000, quantity: 2, lot_size: 1 }),
    opt({ index: "A", strike: 23100, quantity: 3, lot_size: 1 }),
    opt({ index: "A", strike: 23200, quantity: -1, lot_size: 1 }),
    opt({ index: "A", strike: 23300, quantity: -3, lot_size: 1 }),
  ]).groups[0];
  assert.equal(g.buyLots, 5);
  assert.equal(g.sellLots, 4);
  assert.equal(g.netLots, 1);
}

// 13. Multiple positions same underlying+type
{
  const g = computePositionHedge([
    opt({ index: "INDEXA", quantity: 2, lot_size: 1 }),
    opt({ index: "INDEXA", quantity: 3, lot_size: 1, strike: 2 }),
    opt({ index: "INDEXA", quantity: -1, lot_size: 1, strike: 3 }),
    opt({ index: "INDEXA", quantity: -2, lot_size: 1, strike: 4 }),
  ]).groups[0];
  assert.equal(g.buyLots, 5);
  assert.equal(g.sellLots, 3);
  assert.equal(g.netLots, 2);
}

// 14. Different lot sizes (per-row metadata, not hardcoded)
{
  const h = computePositionHedge([
    opt({ index: "A", side: "PE", quantity: 375, lot_size: 75 }),
    opt({ index: "B", side: "PE", quantity: 80, lot_size: 20 }),
    opt({ index: "B", side: "PE", quantity: -60, lot_size: 20, strike: 2 }),
  ]);
  const m = byKey(h);
  assert.equal(m["A PE"].buyLots, 5);
  assert.equal(m["A PE"].kind, "unhedged");
  assert.equal(m["B PE"].buyLots, 4);
  assert.equal(m["B PE"].sellLots, 3);
  assert.equal(m["B PE"].netLots, 1);
}

// 15. Partially exited — remaining quantity only
{
  const g = computePositionHedge([
    opt({
      index: "A",
      quantity: 150,
      lot_size: 75,
      buy_quantity: 375,
      sell_quantity: 225,
      closed_quantity: 225,
      partial: true,
    }),
  ]).groups[0];
  assert.equal(g.buyLots, 2);
  assert.equal(g.kind, "unhedged");
}

// 16. Completely exited excluded
{
  const h = computePositionHedge([
    opt({ index: "A", quantity: 0, exited: true, buy_quantity: 375, sell_quantity: 375 }),
    opt({ index: "A", quantity: 75, lot_size: 75, strike: 2 }),
  ]);
  assert.equal(h.groups.length, 1);
  assert.equal(h.groups[0].buyLots, 1);
}

// 17+18. Two underlyings never offset
{
  const h = computePositionHedge([
    opt({ index: "ALPHA", side: "PE", quantity: 5, lot_size: 1 }),
    opt({ index: "ALPHA", side: "PE", quantity: -4, lot_size: 1, strike: 2 }),
    opt({ index: "BETA", side: "PE", quantity: 10, lot_size: 1 }),
    opt({ index: "BETA", side: "PE", quantity: -10, lot_size: 1, strike: 2 }),
  ]);
  const m = byKey(h);
  assert.equal(m["ALPHA PE"].kind, "underhedged");
  assert.equal(m["ALPHA PE"].netLots, 1);
  assert.equal(m["BETA PE"].kind, "hedged");
  assert.equal(h.groups.length, 2);
}

// 19. CE never offsets PE
{
  const h = computePositionHedge([
    opt({ index: "A", side: "PE", quantity: 5, lot_size: 1 }),
    opt({ index: "A", side: "CE", quantity: -5, lot_size: 1 }),
  ]);
  const m = byKey(h);
  assert.equal(m["A PE"].kind, "unhedged");
  assert.equal(m["A CE"].kind, "unhedged");
  assert.equal(h.unhedgedCount, 2);
  assert.match(h.overallLabel, /2 Unhedged Exposures/);
}

// 20. Unknown underlying from symbol, no catalog entry required
{
  const h = computePositionHedge([
    {
      tradingsymbol: "BRANDNEWIX25SEP99900CE",
      side: "CE",
      strike: 99900,
      quantity: 30,
      lot_size: 15,
      exited: false,
    },
    {
      tradingsymbol: "BRANDNEWIX25SEP99800CE",
      side: "CE",
      strike: 99800,
      quantity: -15,
      lot_size: 15,
      exited: false,
    },
  ]);
  assert.equal(h.groups[0].underlying, "BRANDNEWIX");
  assert.equal(h.groups[0].buyLots, 2);
  assert.equal(h.groups[0].sellLots, 1);
  assert.equal(h.groups[0].kind, "underhedged");
}

// Futures skipped (no CE/PE)
{
  const h = computePositionHedge([
    { index: "A", tradingsymbol: "A25AUGFUT", quantity: 75, exited: false, strike: null, side: null },
  ]);
  assert.equal(h.overallKind, "none");
  assert.equal(h.groups.length, 0);
}

// Expiries of the same underlying+type aggregate (book groups by index, not expiry)
{
  const g = computePositionHedge([
    opt({ index: "A", expiry_iso: "2026-09-17", quantity: 75, lot_size: 75 }),
    opt({ index: "A", expiry_iso: "2026-09-24", quantity: -75, lot_size: 75, strike: 2 }),
  ]).groups[0];
  assert.equal(g.kind, "hedged");
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hedgeSrc = fs.readFileSync(path.join(here, "positionHedge.js"), "utf8");
assert.equal(/NIFTY|SENSEX|BANKNIFTY/.test(hedgeSrc), false, "hedge calc must not hard-code index names");

console.log("positionHedge.test.js ok");
