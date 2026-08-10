import assert from "node:assert/strict";
import { orderPages, moveIdBefore } from "./tabOrder.js";

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

console.log("tabOrder.test.js: all assertions passed");
