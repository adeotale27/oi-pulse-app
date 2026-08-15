import assert from "node:assert/strict";
import {
  DESK_IDS,
  CATALOG,
  normalizeEnabledIndices,
  normalizeId,
  matchSymbolPrefix,
  isDeskId,
  INDEX_CHIP_CAP,
  usesIndexOverflow,
} from "./universe.js";

assert.deepEqual(DESK_IDS, ["NIFTY", "SENSEX", "BANKNIFTY"]);
assert.equal(normalizeId("bnf"), "BANKNIFTY");
assert.equal(normalizeId("CRUDE"), "CRUDEOIL");
assert.equal(isDeskId("GOLD"), false);
assert.equal(isDeskId("NIFTY"), true);
assert.deepEqual(
  normalizeEnabledIndices(["BANKNIFTY", "GOLD", "nifty", "BANK", "FINNIFTY"]),
  ["NIFTY", "BANKNIFTY", "GOLD", "FINNIFTY"],
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
