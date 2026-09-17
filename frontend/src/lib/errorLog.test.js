import assert from "node:assert/strict";
import { reportDeskError, errorSourceLabel } from "./errorLog.js";

assert.equal(typeof reportDeskError, "function");
reportDeskError({ message: "unit-test-skip-if-no-window" });
assert.equal(errorSourceLabel("market_intel"), "Mkt Intel");
assert.equal(errorSourceLabel("adr"), "ADRs");
assert.equal(errorSourceLabel("custom_src"), "custom_src");
console.log("errorLog.test.js: ok");
