import assert from "node:assert/strict";
import {
  orderPages,
  moveIdBefore,
  moveIdByOffset,
  pinIdFirst,
  orderByIds,
  clampExpiryListHeight,
  resetLayoutPrefs,
  EXPIRY_LIST_MIN_PX,
  EXPIRY_LIST_MAX_PX,
  EXPIRY_LIST_DEFAULT_PX,
  TAB_ORDER_KEY,
  TILE_ORDER_KEY,
  EXPIRY_LIST_HEIGHT_KEY,
} from "./tabOrder.js";

const pages = [
  { v: "oi-change", l: "OI Change" },
  { v: "open-interest", l: "Open Interest" },
  { v: "strike-table", l: "Strike Table" },
  { v: "buildup", l: "Build-up" },
];

assert.deepEqual(
  orderPages(pages, ["strike-table", "oi-change"]).map((p) => p.v),
  ["strike-table", "oi-change", "open-interest", "buildup"],
  "preferred order applied",
);

assert.deepEqual(
  moveIdBefore(
    ["oi-change", "open-interest", "strike-table", "buildup"],
    "strike-table",
    "oi-change",
  ),
  ["strike-table", "oi-change", "open-interest", "buildup"],
  "drag strike to first",
);

assert.deepEqual(
  moveIdBefore(["a", "b", "c"], "a", "c"),
  ["b", "a", "c"],
  "move first to before last",
);

assert.deepEqual(
  moveIdBefore(["a", "b", "c"], "c", "a"),
  ["c", "a", "b"],
  "move last to first",
);

assert.deepEqual(
  moveIdBefore(["a", "b"], "a", "a"),
  ["a", "b"],
  "noop same id",
);

assert.deepEqual(
  orderByIds(
    [
      { id: "holiday" },
      { id: "fii-dii" },
      { id: "events" },
      { id: "impact" },
    ],
    ["impact", "holiday"],
  ).map((t) => t.id),
  ["impact", "holiday", "fii-dii", "events"],
  "tile order preferred",
);

assert.equal(clampExpiryListHeight(10), EXPIRY_LIST_MIN_PX, "expiry min floor");
assert.equal(clampExpiryListHeight(9999), EXPIRY_LIST_MAX_PX, "expiry max cap");
assert.equal(clampExpiryListHeight("x"), EXPIRY_LIST_DEFAULT_PX, "expiry default");

assert.deepEqual(
  pinIdFirst(["oi-change", "strike-table", "buildup"], "buildup"),
  ["buildup", "oi-change", "strike-table"],
  "pin favorite first",
);

assert.deepEqual(
  moveIdByOffset(["a", "b", "c"], "b", -1),
  ["b", "a", "c"],
  "alt left nudge",
);
assert.deepEqual(
  moveIdByOffset(["a", "b", "c"], "b", 1),
  ["a", "c", "b"],
  "alt right nudge",
);
assert.deepEqual(
  moveIdByOffset(["a", "b", "c"], "a", -1),
  ["a", "b", "c"],
  "clamp left edge",
);

// jsdom-less localStorage stub for reset
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
store.set(TAB_ORDER_KEY, JSON.stringify(["buildup"]));
store.set(TILE_ORDER_KEY, JSON.stringify(["impact"]));
store.set(EXPIRY_LIST_HEIGHT_KEY, "40");
const reset = resetLayoutPrefs();
assert.deepEqual(reset.tabOrder, [], "reset tabs");
assert.deepEqual(reset.tileOrder, [], "reset tiles");
assert.equal(reset.expiryListHeight, EXPIRY_LIST_DEFAULT_PX, "reset height");
assert.equal(store.has(TAB_ORDER_KEY), false, "tab key cleared");
assert.equal(store.get(EXPIRY_LIST_HEIGHT_KEY), String(EXPIRY_LIST_DEFAULT_PX), "height restored");

console.log("tabOrder.test.js: all assertions passed");
