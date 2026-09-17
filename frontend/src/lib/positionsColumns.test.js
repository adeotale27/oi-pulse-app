import assert from "node:assert/strict";
import {
  loadColumnOrder,
  moveColumn,
  visibleColumnIds,
  defaultColumnOrder,
  POSITIONS_COLUMN_ORDER_KEY,
} from "./positionsColumns.js";

const vis = { instrument: true, product: true, qty: true, avg: false };
const ids = visibleColumnIds(vis, ["qty", "instrument", "product", "avg"]);
assert.deepEqual(ids, ["qty", "instrument", "product"]);

const moved = moveColumn(["a", "b", "c"], "c", "a");
assert.deepEqual(moved, ["c", "a", "b"]);

const orig = defaultColumnOrder();
assert.equal(orig[0], "instrument");
const swapped = moveColumn(orig, "pnl", "product");
assert.equal(swapped[1], "pnl");
assert.ok(swapped.indexOf("product") > swapped.indexOf("pnl"));

globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
};
localStorage.setItem(POSITIONS_COLUMN_ORDER_KEY, JSON.stringify(["qty", "bogus", "instrument"]));
const loaded = loadColumnOrder();
assert.equal(loaded[0], "qty");
assert.equal(loaded[1], "instrument");
assert.ok(loaded.includes("pnl"));
assert.ok(!loaded.includes("bogus"));

console.log("positionsColumns.test.js ok");
