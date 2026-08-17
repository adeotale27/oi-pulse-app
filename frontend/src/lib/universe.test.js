import assert from "node:assert/strict";
import {
  DESK_IDS,
  HEATMAP_IDS,
  CATALOG,
  normalizeEnabledIndices,
  normalizeId,
  matchSymbolPrefix,
  isDeskId,
  INDEX_CHIP_CAP,
  usesIndexOverflow,
  MCX_DESK_AVAILABLE,
} from "./universe.js";

assert.equal(MCX_DESK_AVAILABLE, false);

assert.deepEqual(HEATMAP_IDS.slice(0, 3), DESK_IDS);
assert.equal(HEATMAP_IDS.includes("GOLD"), true);
assert.equal(normalizeId("bnf"), "BANKNIFTY");
assert.equal(normalizeId("CRUDE"), "CRUDEOIL");
assert.equal(isDeskId("GOLD"), false);
assert.equal(isDeskId("NIFTY"), true);
assert.deepEqual(
  normalizeEnabledIndices(["BANKNIFTY", "GOLD", "nifty", "BANK", "FINNIFTY"]),
  ["NIFTY", "BANKNIFTY", "FINNIFTY"],
);
assert.deepEqual(
  normalizeEnabledIndices(["BANKNIFTY", "GOLD", "nifty"], true),
  ["NIFTY", "BANKNIFTY", "GOLD"],
);
assert.equal(matchSymbolPrefix("BANKNIFTY26AUG52000PE"), "BANKNIFTY");
assert.equal(matchSymbolPrefix("CRUDEOIL26AUG6500CE"), "CRUDEOIL");
assert.equal(matchSymbolPrefix("NIFTY26AUG24800CE"), "NIFTY");
assert.equal(CATALOG.find((c) => c.id === "CRUDEOIL").pollable, true);
assert.equal(CATALOG.find((c) => c.id === "GOLD").session_group, "mcx_non_agri");
assert.equal(CATALOG.find((c) => c.id === "NIFTY").session_group, "nse");
assert.equal(isDeskId("CRUDEOIL"), false);
assert.equal(INDEX_CHIP_CAP, 3);
assert.equal(usesIndexOverflow(["NIFTY", "SENSEX", "BANKNIFTY"]), false);
assert.equal(usesIndexOverflow(["NIFTY", "SENSEX", "BANKNIFTY", "GOLD"]), true);

console.log("universe.test.js: ok");
