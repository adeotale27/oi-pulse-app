import assert from "node:assert/strict";
import { reportDeskError, errorSourceLabel, isChunkLoadError } from "./errorLog.js";

assert.equal(typeof reportDeskError, "function");
reportDeskError({ message: "unit-test-skip-if-no-window" });
assert.equal(errorSourceLabel("market_intel"), "Mkt Intel");
assert.equal(errorSourceLabel("adr"), "ADRs");
assert.equal(errorSourceLabel("custom_src"), "custom_src");
assert.equal(isChunkLoadError("Loading chunk 170 failed."), true);
assert.equal(isChunkLoadError("timeout of 12000ms exceeded"), false);
console.log("errorLog.test.js: ok");
